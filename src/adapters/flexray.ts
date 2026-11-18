import { createAdapter } from "../core/adapter.js";
import type { NormalizedFrame } from "../core/types.js";
import { checkRange, payloadError, requireField } from "./rules.js";

/** FlexRay payload is 0..127 two-byte words; the frame ID (slot) is 1..2047. */
function validateFlexray(frame: NormalizedFrame): void {
  requireField(frame, "identifier", "a frame identifier (slot)");
  checkRange(frame, "identifier", 1, 2047, "slot identifier");
  if (frame.payload.length % 2 !== 0) {
    throw payloadError(frame, "FlexRay payload length must be an even number of bytes (2-byte words)");
  }
}

export const flexrayAdapter = createAdapter({ protocol: "flexray", maxPayload: 254, validate: validateFlexray, fields: ["identifier"] });
