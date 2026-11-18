import { ethercatAdapter } from "../adapters/ethercat.js";
import { ethernetAdapter } from "../adapters/ethernet.js";
import { profinetAdapter } from "../adapters/profinet.js";
import { FieldbridgeError } from "../core/errors.js";
import type { NormalizedFrame, Protocol, ProtocolContext } from "../core/types.js";
import { expectProtocol, metaInt, readMac, requireValue, toBytes, truncated, view, writeMac, type WireInput } from "./bytes.js";

/**
 * Frames are handled without the 4-byte FCS, as most capture tools deliver them.
 * Serialized frames are zero-padded to the 60-byte Ethernet minimum.
 */
export const EtherType = Object.freeze({ VLAN: 0x8100, PROFINET: 0x8892, ETHERCAT: 0x88a4 });

const HEADER = 14;
const MIN_FRAME = 60;
const BROADCAST_MAC = 0xffffffffffff;

// ---------------------------------------------------------------- Ethernet header

interface EthernetHeader {
  destination: number;
  source: number;
  etherType: number;
  /** Offset of the first byte after the EtherType. */
  offset: number;
  metadata: ProtocolContext;
}

function readHeader(bytes: Uint8Array, protocol: Protocol): EthernetHeader {
  if (bytes.length < HEADER) throw truncated(protocol, "Ethernet header", HEADER, bytes.length);
  const metadata: ProtocolContext = {};
  let etherType = view(bytes).getUint16(12);
  let offset = HEADER;
  if (etherType === EtherType.VLAN) {
    if (bytes.length < HEADER + 4) throw truncated(protocol, "802.1Q header", HEADER + 4, bytes.length);
    const tci = view(bytes).getUint16(14);
    metadata.vlanId = tci & 0x0fff;
    metadata.vlanPriority = tci >>> 13;
    etherType = view(bytes).getUint16(16);
    offset += 4;
  }
  return { destination: readMac(bytes, 0), source: readMac(bytes, 6), etherType, offset, metadata };
}

/** Writes the header (with an 802.1Q tag when `metadata.vlanId` is set); returns the header length. */
function writeHeader(out: Uint8Array, frame: NormalizedFrame, destination: number, source: number, etherType: number): number {
  writeMac(out, 0, destination);
  writeMac(out, 6, source);
  const vlanId = metaInt(frame, "vlanId", 0, 4095);
  if (vlanId === undefined) {
    view(out).setUint16(12, etherType);
    return HEADER;
  }
  const priority = metaInt(frame, "vlanPriority", 0, 7, 0);
  view(out).setUint16(12, EtherType.VLAN);
  view(out).setUint16(14, (priority << 13) | vlanId);
  view(out).setUint16(16, etherType);
  return HEADER + 4;
}

function headerLength(frame: NormalizedFrame): number {
  return frame.metadata?.vlanId === undefined ? HEADER : HEADER + 4;
}

function allocate(frame: NormalizedFrame, bodyLength: number): Uint8Array {
  return new Uint8Array(Math.max(MIN_FRAME, headerLength(frame) + bodyLength));
}

function expectEtherType(header: EthernetHeader, etherType: number, protocol: Protocol): void {
  if (header.etherType !== etherType) {
    throw new FieldbridgeError(
      "INVALID_FRAME",
      `not a ${protocol} frame: EtherType 0x${header.etherType.toString(16).padStart(4, "0")}, expected 0x${etherType.toString(16)}`,
      { protocol },
    );
  }
}

// ---------------------------------------------------------------- Ethernet

/**
 * Parses an Ethernet II / 802.3 frame. `identifier` is the EtherType (or the
 * 802.3 length field). For 802.3 frames, padding is removed using the length;
 * for EtherType frames, any padding stays in the payload.
 */
