/** Skills storage path resolution. */

import { join } from "node:path";
import { getDataRoot, normalizeTenantId, tenantUserDir } from "../storage/paths.js";

export function getSkillsRoot(): string {
  return process.env.NEXUS_SKILLS_ROOT ?? "./skills";
}

export function globalSkillsDir(skillsRoot?: string): string {
  return skillsRoot ?? getSkillsRoot();
}

export function tenantSkillsDir(
  tenantId?: string | null,
  opts: { dataRoot?: string } = {},
): string {
  const root = opts.dataRoot ?? getDataRoot();
  const tenant = normalizeTenantId(tenantId);
  return join(root, tenant, "skills");
}

export function userSkillsDir(
  tenantId?: string | null,
  userId?: string | null,
  opts: { dataRoot?: string } = {},
): string {
  return join(tenantUserDir(tenantId, userId, opts.dataRoot), "skills");
}
