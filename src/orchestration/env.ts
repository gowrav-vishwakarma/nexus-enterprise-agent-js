/** Environment variable interpolation for manifest YAML values. */

const ENV_PATTERN = /\$\{ENV:([^}|]+)(?:\|([^}]*))?\}/g;

export function interpolateEnv<T>(value: T): T {
  if (typeof value === "string") {
    return interpolateString(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolateEnv(item)) as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = interpolateEnv(item);
    }
    return out as T;
  }
  return value;
}

function interpolateString(value: string): string {
  if (!value.includes("${ENV:")) {
    return value;
  }
  return value.replace(ENV_PATTERN, (_match, varName: string, defaultValue?: string) => {
    const name = varName.trim();
    const envValue = process.env[name];
    if (envValue != null && envValue !== "") {
      return envValue;
    }
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    return "";
  });
}