export function parseEthernet(input: WireInput): NormalizedFrame {
  const bytes = toBytes(input, "ethernet");
  const header = readHeader(bytes, "ethernet");
  let payload = bytes.subarray(header.offset);
  if (header.etherType <= 1500) {
    if (payload.length < header.etherType) throw truncated("ethernet", "802.3 payload", header.offset + header.etherType, bytes.length);
    payload = payload.subarray(0, header.etherType);
  }
  return ethernetAdapter.decode({
    protocol: "ethernet",
    destinationAddress: header.destination,
    sourceAddress: header.source,
    identifier: header.etherType,
    payload: Array.from(payload),
    ...(Object.keys(header.metadata).length > 0 ? { metadata: header.metadata } : {}),
  });
}

export function serializeEthernet(frame: NormalizedFrame): Uint8Array {
  expectProtocol(frame, "ethernet");
  const valid = ethernetAdapter.encode(frame);
  const destination = requireValue(valid.destinationAddress, "ethernet", "destinationAddress", "a destination MAC (destinationAddress)");
  const source = requireValue(valid.sourceAddress, "ethernet", "sourceAddress", "a source MAC (sourceAddress)");
  const etherType = requireValue(valid.identifier, "ethernet", "identifier", "an EtherType (identifier)");
  const out = allocate(valid, valid.payload.length);
  out.set(valid.payload, writeHeader(out, valid, destination, source, etherType));
  return out;
}

// ---------------------------------------------------------------- PROFINET RT

/** Parses a PROFINET RT frame (EtherType 0x8892). `identifier` is the FrameID; payload follows it. */
export function parseProfinet(input: WireInput): NormalizedFrame {
  const bytes = toBytes(input, "profinet");
  const header = readHeader(bytes, "profinet");
  expectEtherType(header, EtherType.PROFINET, "profinet");
  if (bytes.length < header.offset + 2) throw truncated("profinet", "FrameID", header.offset + 2, bytes.length);
  return profinetAdapter.decode({
    protocol: "profinet",
    destinationAddress: header.destination,
    sourceAddress: header.source,
    identifier: view(bytes).getUint16(header.offset),
    payload: Array.from(bytes.subarray(header.offset + 2)),
    ...(Object.keys(header.metadata).length > 0 ? { metadata: header.metadata } : {}),
  });
}

export function serializeProfinet(frame: NormalizedFrame): Uint8Array {
  expectProtocol(frame, "profinet");
  const valid = profinetAdapter.encode(frame);
  const destination = requireValue(valid.destinationAddress, "profinet", "destinationAddress", "a destination MAC (destinationAddress)");
  const source = requireValue(valid.sourceAddress, "profinet", "sourceAddress", "a source MAC (sourceAddress)");
  const frameId = requireValue(valid.identifier, "profinet", "identifier", "a FrameID (identifier)");
  const out = allocate(valid, 2 + valid.payload.length);
  const offset = writeHeader(out, valid, destination, source, EtherType.PROFINET);
  view(out).setUint16(offset, frameId);
  out.set(valid.payload, offset + 2);
  return out;
}

// ---------------------------------------------------------------- EtherCAT

/** EtherCAT datagram commands (ETG.1000). */
export const EthercatCommand = Object.freeze({
  NOP: 0, APRD: 1, APWR: 2, APRW: 3, FPRD: 4, FPWR: 5, FPRW: 6, BRD: 7, BWR: 8, BRW: 9,
  LRD: 10, LWR: 11, LRW: 12, ARMW: 13, FRMW: 14,
});

type Addressing = "none" | "position" | "configured" | "broadcast" | "logical";

function addressing(command: number): Addressing {
  if ([1, 2, 3, 13].includes(command)) return "position";
  if ([4, 5, 6, 14].includes(command)) return "configured";
  if ([7, 8, 9].includes(command)) return "broadcast";
  if ([10, 11, 12].includes(command)) return "logical";
  return "none";
}

const DATAGRAM_HEADER = 10;
const WKC = 2;
const MAX_DATAGRAMS_LENGTH = 1500 - 2;

export interface EthercatSerializeOptions {
  /** Destination MAC. Defaults to `metadata.ethernetDestination`, then broadcast. */
  destination?: number;
  /** Source MAC. Defaults to `metadata.ethernetSource` of the first datagram. */
  source?: number;
}

