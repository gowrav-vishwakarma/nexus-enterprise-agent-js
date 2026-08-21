/** Build a MemoryProvider from MemoryConfig. */

import type { MemoryConfig } from "../config/memory.js";
import { importFromPath } from "../orchestration/imports.js";
import {
  InMemoryCrossSessionMemoryStore,
  type CrossSessionMemoryStore,
} from "./cross-session-store.js";
import type { MemoryProvider } from "./provider.js";
import { BuiltInSemanticMemoryProvider } from "./providers/builtin-semantic.js";

export async function buildMemoryProvider(
  config: MemoryConfig,
  store?: CrossSessionMemoryStore | null,
  opts: { agentName?: string; [key: string]: unknown } = {},
): Promise<MemoryProvider | null> {
  if (!config.provider) return null;

  const { agentName = "", ...extra } = opts;
  const kwargs = { ...(config.provider_config ?? {}), ...extra };

  if (config.provider === "custom_class") {
    if (!config.provider_class) {
      throw new Error(
        "MemoryConfig.provider_class is required when provider is custom_class",
      );
    }
    const Cls = (await importFromPath(config.provider_class)) as new (
      args: unknown,
    ) => MemoryProvider;
    return new Cls({ store, config, agentName, ...kwargs });
  }

  if (config.provider === "mem0" || config.provider === "honcho") {
    throw new Error(
      `Memory provider ${config.provider} is not implemented in the JS port yet`,
    );
  }

  return new BuiltInSemanticMemoryProvider(
    store ?? new InMemoryCrossSessionMemoryStore(),
    config,
    { agentName },
  );
}
