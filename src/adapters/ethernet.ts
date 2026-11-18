import { createAdapter } from "../core/adapter.js";
import type { NormalizedFrame } from "../core/types.js";
import { checkRange } from "./rules.js";

const MAX_MAC = 2 ** 48 - 1;

/** `sourceAddress` / `destinationAddress` are 48-bit MACs; `identifier` is the EtherType. */
function validateEthernet(frame: NormalizedFrame): void {
  checkRange(frame, "sourceAddress", 0, MAX_MAC, "source MAC");
  checkRange(frame, "destinationAddress", 0, MAX_MAC, "destination MAC");
  checkRange(frame, "identifier", 0, 0xffff, "EtherType");
}

export const ethernetAdapter = createAdapter({
  protocol: "ethernet",
  maxPayload: 1500,
  validate: validateEthernet,
  fields: ["sourceAddress", "destinationAddress", "identifier"],
});