/**
 * Parses an EtherCAT frame (EtherType 0x88A4) into one frame per datagram.
 *
 * Per datagram: `payload` = datagram data; `metadata.command`, `index`, `irq`,
 * `workingCounter`, `circulated`, `ethernetDestination`, `ethernetSource`; and
 * addressing by command type:
 * configured (FPxx/FRMW) → `address` (station) + `metadata.offset`;
 * auto-increment (APxx/ARMW) → `metadata.position` + `metadata.offset`;
 * broadcast (BXX) → `metadata.adp` + `metadata.offset` (every slave increments
 * `adp`, so in a returning frame it counts the slaves that processed it);
 * logical (LXX) → `metadata.logicalAddress`.
 */
export function parseEthercat(input: WireInput): NormalizedFrame[] {
  const bytes = toBytes(input, "ethercat");
  const header = readHeader(bytes, "ethercat");
  expectEtherType(header, EtherType.ETHERCAT, "ethercat");
  if (bytes.length < header.offset + 2) throw truncated("ethercat", "EtherCAT header", header.offset + 2, bytes.length);
  const dv = view(bytes);
  const word = dv.getUint16(header.offset, true);
  const length = word & 0x07ff;
  const type = word >>> 12;
  if (type !== 1) {
    throw new FieldbridgeError("UNSUPPORTED_FEATURE", `EtherCAT frame type ${type} is not supported (only datagrams, type 1)`, { protocol: "ethercat" });
  }
  const end = header.offset + 2 + length;
  if (end > bytes.length) throw truncated("ethercat", "datagrams", end, bytes.length);

  const frames: NormalizedFrame[] = [];
  let pos = header.offset + 2;
  for (;;) {
    if (pos + DATAGRAM_HEADER > end) throw truncated("ethercat", "datagram header", pos + DATAGRAM_HEADER, end);
    const command = bytes[pos];
    const lenWord = dv.getUint16(pos + 6, true);
    const dataLength = lenWord & 0x07ff;
    const more = (lenWord & 0x8000) !== 0;
    if (pos + DATAGRAM_HEADER + dataLength + WKC > end) throw truncated("ethercat", "datagram", pos + DATAGRAM_HEADER + dataLength + WKC, end);

    const adp = dv.getUint16(pos + 2, true);
    const ado = dv.getUint16(pos + 4, true);
    const metadata: ProtocolContext = {
      ...header.metadata,
      ethernetDestination: header.destination,
      ethernetSource: header.source,
      command,
      index: bytes[pos + 1],
      irq: dv.getUint16(pos + 8, true),
      workingCounter: dv.getUint16(pos + DATAGRAM_HEADER + dataLength, true),
      circulated: (lenWord & 0x4000) !== 0,
    };
    const frame: NormalizedFrame = {
      protocol: "ethercat",
      payload: Array.from(bytes.subarray(pos + DATAGRAM_HEADER, pos + DATAGRAM_HEADER + dataLength)),
      metadata,
    };
    switch (addressing(command)) {
      case "configured": frame.address = adp; metadata.offset = ado; break;
      case "position": metadata.position = adp > 0x7fff ? adp - 0x10000 : adp; metadata.offset = ado; break;
      case "broadcast": metadata.adp = adp; metadata.offset = ado; break;
      case "logical": metadata.logicalAddress = dv.getUint32(pos + 2, true); break;
      case "none": metadata.adp = adp; metadata.ado = ado; break;
    }
    frames.push(ethercatAdapter.decode(frame));
    pos += DATAGRAM_HEADER + dataLength + WKC;
    if (!more) break;
  }
  return frames;
}

