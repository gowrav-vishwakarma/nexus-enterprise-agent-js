/** Persistence resolver protocol. */

import type { SessionStorageConfig } from "../config/storage.js";
import type { PersistenceBundle } from "./factory.js";

/** User implements this to map tenant/user to storage configuration or bundles. */
export interface PersistenceResolver {
  resolveStorageConfig(
    tenantId?: string | null,
    userId?: string | null,
  ): SessionStorageConfig | Promise<SessionStorageConfig>;

  resolveBundle?(
    tenantId?: string | null,
    userId?: string | null,
  ): PersistenceBundle | null | undefined | Promise<PersistenceBundle | null | undefined>;
}
