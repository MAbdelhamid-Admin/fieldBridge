import { FieldbridgeError } from "./errors.js";
import {
  envelopeFields,
  type EnvelopeField,
  type NormalizedFrame,
  type Protocol,
  type ProtocolAdapter,
  type ProtocolFrame,
} from "./types.js";
import { assertProtocol, validateFrame } from "./validation.js";

export interface AdapterDefinition {
  protocol: Protocol;
  /** Maximum payload size in bytes. Omit for no limit. */
  maxPayload?: number;
  /** Protocol-specific checks; runs after the generic structural checks. Throw FieldbridgeError. */
  validate?: (frame: NormalizedFrame) => void;
  /** Context keys that must be present in `metadata` when encoding. */
  requiredContext?: readonly string[];
  /** Envelope fields this protocol uses. Defaults to all of them. */
  fields?: readonly EnvelopeField[];
  /** Whether `address` identifies a device on this bus. Defaults to false. */
  usesDeviceAddress?: boolean;
}

/** Returns a copy that shares no mutable state with the input. */
function cloneFrame(frame: NormalizedFrame, protocol: Protocol): NormalizedFrame {
  const copy: NormalizedFrame = { ...frame, protocol, payload: [...frame.payload] };
  if (frame.metadata) copy.metadata = { ...frame.metadata };
  if (frame.signals) copy.signals = { ...frame.signals };
  return copy;
}

export function createAdapter(definition: AdapterDefinition): ProtocolAdapter {
  const { protocol, maxPayload, validate } = definition;
  assertProtocol(protocol);
  const requiredContext = Object.freeze([...(definition.requiredContext ?? [])]);
  const fields = Object.freeze([...(definition.fields ?? envelopeFields)]);

  const check = (frame: NormalizedFrame): void => {
    if (maxPayload !== undefined && frame.payload.length > maxPayload) {
      throw new FieldbridgeError("PAYLOAD_TOO_LARGE", `${protocol} payload exceeds ${maxPayload} bytes`, { protocol, field: "payload" });
    }
    validate?.(frame);
  };

  return Object.freeze({
    protocol,
    requiredContext,
    fields,
    usesDeviceAddress: definition.usesDeviceAddress ?? false,
    decode(frame: ProtocolFrame): NormalizedFrame {
      validateFrame(frame);
      if (frame.protocol !== protocol) {
        throw new FieldbridgeError("PROTOCOL_MISMATCH", `Expected ${protocol} frame, got ${frame.protocol}`, { protocol });
      }
      const decoded = cloneFrame(frame, protocol);
      check(decoded);
      return decoded;
    },
    encode(frame: NormalizedFrame): ProtocolFrame {
      validateFrame(frame);
      const encoded = cloneFrame(frame, protocol);
      check(encoded);
      for (const field of requiredContext) {
        if (encoded.metadata?.[field] === undefined) {
          throw new FieldbridgeError("MISSING_CONTEXT", `${protocol} requires context field "${field}"`, { protocol, field });
        }
      }
      return encoded;
    },
  });
}