/** Builds one EtherCAT frame containing the given datagrams, in order. */
export function serializeEthercat(datagrams: readonly NormalizedFrame[], options: EthercatSerializeOptions = {}): Uint8Array {
  if (!Array.isArray(datagrams) || datagrams.length === 0) {
    throw new FieldbridgeError("INVALID_FRAME", "serializeEthercat needs at least one datagram", { protocol: "ethercat" });
  }
  const valid = datagrams.map((d) => {
    expectProtocol(d, "ethercat");
    return ethercatAdapter.encode(d);
  });
  const first = valid[0];
  const bodyLength = valid.reduce((sum, d) => sum + DATAGRAM_HEADER + d.payload.length + WKC, 0);
  if (bodyLength > MAX_DATAGRAMS_LENGTH) {
    throw new FieldbridgeError("PAYLOAD_TOO_LARGE", `EtherCAT datagrams total ${bodyLength} bytes; maximum is ${MAX_DATAGRAMS_LENGTH}`, { protocol: "ethercat" });
  }
  const destination = options.destination ?? metaInt(first, "ethernetDestination", 0, BROADCAST_MAC, BROADCAST_MAC);
  const source = requireValue(
    options.source ?? metaInt(first, "ethernetSource", 0, BROADCAST_MAC),
    "ethercat", "metadata.ethernetSource", "a source MAC (options.source or metadata.ethernetSource)",
  );

  const out = allocate(first, 2 + bodyLength);
  const dv = view(out);
  let pos = writeHeader(out, first, destination, source, EtherType.ETHERCAT);
  dv.setUint16(pos, (1 << 12) | bodyLength, true);
  pos += 2;

  valid.forEach((d, i) => {
    const command = requireValue(metaInt(d, "command", 0, 14), "ethercat", "metadata.command", "a datagram command (metadata.command)");
    out[pos] = command;
    out[pos + 1] = metaInt(d, "index", 0, 0xff, 0);
    switch (addressing(command)) {
      case "configured":
        dv.setUint16(pos + 2, requireValue(d.address, "ethercat", "address", "a station address (address) for configured addressing"), true);
        dv.setUint16(pos + 4, metaInt(d, "offset", 0, 0xffff, 0), true);
        break;
      case "position":
        dv.setUint16(pos + 2, metaInt(d, "position", -0x8000, 0x7fff, 0) & 0xffff, true);
        dv.setUint16(pos + 4, metaInt(d, "offset", 0, 0xffff, 0), true);
        break;
      case "broadcast":
        dv.setUint16(pos + 2, metaInt(d, "adp", 0, 0xffff, 0), true);
        dv.setUint16(pos + 4, metaInt(d, "offset", 0, 0xffff, 0), true);
        break;
      case "logical":
        dv.setUint32(pos + 2, requireValue(metaInt(d, "logicalAddress", 0, 0xffffffff), "ethercat", "metadata.logicalAddress", "a logical address (metadata.logicalAddress)"), true);
        break;
      case "none":
        dv.setUint16(pos + 2, metaInt(d, "adp", 0, 0xffff, 0), true);
        dv.setUint16(pos + 4, metaInt(d, "ado", 0, 0xffff, 0), true);
        break;
    }
    const more = i < valid.length - 1 ? 0x8000 : 0;
    const circulated = d.metadata?.circulated === true ? 0x4000 : 0;
    dv.setUint16(pos + 6, d.payload.length | circulated | more, true);
    dv.setUint16(pos + 8, metaInt(d, "irq", 0, 0xffff, 0), true);
    out.set(d.payload, pos + DATAGRAM_HEADER);
    dv.setUint16(pos + DATAGRAM_HEADER + d.payload.length, metaInt(d, "workingCounter", 0, 0xffff, 0), true);
    pos += DATAGRAM_HEADER + d.payload.length + WKC;
  });
  return out;
}

// ---------------------------------------------------------------- Auto-detect

/**
 * Parses any Ethernet frame, choosing PROFINET or EtherCAT from the EtherType
 * and falling back to plain Ethernet. Always returns an array (EtherCAT frames
 * can hold several datagrams).
 */
export function parseEthernetAuto(input: WireInput): NormalizedFrame[] {
  const bytes = toBytes(input, "ethernet");
  const { etherType } = readHeader(bytes, "ethernet");
  if (etherType === EtherType.PROFINET) return [parseProfinet(bytes)];
  if (etherType === EtherType.ETHERCAT) return parseEthercat(bytes);
  return [parseEthernet(bytes)];
}
