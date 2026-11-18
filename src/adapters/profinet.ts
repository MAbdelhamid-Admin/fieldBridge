import { createAdapter } from "../core/adapter.js";
import type { NormalizedFrame } from "../core/types.js";
import { checkRange } from "./rules.js";

const MAX_MAC = 2 ** 48 - 1;

/** PROFINET RT runs over Ethernet: MAC addresses plus a 16-bit FrameID in `identifier`. */
function validateProfinet(frame: NormalizedFrame): void {
  checkRange(frame, "sourceAddress", 0, MAX_MAC, "source MAC");
  checkRange(frame, "destinationAddress", 0, MAX_MAC, "destination MAC");
  checkRange(frame, "identifier", 0, 0xffff, "FrameID");
}

export const profinetAdapter = createAdapter({
  protocol: "profinet",
  // Ethernet payload (1500) minus the 2-byte FrameID. Cyclic IO data itself is 40..1440
  // bytes, followed by the 4-byte APDU status.
  maxPayload: 1498,
  validate: validateProfinet,
  fields: ["sourceAddress", "destinationAddress", "identifier"],
});
