import { FieldbridgeError } from "../core/errors.js";
import type { NormalizedFrame, Protocol, ProtocolValue } from "../core/types.js";

/** Raw bytes as a Uint8Array (preferred), Buffer, or array of byte values. */
export type WireInput = Uint8Array | ArrayLike<number>;

export function toBytes(input: WireInput, protocol: Protocol): Uint8Array {
  if (input instanceof Uint8Array) return input;
  if (input === null || typeof input !== "object" || typeof input.length !== "number") {
    throw new FieldbridgeError("INVALID_FRAME", `${protocol} wire input must be a Uint8Array or byte array`, { protocol });
  }
  const out = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const byte = input[i];
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new FieldbridgeError("INVALID_PAYLOAD", `${protocol} wire input byte ${i} is not 0..255`, { protocol });
    }
    out[i] = byte;
  }
  return out;
}

export function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function truncated(protocol: Protocol, what: string, need: number, got: number): FieldbridgeError {
  return new FieldbridgeError("INVALID_FRAME", `${protocol} frame truncated: ${what} needs ${need} bytes, got ${got}`, { protocol });
}

/** Throws PROTOCOL_MISMATCH unless the frame belongs to `protocol`. */
export function expectProtocol(frame: NormalizedFrame, protocol: Protocol): void {
  if (frame === null || typeof frame !== "object") {
    throw new FieldbridgeError("INVALID_FRAME", "frame must be an object", { protocol });
  }
  if (frame.protocol !== protocol) {
    throw new FieldbridgeError("PROTOCOL_MISMATCH", `Cannot serialize a ${String(frame.protocol)} frame as ${protocol}`, { protocol });
  }
}

/** Reads an optional integer metadata value in `min..max`; returns `fallback` when absent. */
export function metaInt(frame: NormalizedFrame, key: string, min: number, max: number, fallback: number): number;
export function metaInt(frame: NormalizedFrame, key: string, min: number, max: number): number | undefined;
export function metaInt(frame: NormalizedFrame, key: string, min: number, max: number, fallback?: number): number | undefined {
  const value: ProtocolValue | undefined = frame.metadata?.[key];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new FieldbridgeError("INVALID_FIELD", `${frame.protocol} metadata.${key} must be an integer ${min}..${max}`, {
      protocol: frame.protocol,
      field: `metadata.${key}`,
    });
  }
  return value;
}

export function requireValue<T>(value: T | undefined, protocol: Protocol, field: string, hint: string): T {
  if (value === undefined) {
    throw new FieldbridgeError("MISSING_FIELD", `${protocol} serialization requires ${hint}`, { protocol, field });
  }
  return value;
}

export function readMac(bytes: Uint8Array, offset: number): number {
  let value = 0;
  for (let i = 0; i < 6; i++) value = value * 256 + bytes[offset + i];
  return value;
}

export function writeMac(out: Uint8Array, offset: number, mac: number): void {
  let rest = mac;
  for (let i = 5; i >= 0; i--) {
    out[offset + i] = rest % 256;
    rest = Math.floor(rest / 256);
  }
}
