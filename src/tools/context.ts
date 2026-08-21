/** RunContext — request-scoped identity, flags, and service registry. */

import { SessionScope } from "../session/scope.js";

export type RunContextInit = Partial<RunContextFields>;

export interface RunContextFields {
  tenantId?: string | null;
  companyId?: string | null;
  userId?: string | null;
  userName?: string | null;
  sessionId?: string | null;
  requestId?: string | null;
  channel?: string;
  branchId?: string | null;
  auth?: Record<string, unknown>;
  isCron?: boolean;
  isSubagent?: boolean;
  persistable?: boolean;
  metadata?: Record<string, unknown>;
  state?: Record<string, unknown>;
}

export interface RunContextLike extends RunContextFields {
  get(key: string, defaultValue?: unknown): unknown;
  set(key: string, value: unknown): void;
  getState(key: string, defaultValue?: unknown): unknown;
  setState(key: string, value: unknown): void;
  service<T>(key: string, defaultValue?: T): T | undefined;
  withService(key: string, value: unknown): RunContextLike;
  bindServices(services: Record<string, unknown>): RunContextLike;
  deriveChild(opts?: {
    sessionId?: string | null;
    isSubagent?: boolean;
    includeContext?: boolean;
  }): RunContextLike;
  toScope(): SessionScope;
  readonly shouldPersist: boolean;
}

export class RunContext implements RunContextLike {
  tenantId?: string | null;
  companyId?: string | null;
  userId?: string | null;
  userName?: string | null;
  sessionId?: string | null;
  requestId?: string | null;
  channel = "web";
  branchId?: string | null;
  auth: Record<string, unknown> = {};
  isCron = false;
  isSubagent = false;
  persistable = true;
  metadata: Record<string, unknown> = {};
  state: Record<string, unknown> = {};
  private readonly services = new Map<string, unknown>();

  constructor(init: RunContextInit = {}) {
    Object.assign(this, init);
    this.metadata = { ...(init.metadata ?? {}) };
    this.state = { ...(init.state ?? {}) };
    this.auth = { ...(init.auth ?? {}) };
  }

  get tenant_id(): string | null | undefined {
    return this.tenantId;
  }

  get company_id(): string | null | undefined {
    return this.companyId;
  }

  get user_id(): string | null | undefined {
    return this.userId;
  }

  get session_id(): string | null | undefined {
    return this.sessionId;
  }

  get request_id(): string | null | undefined {
    return this.requestId;
  }

  get is_cron(): boolean {
    return this.isCron;
  }

  get is_subagent(): boolean {
    return this.isSubagent;
  }

  get(key: string, defaultValue: unknown = null): unknown {
    return this.metadata[key] ?? defaultValue;
  }

  set(key: string, value: unknown): void {
    this.metadata[key] = value;
  }

  getState(key: string, defaultValue: unknown = null): unknown {
    return this.state[key] ?? defaultValue;
  }

  setState(key: string, value: unknown): void {
    this.state[key] = value;
  }

  service<T>(key: string, defaultValue?: T): T | undefined {
    return (this.services.get(key) as T | undefined) ?? defaultValue;
  }

  withService(key: string, value: unknown): this {
    this.services.set(key, value);
    return this;
  }

  bindServices(services: Record<string, unknown>): this {
    for (const [key, value] of Object.entries(services)) {
      this.services.set(key, value);
    }
    return this;
  }

  get shouldPersist(): boolean {
    if (this.persistable === false) {
      return false;
    }
    if (this.isCron || this.isSubagent) {
      return false;
    }
    return true;
  }

  deriveChild(
    opts: {
      sessionId?: string | null;
      isSubagent?: boolean;
      includeContext?: boolean;
    } = {},
  ): RunContext {
    const includeContext = opts.includeContext ?? true;
    const child = createRunContext({
      tenantId: this.tenantId,
      companyId: this.companyId,
      userId: this.userId,
      userName: this.userName,
      sessionId: opts.sessionId,
      requestId: this.requestId,
      channel: this.channel,
      branchId: this.branchId,
      auth: { ...this.auth },
      isCron: this.isCron,
      isSubagent: opts.isSubagent ?? true,
      persistable: this.persistable,
      metadata: includeContext ? { ...this.metadata } : {},
      state: includeContext ? { ...this.state } : {},
    });
    for (const [key, value] of this.services) {
      child.withService(key, value);
    }
    return child;
  }

  toScope(): SessionScope {
    return new SessionScope({
      tenantId: this.tenantId,
      companyId: this.companyId,
      userId: this.userId,
    });
  }
}

export function createRunContext(partial: RunContextInit = {}): RunContext {
  return new RunContext(partial);
}

export { RunContext as RunContextImpl, RunContext as DefaultRunContext };
