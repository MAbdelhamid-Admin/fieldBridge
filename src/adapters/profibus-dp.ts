import { createAdapter } from "../core/adapter.js";
import { profibusDefinition } from "./profibus-pa.js";

export const profibusDpAdapter = createAdapter({ protocol: "profibus-dp", ...profibusDefinition });
