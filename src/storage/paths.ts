/** Tenant-scoped storage path resolution and session index. */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_TENANT = "_default";
const DEFAULT_USER = "_default";
const UNSAFE_SEGMENT_RE = /[/\\:\0]|\.\./g;

let indexLock: Promise<void> = Promise.resolve();

function withIndexLock<T>(fn: () => Promise<T> | T): Promise<T> {
  const run = indexLock.then(() => fn());
  indexLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function getDataRoot(): string {
  return process.env.NEXUS_DATA_ROOT ?? "./tenants";
}

function coerceDataRoot(dataRoot?: string | null): string {
  return dataRoot ?? getDataRoot();
}

export function sanitizeSegment(value: string | null | undefined, fallback: string): string {
  if (!value || !String(value).trim()) {
    return fallback;
  }
  const cleaned = String(value).trim().replace(UNSAFE_SEGMENT_RE, "_");
  return cleaned || fallback;
}

export function normalizeTenantId(tenantId?: string | null): string {
  return sanitizeSegment(tenantId, DEFAULT_TENANT);
}

export function normalizeUserId(userId?: string | null): string {
  return sanitizeSegment(userId, DEFAULT_USER);
}

export function tenantUserDir(
  tenantId: string | null | undefined,
  userId: string | null | undefined,
  dataRoot?: string | null,
): string {
  const root = coerceDataRoot(dataRoot);
  const tenant = normalizeTenantId(tenantId);
  const user = normalizeUserId(userId);
  return path.join(root, tenant, "users", user);
}

export function sessionDir(
  tenantId: string | null | undefined,
  userId: string | null | undefined,
  sessionId: string,
  dataRoot?: string | null,
): string {
  const safeSession = sanitizeSegment(sessionId, sessionId);
  return path.join(tenantUserDir(tenantId, userId, dataRoot), safeSession);
}

export function sessionFile(
  tenantId: string | null | undefined,
  userId: string | null | undefined,
  sessionId: string,
  dataRoot?: string | null,
): string {
  return path.join(sessionDir(tenantId, userId, sessionId, dataRoot), "session.json");
}

export function sessionLockFile(
  tenantId: string | null | undefined,
  userId: string | null | undefined,
  sessionId: string,
  dataRoot?: string | null,
): string {
  return path.join(sessionDir(tenantId, userId, sessionId, dataRoot), ".session.lock");
}

export function memoryDbPath(
  tenantId: string | null | undefined,
  userId: string | null | undefined,
  dataRoot?: string | null,
): string {
  return path.join(tenantUserDir(tenantId, userId, dataRoot), "memory.db");
}

export function sessionsDbPath(
  tenantId: string | null | undefined,
  userId: string | null | undefined,
  dataRoot?: string | null,
): string {
  return path.join(tenantUserDir(tenantId, userId, dataRoot), "sessions.db");
}

export function sessionIndexPath(dataRoot?: string | null): string {
  return path.join(coerceDataRoot(dataRoot), "_index", "sessions.json");
}

async function readIndexSync(dataRoot: string): Promise<Record<string, { tenant_id?: string | null; user_id?: string | null }>> {
  const indexPath = sessionIndexPath(dataRoot);
  try {
    const raw = await readFile(indexPath, "utf8");
    const data = JSON.parse(raw) as unknown;
    if (typeof data === "object" && data != null) {
      return data as Record<string, { tenant_id?: string | null; user_id?: string | null }>;
    }
  } catch {
    return {};
  }
  return {};
}

async function writeIndexSync(
  dataRoot: string,
  index: Record<string, { tenant_id?: string | null; user_id?: string | null }>,
): Promise<void> {
  const indexPath = sessionIndexPath(dataRoot);
  await mkdir(path.dirname(indexPath), { recursive: true });
  await writeFile(indexPath, JSON.stringify(index, null, 2), "utf8");
}

export async function registerSession(
  sessionId: string,
  tenantId: string | null | undefined,
  userId: string | null | undefined,
  dataRoot?: string | null,
): Promise<void> {
  const root = coerceDataRoot(dataRoot);
  await withIndexLock(async () => {
    const index = await readIndexSync(root);
    index[sessionId] = { tenant_id: tenantId ?? null, user_id: userId ?? null };
    await writeIndexSync(root, index);
  });
}

export async function unregisterSession(
  sessionId: string,
  dataRoot?: string | null,
): Promise<void> {
  const root = coerceDataRoot(dataRoot);
  await withIndexLock(async () => {
    const index = await readIndexSync(root);
    delete index[sessionId];
    await writeIndexSync(root, index);
  });
}

export async function lookupSession(
  sessionId: string,
  dataRoot?: string | null,
): Promise<{ tenant_id: string | null; user_id: string | null } | null> {
  const root = coerceDataRoot(dataRoot);
  const index = await withIndexLock(() => readIndexSync(root));
  const entry = index[sessionId];
  if (!entry) {
    return null;
  }
  return {
    tenant_id: entry.tenant_id ?? null,
    user_id: entry.user_id ?? null,
  };
}

export function defaultFileStorageConfig(): Record<string, unknown> {
  return {
    data_root: getDataRoot(),
    tenant_scoped: true,
  };
}

export function defaultSqliteStorageConfig(): Record<string, unknown> {
  return {
    data_root: getDataRoot(),
    tenant_scoped: true,
  };
}
