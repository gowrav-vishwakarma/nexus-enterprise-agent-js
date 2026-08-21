/** Storage path utilities for tenant-scoped persistence. */

export {
  defaultFileStorageConfig,
  defaultSqliteStorageConfig,
  getDataRoot,
  lookupSession,
  memoryDbPath,
  normalizeTenantId,
  normalizeUserId,
  registerSession,
  sessionDir,
  sessionFile,
  sessionIndexPath,
  sessionLockFile,
  sessionsDbPath,
  sanitizeSegment,
  tenantUserDir,
  unregisterSession,
} from "./paths.js";
