import { modbusRtuAdapter, modbusTcpAdapter } from "../adapters/modbus.js";
import { FieldbridgeError } from "../core/errors.js";
import type { NormalizedFrame } from "../core/types.js";
import { expectProtocol, metaInt, toBytes, truncated, view, type WireInput } from "./bytes.js";

/** CRC-16/MODBUS (poly 0xA001 reflected, init 0xFFFF) over `bytes[start..end)`. */
export function crc16Modbus(bytes: ArrayLike<number>, start = 0, end = bytes.length): number {
  let crc = 0xffff;
  for (let i = start; i < end; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc;
}

// ---------------------------------------------------------------- Modbus TCP

const MBAP_PREFIX = 6; // transaction id, protocol id, length

export interface ModbusTcpStreamResult {
  /** Complete ADUs found in the input, in order. */
  frames: NormalizedFrame[];
  /** Bytes of an incomplete trailing ADU; prepend them to the next chunk. */
  rest: Uint8Array;
}

/**
 * Splits a TCP byte stream into Modbus TCP ADUs using the MBAP length field.
 * A TCP segment may contain several ADUs, or only part of one.
 *
 * Each frame has `address` = unit id, `payload` = PDU, `metadata.transactionId`.
 */
export function parseModbusTcpStream(input: WireInput): ModbusTcpStreamResult {
  const bytes = toBytes(input, "modbus-tcp");
  const frames: NormalizedFrame[] = [];
  let offset = 0;
  while (bytes.length - offset >= MBAP_PREFIX) {
    const header = view(bytes.subarray(offset));
    const transactionId = header.getUint16(0);
    const protocolId = header.getUint16(2);
    const length = header.getUint16(4); // unit id + PDU
    if (protocolId !== 0) {
      throw new FieldbridgeError("INVALID_FRAME", `modbus-tcp protocol identifier must be 0, got ${protocolId}`, { protocol: "modbus-tcp" });
    }
    if (length < 2 || length > 254) {
      throw new FieldbridgeError("INVALID_FRAME", `modbus-tcp MBAP length must be 2..254, got ${length}`, { protocol: "modbus-tcp" });
    }
    if (bytes.length - offset < MBAP_PREFIX + length) break;
    frames.push(
      modbusTcpAdapter.decode({
        protocol: "modbus-tcp",
        address: bytes[offset + 6],
        payload: Array.from(bytes.subarray(offset + 7, offset + MBAP_PREFIX + length)),
        metadata: { transactionId },
      }),
    );
    offset += MBAP_PREFIX + length;
  }
  return { frames, rest: bytes.slice(offset) };
}

/** Parses exactly one Modbus TCP ADU. Use parseModbusTcpStream for stream data. */
export function parseModbusTcp(input: WireInput): NormalizedFrame {
  const bytes = toBytes(input, "modbus-tcp");
  const { frames, rest } = parseModbusTcpStream(bytes);
  if (frames.length === 0) {
    const need = bytes.length >= MBAP_PREFIX ? MBAP_PREFIX + view(bytes).getUint16(4) : MBAP_PREFIX + 3;
    throw truncated("modbus-tcp", "ADU", need, bytes.length);
  }
  if (frames.length > 1) {
    throw new FieldbridgeError("INVALID_FRAME", `modbus-tcp input contains ${frames.length} ADUs; use parseModbusTcpStream`, { protocol: "modbus-tcp" });
  }
  if (rest.length > 0) {
    throw new FieldbridgeError("INVALID_FRAME", `modbus-tcp input has ${rest.length} trailing bytes`, { protocol: "modbus-tcp" });
  }
  return frames[0];
}

/** Builds a Modbus TCP ADU. `metadata.transactionId` defaults to 0. */
export function serializeModbusTcp(frame: NormalizedFrame): Uint8Array {
  expectProtocol(frame, "modbus-tcp");
  const valid = modbusTcpAdapter.encode(frame);
  const transactionId = metaInt(valid, "transactionId", 0, 0xffff, 0);
  const out = new Uint8Array(7 + valid.payload.length);
  const header = view(out);
  header.setUint16(0, transactionId);
  header.setUint16(2, 0);
  header.setUint16(4, 1 + valid.payload.length);
  out[6] = valid.address!;
  out.set(valid.payload, 7);
  return out;
}

// ---------------------------------------------------------------- Modbus RTU

/** Parses one Modbus RTU ADU (address, PDU, CRC). The CRC is verified. */
export function parseModbusRtu(input: WireInput): NormalizedFrame {
  const bytes = toBytes(input, "modbus-rtu");
  if (bytes.length < 4) throw truncated("modbus-rtu", "ADU (address, function code, CRC)", 4, bytes.length);
  const expected = crc16Modbus(bytes, 0, bytes.length - 2);
  const received = bytes[bytes.length - 2] | (bytes[bytes.length - 1] << 8); // CRC is sent low byte first
  if (expected !== received) {
    throw new FieldbridgeError(
      "CHECKSUM_MISMATCH",
      `modbus-rtu CRC mismatch: frame has 0x${received.toString(16).padStart(4, "0")}, expected 0x${expected.toString(16).padStart(4, "0")}`,
      { protocol: "modbus-rtu" },
    );
  }
  return modbusRtuAdapter.decode({
    protocol: "modbus-rtu",
    address: bytes[0],
    payload: Array.from(bytes.subarray(1, bytes.length - 2)),
  });
}

/** Builds a Modbus RTU ADU with CRC. */
export function serializeModbusRtu(frame: NormalizedFrame): Uint8Array {
  expectProtocol(frame, "modbus-rtu");
  const valid = modbusRtuAdapter.encode(frame);
  const out = new Uint8Array(valid.payload.length + 3);
  out[0] = valid.address!;
  out.set(valid.payload, 1);
  const crc = crc16Modbus(out, 0, out.length - 2);
  out[out.length - 2] = crc & 0xff;
  out[out.length - 1] = crc >>> 8;
  return out;
}
