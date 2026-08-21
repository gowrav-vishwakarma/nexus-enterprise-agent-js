import { defineConfig } from "tsup";

const shared = {
  format: ["esm"] as const,
  dts: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  target: "node20" as const,
};

export default defineConfig([
  {
    ...shared,
    entry: {
      index: "src/index.ts",
      "realtime/index": "src/realtime/index.ts",
      "skills/index": "src/skills/index.ts",
      "mcp/index": "src/mcp/index.ts",
    },
    clean: true,
  },
  {
    ...shared,
    entry: {
      "cli/main": "src/cli/main.ts",
    },
    clean: false,
    esbuildOptions(options) {
      options.banner = { js: "#!/usr/bin/env node" };
    },
  },
]);
