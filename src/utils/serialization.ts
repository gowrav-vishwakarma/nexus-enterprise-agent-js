/** Serialization utilities for the Nexus Agent Framework. */

export function deepSerialize(obj: unknown): unknown {
  if (obj == null) {
    return null;
  }
  if (obj instanceof Date) {
    return obj.toISOString();
  }
  if (obj instanceof Set || obj instanceof Map) {
    return [...obj].map((item) => deepSerialize(item));
  }
  if (Buffer.isBuffer(obj)) {
    return obj.toString("hex");
  }
  if (typeof obj === "object") {
    if (Array.isArray(obj)) {
      return obj.map((item) => deepSerialize(item));
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      out[String(key)] = deepSerialize(value);
    }
    return out;
  }
  return obj;
}

export function safeJsonLoads<T = unknown>(text: string, defaultValue: T | null = null): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return defaultValue;
  }
}

export function safeJsonDumps(obj: unknown, space?: number): string {
  try {
    return JSON.stringify(deepSerialize(obj), null, space);
  } catch {
    return "";
  }
}

/**
 * Turn a tool return value into the string the model and session store see.
 * Strings stay as-is. Objects become JSON so the model does not receive
 * `[object Object]`.
 */
export function toolResultToString(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw == null) return "";
  return safeJsonDumps(raw) || String(raw);
}
