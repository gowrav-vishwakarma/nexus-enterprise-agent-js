/** Skills configuration model. */

import { getSkillsRoot } from "./paths.js";
import type { SkillScopeConfig } from "./scope.js";

export type SkillsActivationMode = "auto" | "explicit" | "both";
export type SkillStoreBackend = "none" | "memory" | "file" | "custom";

export interface SkillsConfig {
  enabled?: boolean;
  activationMode?: SkillsActivationMode;
  globalPaths?: string[];
  explicitSkills?: string[];
  enabledSkills?: string[] | null;
  allowTenantSkills?: boolean;
  allowUserSkills?: boolean;
  allowScripts?: boolean;
  requireScriptApproval?: boolean;
  sandboxAdapter?: string | null;
  scope?: SkillScopeConfig;
  storeBackend?: SkillStoreBackend;
  storeClass?: string | null;
  storeConfig?: Record<string, unknown>;
  retrievalK?: number;
  injectLearned?: boolean;
  exposeManageTools?: boolean;
}

export function defaultSkillsConfig(): SkillsConfig {
  return {
    enabled: false,
    activationMode: "auto",
    globalPaths: [getSkillsRoot()],
    explicitSkills: [],
    enabledSkills: null,
    allowTenantSkills: false,
    allowUserSkills: false,
    allowScripts: false,
    requireScriptApproval: true,
    sandboxAdapter: null,
    scope: { keys: ["tenantId", "companyId", "userId"] },
    storeBackend: "none",
    storeClass: null,
    storeConfig: {},
    retrievalK: 6,
    injectLearned: true,
    exposeManageTools: false,
  };
}
