import { createAdapter } from "../core/adapter.js";
import type { NormalizedFrame } from "../core/types.js";
import { checkRange } from "./rules.js";

/** EtherCAT configured station addresses are 16-bit. */
function validateEthercat(frame: NormalizedFrame): void {
  checkRange(frame, "address", 0, 0xffff, "station address");
}

export const ethercatAdapter = createAdapter({
  protocol: "ethercat",
  maxPayload: 1486,
  validate: validateEthercat,
  fields: ["address"],
  usesDeviceAddress: true,
});
