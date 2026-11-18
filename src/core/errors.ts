import type { Protocol } from "./types.js";

export type FieldbridgeErrorCode =
  /** The protocol name is not one of the supported protocols. */
  | "UNSUPPORTED_PROTOCOL"
  /** The input is not a structurally valid frame. */
  | "INVALID_FRAME"
  /** A frame was handed to the adapter of a different protocol. */
  | "PROTOCOL_MISMATCH"
  /** Payload contains non-byte values or violates a length rule. */
  | "INVALID_PAYLOAD"
  /** Payload exceeds the protocol's maximum size. */
  | "PAYLOAD_TOO_LARGE"
  /** A field the protocol requires is absent. */
  | "MISSING_FIELD"
  /** A field is present but outside the protocol's allowed range. */
  | "INVALID_FIELD"
  /** A context key the target adapter requires is absent. */
  | "MISSING_CONTEXT"
  /** A device ID cannot be turned into a bus address. */
  | "INVALID_DEVICE_ID"
  /** A wire frame's checksum (e.g. Modbus RTU CRC) does not match its contents. */
  | "CHECKSUM_MISMATCH"
  /** The input uses a valid protocol feature that fieldbridge does not support yet. */
  | "UNSUPPORTED_FEATURE"
  /** A non-library error was raised (e.g. by a custom adapter); see `cause`. */
  | "INTERNAL";

export interface FieldbridgeErrorDetails {
  protocol?: Protocol;
  field?: string;
  cause?: unknown;
}

/** The only error type thrown by fieldbridge. Branch on `code`, not on `message`. */
export class FieldbridgeError extends Error {
  readonly code: FieldbridgeErrorCode;
  readonly protocol?: Protocol;
  readonly field?: string;

  constructor(code: FieldbridgeErrorCode, message: string, details: FieldbridgeErrorDetails = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "FieldbridgeError";
    this.code = code;
    if (details.protocol !== undefined) this.protocol = details.protocol;
    if (details.field !== undefined) this.field = details.field;
  }
}

export function isFieldbridgeError(error: unknown): error is FieldbridgeError {
  return error instanceof FieldbridgeError;
}
