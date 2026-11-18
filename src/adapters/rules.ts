import { FieldbridgeError } from "../core/errors.js";
import type { EnvelopeField, NormalizedFrame } from "../core/types.js";

/** Throws INVALID_FIELD when `field` is set and outside `min..max`. */
export function checkRange(frame: NormalizedFrame, field: EnvelopeField, min: number, max: number, label: string = field): void {
  const value = frame[field];
  if (value !== undefined && (value < min || value > max)) {
    throw new FieldbridgeError("INVALID_FIELD", `${frame.protocol} ${label} must be ${min}..${max}`, { protocol: frame.protocol, field });
  }
}

/** Throws MISSING_FIELD when `field` is not set. */
export function requireField(frame: NormalizedFrame, field: EnvelopeField, hint: string): void {
  if (frame[field] === undefined) {
    throw new FieldbridgeError("MISSING_FIELD", `${frame.protocol} requires ${hint}`, { protocol: frame.protocol, field });
  }
}

export function payloadError(frame: NormalizedFrame, message: string): FieldbridgeError {
  return new FieldbridgeError("INVALID_PAYLOAD", message, { protocol: frame.protocol, field: "payload" });
}
