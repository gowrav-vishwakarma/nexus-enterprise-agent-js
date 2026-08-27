import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PersistenceFactory } from "../src/persistence/factory.js";
import { SQLiteCrossSessionMemoryStore } from "../src/memory/stores/sqlite.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("SQLiteCrossSessionMemoryStore", () => {
  it("round-trips facts in a shared db_path", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "nexus-mem-"));
    dirs.push(dir);
    const dbPath = path.join(dir, "runtime.sqlite");
    const store = new SQLiteCrossSessionMemoryStore({
      db_path: dbPath,
      tenant_scoped: false,
    });
    await store.mergeEntities("acme", "u1", "default", { vendor: "X on the 3rd" }, { maxEntities: 10 });
    const loaded = await store.load("acme", "u1", "default");
    expect(loaded?.entityMemory.vendor).toBe("X on the 3rd");

    const other = await store.load("acme", "u2", "default");
    expect(other).toBeNull();
  });

  it("PersistenceFactory maps sqlite adapter to a real SQLite store", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "nexus-mem-"));
    dirs.push(dir);
    const bundle = await PersistenceFactory.fromStorageConfig({
      adapter: "sqlite",
      adapter_config: {
        db_path: path.join(dir, "company.sqlite"),
        tenant_scoped: false,
        auto_migrate: true,
      },
    });
    expect(bundle.crossSessionMemoryStore).toBeInstanceOf(SQLiteCrossSessionMemoryStore);
    await bundle.crossSessionMemoryStore.mergeEntities(
      "t",
      "u",
      "ns",
      { k: "v" },
      { maxEntities: 5 },
    );
    const record = await bundle.crossSessionMemoryStore.load("t", "u", "ns");
    expect(record?.entityMemory.k).toBe("v");
  });
});
