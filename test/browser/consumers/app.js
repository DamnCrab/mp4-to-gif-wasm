import { captureConsumerError, runConsumerScenario } from "./shared.js";

export async function runVanillaConsumer(bundler) {
  try {
    await runConsumerScenario({ bundler, framework: "vanilla" });
  } catch (error) {
    captureConsumerError(error);
  }
}
