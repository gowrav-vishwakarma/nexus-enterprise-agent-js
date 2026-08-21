/** Ownership filter for session storage (tenant / company / user). */

export class SessionScope {
  tenantId?: string | null;
  companyId?: string | null;
  userId?: string | null;

  constructor(
    init: {
      tenantId?: string | null;
      companyId?: string | null;
      userId?: string | null;
      tenant_id?: string | null;
      company_id?: string | null;
      user_id?: string | null;
    } = {},
  ) {
    this.tenantId = init.tenantId ?? init.tenant_id ?? null;
    this.companyId = init.companyId ?? init.company_id ?? null;
    this.userId = init.userId ?? init.user_id ?? null;
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

  matchesSession(session: {
    tenantId?: string | null;
    companyId?: string | null;
    userId?: string | null;
  }): boolean {
    if (this.tenantId != null && session.tenantId !== this.tenantId) {
      return false;
    }
    if (this.companyId != null && session.companyId !== this.companyId) {
      return false;
    }
    if (this.userId != null && session.userId !== this.userId) {
      return false;
    }
    return true;
  }

  pathSegments(keys?: string[]): string[] {
    const order = keys ?? ["tenantId", "companyId", "userId"];
    const segments: string[] = [];
    for (const key of order) {
      const value = (this as Record<string, unknown>)[key];
      if (value == null || value === "") continue;
      segments.push(String(value).replace(/\//g, "_"));
    }
    return segments;
  }

  asFilterDict(): Record<string, string> {
    const out: Record<string, string> = {};
    if (this.tenantId != null) out.tenant_id = this.tenantId;
    if (this.companyId != null) out.company_id = this.companyId;
    if (this.userId != null) out.user_id = this.userId;
    return out;
  }
}

export { SessionScope as SessionScopeImpl };
export type { SessionScope as SessionScopeType };

export interface SessionScopeInit {
  tenantId?: string | null;
  companyId?: string | null;
  userId?: string | null;
  tenant_id?: string | null;
  company_id?: string | null;
  user_id?: string | null;
}

export function sessionScope(
  tenantId?: string | null,
  companyId?: string | null,
  userId?: string | null,
): SessionScope {
  return new SessionScope({ tenantId, companyId, userId });
}
