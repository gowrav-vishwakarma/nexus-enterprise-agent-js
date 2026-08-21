/** Cross-session memory store (tenant + user + namespace). */

export interface CrossSessionMemoryRecord {
  tenantId?: string | null;
  userId: string;
  namespace: string;
  entityMemory: Record<string, string>;
  updatedAt: Date;
}

export function makeCrossSessionMemoryKey(
  tenantId: string | null | undefined,
  userId: string,
  namespace: string,
): string {
  const tenantPart = tenantId ?? "_";
  return `${tenantPart}:${userId}:${namespace}`;
}

export function resolveCrossSessionNamespace(
  configured: string,
  agentName: string,
): string {
  return configured.trim() || agentName;
}

export function createCrossSessionMemoryRecord(
  init: Partial<CrossSessionMemoryRecord> & {
    userId: string;
    namespace: string;
  },
): CrossSessionMemoryRecord {
  return {
    tenantId: init.tenantId ?? null,
    userId: init.userId,
    namespace: init.namespace,
    entityMemory: init.entityMemory ?? {},
    updatedAt: init.updatedAt ?? new Date(),
  };
}

export function touchCrossSessionMemoryRecord(
  record: CrossSessionMemoryRecord,
): void {
  record.updatedAt = new Date();
}

function capEntities(
  entities: Record<string, string>,
  maxEntities: number,
): Record<string, string> {
  const entries = Object.entries(entities);
  if (entries.length <= maxEntities) return entities;
  return Object.fromEntries(entries.slice(-maxEntities));
}

export interface CrossSessionMemoryStore {
  load(
    tenantId: string | null | undefined,
    userId: string,
    namespace: string,
    opts?: { companyId?: string | null },
  ): Promise<CrossSessionMemoryRecord | null>;

  save(
    record: CrossSessionMemoryRecord,
    opts?: { companyId?: string | null },
  ): Promise<void>;

  mergeEntities(
    tenantId: string | null | undefined,
    userId: string,
    namespace: string,
    entities: Record<string, string>,
    opts: { maxEntities: number; companyId?: string | null },
  ): Promise<CrossSessionMemoryRecord>;
}

export class InMemoryCrossSessionMemoryStore implements CrossSessionMemoryStore {
  private readonly records = new Map<string, CrossSessionMemoryRecord>();

  async load(
    tenantId: string | null | undefined,
    userId: string,
    namespace: string,
  ): Promise<CrossSessionMemoryRecord | null> {
    const key = makeCrossSessionMemoryKey(tenantId, userId, namespace);
    return this.records.get(key) ?? null;
  }

  async save(record: CrossSessionMemoryRecord): Promise<void> {
    touchCrossSessionMemoryRecord(record);
    const key = makeCrossSessionMemoryKey(
      record.tenantId,
      record.userId,
      record.namespace,
    );
    this.records.set(key, { ...record, entityMemory: { ...record.entityMemory } });
  }

  async mergeEntities(
    tenantId: string | null | undefined,
    userId: string,
    namespace: string,
    entities: Record<string, string>,
    opts: { maxEntities: number },
  ): Promise<CrossSessionMemoryRecord> {
    let existing = await this.load(tenantId, userId, namespace);
    if (!existing) {
      existing = createCrossSessionMemoryRecord({ tenantId, userId, namespace });
    }
    if (Object.keys(entities).length > 0) {
      const merged = { ...existing.entityMemory, ...entities };
      existing.entityMemory = capEntities(merged, opts.maxEntities);
    }
    await this.save(existing);
    return existing;
  }
}
