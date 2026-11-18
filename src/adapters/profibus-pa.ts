import { createAdapter, type AdapterDefinition } from "../core/adapter.js";
import type { NormalizedFrame } from "../core/types.js";
import { checkRange } from "./rules.js";

/** PROFIBUS station addresses are 0..126; 127 is broadcast. `address` is the destination station. */
function validateProfibus(frame: NormalizedFrame): void {
  checkRange(frame, "address", 0, 127, "station address");
  checkRange(frame, "sourceAddress", 0, 127, "source station address");
}

export const profibusDefinition: Omit<AdapterDefinition, "protocol"> = {
  maxPayload: 244,
  validate: validateProfibus,
  fields: ["address", "sourceAddress"],
  usesDeviceAddress: true,
};

export const profibusPaAdapter = createAdapter({ protocol: "profibus-pa", ...profibusDefinition });
