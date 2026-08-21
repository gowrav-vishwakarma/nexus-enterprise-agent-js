/** Pluggable session JSON codec for storage adapters. */

import { AgentSession, migrateSessionData } from "./models.js";

export interface SessionCodec {
  dumps(session: AgentSession): Record<string, unknown>;
  loads(data: string | Record<string, unknown>, ctx?: unknown): AgentSession;
}

export class DefaultSessionCodec implements SessionCodec {
  dumps(session: AgentSession): Record<string, unknown> {
    return session.toJSON();
  }

  loads(data: string | Record<string, unknown>, _ctx?: unknown): AgentSession {
    const parsed =
      typeof data === "string"
        ? (JSON.parse(data) as Record<string, unknown>)
        : { ...data };
    const migrated = migrateSessionData(parsed);
    return AgentSession.fromJSON(migrated);
  }
}

export function sessionToJson(session: AgentSession, pretty = false): string {
  const payload = new DefaultSessionCodec().dumps(session);
  return JSON.stringify(payload, null, pretty ? 2 : undefined);
}

export function sessionFromJson(data: string | Record<string, unknown>): AgentSession {
  return new DefaultSessionCodec().loads(data);
}

export function loadCodec(classPath?: string | null): SessionCodec {
  if (!classPath) {
    return new DefaultSessionCodec();
  }
  throw new Error(
    `Custom codec_class '${classPath}' must be loaded with loadCodecAsync or passed to the adapter`,
  );
}

export async function loadCodecAsync(classPath?: string | null): Promise<SessionCodec> {
  if (!classPath) {
    return new DefaultSessionCodec();
  }
  const dot = classPath.lastIndexOf(".");
  if (dot < 0) {
    throw new Error(`Invalid codec_class path: ${classPath}`);
  }
  const modulePath = classPath.slice(0, dot);
  const exportName = classPath.slice(dot + 1);
  const module = await import(modulePath);
  const cls = module[exportName] as (new () => SessionCodec) | SessionCodec;
  if (typeof cls === "function") {
    return new cls();
  }
  return cls;
}
