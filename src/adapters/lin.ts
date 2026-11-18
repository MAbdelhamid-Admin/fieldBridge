import { createAdapter } from "../core/adapter.js";
import type { NormalizedFrame } from "../core/types.js";
import { checkRange, payloadError, requireField } from "./rules.js";

function validateLin(frame: NormalizedFrame): void {
  requireField(frame, "identifier", "a 6-bit identifier");
  checkRange(frame, "identifier", 0, 0x3f);
  if (frame.payload.length < 1) throw payloadError(frame, "LIN payload must contain 1..8 bytes");
}

export const linAdapter = createAdapter({ protocol: "lin", maxPayload: 8, validate: validateLin, fields: ["identifier"] });
