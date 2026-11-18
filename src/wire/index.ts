/**
 * fieldbridge/wire: parse raw bytes into frames and serialize frames into bytes.
 *
 * Supported wire formats:
 *   Modbus TCP (MBAP ADU), Modbus RTU (ADU with CRC-16),
 *   CAN / CAN FD (Linux SocketCAN structs, candump text),
 *   Ethernet II / 802.3 (optional 802.1Q), PROFINET RT, EtherCAT.
 *
 * LIN, FlexRay and PROFIBUS byte formats depend on the interface hardware and
 * are not supported yet; `parse` / `serialize` report UNSUPPORTED_FEATURE.
 */
import { FieldbridgeError } from "../core/errors.js";
import type { NormalizedFrame, Protocol } from "../core/types.js";
import { assertProtocol } from "../core/validation.js";
import type { WireInput } from "./bytes.js";
import { parseSocketCan, serializeSocketCan, type SocketCanOptions } from "./can.js";
import {
  parseEthercat,
  parseEthernet,
  parseProfinet,
  serializeEthercat,
  serializeEthernet,
  serializeProfinet,
  type EthercatSerializeOptions,
} from "./ethernet.js";
import { parseModbusRtu, parseModbusTcpStream, serializeModbusRtu, serializeModbusTcp } from "./modbus.js";

export type { WireInput } from "./bytes.js";
export * from "./modbus.js";
export * from "./can.js";
export * from "./ethernet.js";

export type WireOptions = SocketCanOptions & EthercatSerializeOptions;

/** Protocols with a supported wire format. */
export const wireProtocols: readonly Protocol[] = Object.freeze(["modbus-tcp", "modbus-rtu", "can", "ethernet", "profinet", "ethercat"]);

function unsupported(protocol: Protocol): FieldbridgeError {
  return new FieldbridgeError("UNSUPPORTED_FEATURE", `No wire format is implemented for ${protocol} yet`, { protocol });
}

/**
 * Parses raw bytes of the given protocol. Always returns an array: a Modbus TCP
 * buffer may hold several ADUs and an EtherCAT frame several datagrams.
 */
export function parse(protocol: Protocol, input: WireInput, options: WireOptions = {}): NormalizedFrame[] {
  assertProtocol(protocol);
  switch (protocol) {
    case "modbus-tcp": {
      const { frames, rest } = parseModbusTcpStream(input);
      if (rest.length > 0) {
        throw new FieldbridgeError("INVALID_FRAME", `modbus-tcp input ends with ${rest.length} bytes of an incomplete ADU`, { protocol });
      }
      return frames;
    }
    case "modbus-rtu": return [parseModbusRtu(input)];
    case "can": return [parseSocketCan(input, options)];
    case "ethernet": return [parseEthernet(input)];
    case "profinet": return [parseProfinet(input)];
    case "ethercat": return parseEthercat(input);
    default: throw unsupported(protocol);
  }
}

/** Serializes a frame to raw bytes according to its `protocol`. */
export function serialize(frame: NormalizedFrame, options: WireOptions = {}): Uint8Array {
  if (frame === null || typeof frame !== "object") throw new FieldbridgeError("INVALID_FRAME", "frame must be an object");
  assertProtocol(frame.protocol);
  switch (frame.protocol) {
    case "modbus-tcp": return serializeModbusTcp(frame);
    case "modbus-rtu": return serializeModbusRtu(frame);
    case "can": return serializeSocketCan(frame, options);
    case "ethernet": return serializeEthernet(frame);
    case "profinet": return serializeProfinet(frame);
    case "ethercat": return serializeEthercat([frame], options);
    default: throw unsupported(frame.protocol);
  }
}
