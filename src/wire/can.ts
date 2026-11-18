import { canAdapter } from "../adapters/can.js";
import { FieldbridgeError } from "../core/errors.js";
import type { NormalizedFrame, ProtocolContext } from "../core/types.js";
import { expectProtocol, metaInt, toBytes, view, type WireInput } from "./bytes.js";

// Linux <linux/can.h> constants.
const CAN_EFF_FLAG = 0x80000000; // extended (29-bit) frame
const CAN_RTR_FLAG = 0x40000000; // remote transmission request
const CAN_ERR_FLAG = 0x20000000; // error frame
const CAN_EFF_MASK = 0x1fffffff;
const CAN_SFF_MASK = 0x7ff;
const CANFD_BRS = 0x01; // bit rate switch
const CANFD_ESI = 0x02; // error state indicator
const CANFD_FDF = 0x04; // FD frame (set by newer kernels)

/** Size of `struct can_frame`. */
export const CAN_MTU = 16;
/** Size of `struct canfd_frame`. */
export const CANFD_MTU = 72;

export interface SocketCanOptions {
  /** Byte order of `can_id`. SocketCAN uses host order; defaults to little-endian (x86, ARM). */
  littleEndian?: boolean;
}

/**
 * Metadata produced and consumed by the CAN wire functions:
 * `extended`, `fd`, `brs`, `esi`, `rtr`, `rtrLength` (requested length of a remote frame),
 * and from candump logs `timestamp` and `interface`.
 */
function canFrame(identifier: number, payload: number[], metadata: ProtocolContext): NormalizedFrame {
  return canAdapter.decode({ protocol: "can", identifier, payload, metadata });
}

function frameFlags(frame: NormalizedFrame) {
  const extended = frame.metadata?.extended ?? frame.identifier! > CAN_SFF_MASK;
  const fd = frame.metadata?.fd ?? frame.payload.length > 8;
  const rtr = frame.metadata?.rtr === true;
  if (rtr && fd) throw new FieldbridgeError("INVALID_FIELD", "CAN FD has no remote frames", { protocol: "can", field: "metadata.rtr" });
  if (rtr && frame.payload.length > 0) {
    throw new FieldbridgeError("INVALID_PAYLOAD", "CAN remote frames carry no data", { protocol: "can", field: "payload" });
  }
  return { extended: extended === true, fd: fd === true, rtr, brs: frame.metadata?.brs === true, esi: frame.metadata?.esi === true };
}

// ---------------------------------------------------------------- SocketCAN binary

/** Parses a 16-byte `struct can_frame` or 72-byte `struct canfd_frame`. */
export function parseSocketCan(input: WireInput, options: SocketCanOptions = {}): NormalizedFrame {
  const bytes = toBytes(input, "can");
  if (bytes.length !== CAN_MTU && bytes.length !== CANFD_MTU) {
    throw new FieldbridgeError("INVALID_FRAME", `SocketCAN frame must be ${CAN_MTU} or ${CANFD_MTU} bytes, got ${bytes.length}`, { protocol: "can" });
  }
  const rawId = view(bytes).getUint32(0, options.littleEndian ?? true);
  if (rawId & CAN_ERR_FLAG) {
    throw new FieldbridgeError("UNSUPPORTED_FEATURE", "CAN error frames are not supported", { protocol: "can" });
  }
  const extended = (rawId & CAN_EFF_FLAG) !== 0;
  const identifier = extended ? rawId & CAN_EFF_MASK : rawId & CAN_SFF_MASK;
  const length = bytes[4];

  if (bytes.length === CAN_MTU) {
    if (length > 8) throw new FieldbridgeError("INVALID_FRAME", `classic CAN length ${length} exceeds 8`, { protocol: "can" });
    if (rawId & CAN_RTR_FLAG) return canFrame(identifier, [], { extended, fd: false, rtr: true, rtrLength: length });
    return canFrame(identifier, Array.from(bytes.subarray(8, 8 + length)), { extended, fd: false });
  }

  if (length > 64) throw new FieldbridgeError("INVALID_FRAME", `CAN FD length ${length} exceeds 64`, { protocol: "can" });
  const flags = bytes[5];
  return canFrame(identifier, Array.from(bytes.subarray(8, 8 + length)), {
    extended,
    fd: true,
    brs: (flags & CANFD_BRS) !== 0,
    esi: (flags & CANFD_ESI) !== 0,
  });
}

/** Builds a `struct can_frame` (classic) or `struct canfd_frame` (FD). */
export function serializeSocketCan(frame: NormalizedFrame, options: SocketCanOptions = {}): Uint8Array {
  expectProtocol(frame, "can");
  const valid = canAdapter.encode(frame);
  const flags = frameFlags(valid);
  const out = new Uint8Array(flags.fd ? CANFD_MTU : CAN_MTU);
  const id = (valid.identifier! | (flags.extended ? CAN_EFF_FLAG : 0) | (flags.rtr ? CAN_RTR_FLAG : 0)) >>> 0;
  view(out).setUint32(0, id, options.littleEndian ?? true);
  out[4] = flags.rtr ? metaInt(valid, "rtrLength", 0, 8, 0) : valid.payload.length;
  if (flags.fd) out[5] = CANFD_FDF | (flags.brs ? CANFD_BRS : 0) | (flags.esi ? CANFD_ESI : 0);
  out.set(valid.payload, 8);
  return out;
}

// ---------------------------------------------------------------- candump text

const HEX = /^[0-9a-f]*$/i;

function hexToBytes(hex: string, line: string): number[] {
  const clean = hex.replace(/\./g, "");
  if (clean.length % 2 !== 0 || !HEX.test(clean)) {
    throw new FieldbridgeError("INVALID_FRAME", `invalid candump data in "${line}"`, { protocol: "can" });
  }
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 2) out.push(Number.parseInt(clean.slice(i, i + 2), 16));
  return out;
}

