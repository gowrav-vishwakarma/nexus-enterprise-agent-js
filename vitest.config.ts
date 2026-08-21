import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

function loadDotEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const text = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      out[key] = value;
      if (process.env[key] == null) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env is optional
  }
  return out;
}

const env = loadDotEnv();
const live = process.env.NEXUS_LIVE_LLM === "1";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: live ? [] : ["tests/live/**"],
    env,
    testTimeout: live ? 60_000 : 15_000,
    hookTimeout: live ? 60_000 : 15_000,
  },
});
