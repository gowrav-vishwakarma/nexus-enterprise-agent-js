/** Shared redaction helpers. */

export const EMAIL_RE =
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
export const PHONE_RE = /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g;

export const SENSITIVE_KEYS = new Set([
  "api_key",
  "apikey",
  "authorization",
  "access_token",
  "password",
  "refresh_token",
  "secret",
  "token",
]);

export const MASK = "[REDACTED]";

export function redactText(text: string): string {
  return text.replace(PHONE_RE, "[PHONE]").replace(EMAIL_RE, "[EMAIL]");
}

export function redactPayload(
  value: unknown,
  opts: { sensitiveKeys?: Set<string>; depth?: number } = {},
): unknown {
  const sensitiveKeys = opts.sensitiveKeys ?? SENSITIVE_KEYS;
  const depth = opts.depth ?? 0;
  if (depth > 10) return value;
  if (Array.isArray(value)) {
    return value.map((item) =>
      redactPayload(item, { sensitiveKeys, depth: depth + 1 }),
    );
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (sensitiveKeys.has(key.toLowerCase())) out[key] = MASK;
      else out[key] = redactPayload(item, { sensitiveKeys, depth: depth + 1 });
    }
    return out;
  }
  if (typeof value === "string") return redactText(value);
  return value;
}