function parseCanId(idText: string, line: string): { identifier: number; extended: boolean } {
  if ((idText.length !== 3 && idText.length !== 8) || !HEX.test(idText)) {
    throw new FieldbridgeError("INVALID_FRAME", `invalid candump CAN ID in "${line}"`, { protocol: "can" });
  }
  return { identifier: Number.parseInt(idText, 16), extended: idText.length === 8 };
}

/**
 * candump's default display format: `[(timestamp)] iface ID [len] DE AD BE EF`.
 * candump prints the length with one digit for classic CAN (`[8]`) and two
 * digits for CAN FD (`[08]`, `[12]`). Remote frames show `remote request`.
 */
function parseCandumpDisplay(tokens: string[], metadata: ProtocolContext, line: string): NormalizedFrame {
  const [iface, idText, lengthText, ...rest] = tokens;
  metadata.interface = iface;
  const { identifier, extended } = parseCanId(idText, line);
  metadata.extended = extended;
  const digits = lengthText.slice(1, -1);
  const length = Number(digits);
  if (rest.join(" ").toLowerCase() === "remote request") {
    Object.assign(metadata, { fd: false, rtr: true, rtrLength: length });
    return canFrame(identifier, [], metadata);
  }
  const fd = digits.length === 2;
  metadata.fd = fd;
  if (rest.length !== length || rest.some((b) => !/^[0-9a-f]{2}$/i.test(b))) {
    throw new FieldbridgeError("INVALID_FRAME", `candump line declares ${length} bytes but has "${rest.join(" ")}": "${line}"`, { protocol: "can" });
  }
  return canFrame(identifier, rest.map((b) => Number.parseInt(b, 16)), metadata);
}

/**
 * Parses one line of `candump` output. Accepted formats:
 *
 * - Compact / log (`candump -L`, `candump -l` files), optionally prefixed
 *   with `(timestamp) iface`: `(1436509052.249713) can0 123#DEADBEEF`.
 *   Standard (3 hex digit) and extended (8 hex digit) IDs, CAN FD
 *   (`123##<flags><data>`) and remote frames (`123#R` / `123#R4`).
 * - Default display (plain `candump`, `candump -ta`):
 *   `(1436509052.249713)  can0  123   [4]  DE AD BE EF`.
 */
export function parseCandumpLine(line: string): NormalizedFrame {
  if (typeof line !== "string") throw new FieldbridgeError("INVALID_FRAME", "candump line must be a string", { protocol: "can" });
  let tokens = line.trim().split(/\s+/);
  const metadata: ProtocolContext = {};
  if (/^\(\d+(\.\d+)?\)$/.test(tokens[0] ?? "")) {
    metadata.timestamp = Number(tokens[0].slice(1, -1));
    tokens = tokens.slice(1);
  }
  if (tokens.length >= 3 && /^\[\d{1,2}\]$/.test(tokens[2])) return parseCandumpDisplay(tokens, metadata, line);

  let frameText: string;
  if (tokens.length === 2) {
    metadata.interface = tokens[0];
    frameText = tokens[1];
  } else if (tokens.length === 1 && tokens[0] !== "") {
    frameText = tokens[0];
  } else {
    throw new FieldbridgeError("INVALID_FRAME", `unrecognised candump line "${line}"`, { protocol: "can" });
  }

  const hash = frameText.indexOf("#");
  const { identifier, extended } = parseCanId(hash < 0 ? "" : frameText.slice(0, hash), line);
  metadata.extended = extended;
  const body = frameText.slice(hash + 1);

  if (body.startsWith("#")) {
    const flags = Number.parseInt(body.charAt(1), 16);
    if (Number.isNaN(flags)) throw new FieldbridgeError("INVALID_FRAME", `missing CAN FD flags in "${line}"`, { protocol: "can" });
    Object.assign(metadata, { fd: true, brs: (flags & CANFD_BRS) !== 0, esi: (flags & CANFD_ESI) !== 0 });
    return canFrame(identifier, hexToBytes(body.slice(2), line), metadata);
  }
  if (/^r\d?$/i.test(body)) {
    Object.assign(metadata, { fd: false, rtr: true, rtrLength: body.length > 1 ? Number(body.slice(1)) : 0 });
    return canFrame(identifier, [], metadata);
  }
  metadata.fd = false;
  return canFrame(identifier, hexToBytes(body, line), metadata);
}

/**
 * Formats a CAN frame as a candump line. When `metadata.timestamp` and
 * `metadata.interface` are present, the `-l` log prefix is included.
 */
export function formatCandumpLine(frame: NormalizedFrame): string {
  expectProtocol(frame, "can");
  const valid = canAdapter.encode(frame);
  const flags = frameFlags(valid);
  const id = valid.identifier!.toString(16).toUpperCase().padStart(flags.extended ? 8 : 3, "0");
  const data = valid.payload.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join("");
  let body: string;
  if (flags.rtr) {
    const length = metaInt(valid, "rtrLength", 0, 8, 0);
    body = `R${length > 0 ? length : ""}`;
  } else if (flags.fd) {
    body = `#${((flags.brs ? CANFD_BRS : 0) | (flags.esi ? CANFD_ESI : 0)).toString(16).toUpperCase()}${data}`;
  } else {
    body = data;
  }
  const text = `${id}#${body}`;
  const { timestamp, interface: iface } = valid.metadata ?? {};
  if (typeof timestamp === "number" && typeof iface === "string") return `(${timestamp.toFixed(6)}) ${iface} ${text}`;
  if (typeof iface === "string") return `${iface} ${text}`;
  return text;
}
