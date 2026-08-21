/** Session management for the Nexus Agent Framework. */

export {
  AgentSession,
  ContextUpdate,
  PendingInteraction,
  ToolCallRecord,
  TurnRecord,
  CURRENT_SESSION_SCHEMA_VERSION,
  createAgentSession,
  createPendingInteraction,
  createToolCallRecord,
  createTurnRecord,
  pendingInteractionFromJson,
  pendingInteractionToJson,
  nextTcIndex,
  updateSessionTimestamp,
  findTc,
  migrateSessionData,
  asIso,
  type TurnStatus,
} from "./models.js";
export {
  SessionManager,
  createAdapterFromConfig,
  createAdapterFromConfigSync,
} from "./manager.js";
export {
  SessionScope,
  SessionScopeImpl,
  sessionScope,
  type SessionScopeInit,
} from "./scope.js";
export {
  DefaultSessionCodec,
  loadCodec,
  loadCodecAsync,
  sessionToJson,
  sessionFromJson,
  type SessionCodec,
} from "./codec.js";
export type { StorageAdapter } from "./adapters/base.js";
export { MemoryStorageAdapter } from "./adapters/memory.js";
export { FileStorageAdapter } from "./adapters/file.js";
