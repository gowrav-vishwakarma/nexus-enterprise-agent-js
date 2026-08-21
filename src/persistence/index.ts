/** Persistence wiring for Nexus. */

export {
  PersistenceFactory,
  persistenceFromConfig,
  loadCustomAdapter,
  loadCustomMemoryStore,
} from "./factory.js";
export type { PersistenceBundle } from "./factory.js";
export type { PersistenceResolver } from "./resolver.js";
