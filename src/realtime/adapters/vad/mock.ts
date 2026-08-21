/** Mock VAD — same energy detector, for tests and local development. */

import { createVADConfig, type VADConfig } from "../../config.js";
import { EnergyVAD } from "./energy.js";

export class MockVAD extends EnergyVAD {
  constructor(config?: VADConfig | null) {
    super(config ?? createVADConfig({ provider: "mock" }));
  }
}
