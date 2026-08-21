import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "realtime/index": "src/realtime/index.ts",
    "skills/index": "src/skills/index.ts",
    "mcp/index": "src/mcp/index.ts",
    "cli/main": "src/cli/main.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  target: "node20",
});
