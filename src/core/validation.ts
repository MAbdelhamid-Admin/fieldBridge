import { FieldbridgeError } from "./errors.js";
import { envelopeFields, protocols, type NormalizedFrame, type Protocol } from "./types.js";

const protocolSet = new Set<string>(protocols);

export function isProtocol(value: unknown): value is Protocol {
  return typeof value === "string" && protocolSet.has(value);
}

export function assertProtocol(value: unknown): asserts value is Protocol {
  if (!isProtocol(value)) {
    throw new FieldbridgeError("UNSUPPORTED_PROTOCOL", `Unsupported protocol: ${String(value)}`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Structural checks shared by every protocol. Throws FieldbridgeError. */
export function validateFrame(frame: NormalizedFrame): void {
  if (!isPlainObject(frame)) {
    throw new FieldbridgeError("INVALID_FRAME", "frame must be an object");
  }
  assertProtocol(frame.protocol);
  const protocol = frame.protocol;

  if (!Array.isArray(frame.payload) || frame.payload.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    throw new FieldbridgeError("INVALID_PAYLOAD", "payload must contain only bytes in the range 0..255", { protocol, field: "payload" });
  }
  for (const field of envelopeFields) {
    const value = frame[field];
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new FieldbridgeError("INVALID_FIELD", `${field} must be a non-negative integer`, { protocol, field });
    }
  }
  if (frame.deviceId !== undefined && typeof frame.deviceId !== "string" && !Number.isFinite(frame.deviceId)) {
    throw new FieldbridgeError("INVALID_FIELD", "deviceId must be a string or finite number", { protocol, field: "deviceId" });
  }
  if (frame.metadata !== undefined) {
    if (!isPlainObject(frame.metadata)) {
      throw new FieldbridgeError("INVALID_FIELD", "metadata must be an object", { protocol, field: "metadata" });
    }
    for (const [key, value] of Object.entries(frame.metadata)) {
      if (!["string", "number", "boolean"].includes(typeof value)) {
        throw new FieldbridgeError("INVALID_FIELD", `metadata "${key}" must be a string, number or boolean`, { protocol, field: "metadata" });
      }
    }
  }
  if (frame.signals !== undefined) {
    if (!isPlainObject(frame.signals)) {
      throw new FieldbridgeError("INVALID_FIELD", "signals must be an object", { protocol, field: "signals" });
    }
    for (const [name, value] of Object.entries(frame.signals)) {
      if (typeof value !== "boolean" && !Number.isFinite(value)) {
        throw new FieldbridgeError("INVALID_FIELD", `signal "${name}" must be a finite number or boolean`, { protocol, field: "signals" });
      }
    }
  }
}
