/** Ports of Python tests/test_sqlite.py — SQLite storage adapter. */

import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SQLiteStorageAdapter } from "../src/session/adapters/sqlite.js";
import { SessionManager } from "../src/session/manager.js";
import { ToolCallRecord, TurnRecord } from "../src/session/models.js";
import { SessionScope } from "../src/session/scope.js";
import { sessionsDbPath } from "../src/storage/paths.js";

const require = createRequire(import.meta.url);

function hasLibsql(): boolean {
  try {
    require.resolve("@libsql/client");
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!hasLibsql())("SQLiteStorageAdapter", () => {
  // PYTHON: test_sqlite_create_and_load_tenant_scoped
  it("creates and loads a tenant-scoped session", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "nexus-sqlite-"));
    const adapter = new SQLiteStorageAdapter({ data_root: tmp, tenant_scoped: true });
    const manager = new SessionManager(adapter);
    const scope = new SessionScope({ tenantId: "t1", userId: "u1" });

    const sess = await manager.createSession("agent-sqlite", "sq-1", {
      tenantId: "t1",
      userId: "u1",
    });
    expect(existsSync(sessionsDbPath("t1", "u1", tmp))).toBe(true);

    const loaded = await manager.loadSession("sq-1", { scope });
    expect(loaded).not.toBeNull();
    expect(loaded!.agentId).toBe("agent-sqlite");
    expect(loaded!.tenantId).toBe("t1");
    expect(sess.sessionId).toBe("sq-1");
  });

  // PYTHON: test_sqlite_append_turn
  it("persists tool calls via appendTurn", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "nexus-sqlite-"));
    const manager = new SessionManager(
      new SQLiteStorageAdapter({ data_root: tmp, tenant_scoped: true }),
    );
    const scope = new SessionScope({ tenantId: "t1", userId: "u1" });
    await manager.createSession("agent-sqlite", "sq-2", { tenantId: "t1", userId: "u1" });

    const tc = new ToolCallRecord({ tcIndex: 0, toolName: "calc", rawResponse: "42" });
    const turn = new TurnRecord({
      turnIndex: 0,
      userMessage: "What is 6×7?",
      toolCalls: [tc],
    });
    await manager.appendTurn("sq-2", turn, { scope });

    const loaded = await manager.loadSession("sq-2", { scope });
    expect(loaded!.turns).toHaveLength(1);
    expect(loaded!.turns[0]!.toolCalls[0]!.toolName).toBe("calc");
    expect(loaded!.turns[0]!.toolCalls[0]!.rawResponse).toBe("42");
  });

  // PYTHON: test_sqlite_update_tc_summary
  it("persists TC summary updates", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "nexus-sqlite-"));
    const manager = new SessionManager(
      new SQLiteStorageAdapter({ data_root: tmp, tenant_scoped: true }),
    );
    const scope = new SessionScope({ tenantId: "t1", userId: "u1" });
    await manager.createSession("a", "sq-3", { tenantId: "t1", userId: "u1" });
    const tc = new ToolCallRecord({
      tcId: "TC1",
      tcIndex: 0,
      toolName: "search",
      rawResponse: "big output",
    });
    await manager.appendTurn("sq-3", new TurnRecord({ turnIndex: 0, toolCalls: [tc] }), { scope });

    await manager.updateTcSummary("sq-3", "TC1", "short summary", 1, { scope });
    let loaded = await manager.loadSession("sq-3", { scope });
    expect(loaded!.turns[0]!.toolCalls[0]!.summarizedResponse).toBe("short summary");
    expect(loaded!.turns[0]!.toolCalls[0]!.summarizedByTurn).toBe(1);

    await manager.updateTcSummary("sq-3", "TC1", "a newer summary", 2, { scope });
    loaded = await manager.loadSession("sq-3", { scope });
    expect(loaded!.turns[0]!.toolCalls[0]!.summarizedResponse).toBe("a newer summary");
    expect(loaded!.turns[0]!.toolCalls[0]!.summarizedByTurn).toBe(2);
  });

  // PYTHON: test_sqlite_list_and_delete
  it("filters listSessions and deletes a row", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "nexus-sqlite-"));
    const manager = new SessionManager(
      new SQLiteStorageAdapter({ data_root: tmp, tenant_scoped: true }),
    );
    const acmeScope = new SessionScope({ tenantId: "acme", userId: "u1" });

    await manager.createSession("bot", "sq-4", { tenantId: "acme", userId: "u1" });
    await manager.createSession("bot", "sq-5", { tenantId: "acme", userId: "u1" });
    await manager.createSession("bot", "sq-6", { tenantId: "other", userId: "u2" });

    const acmeSessions = await manager.listSessions({ agentId: "bot", scope: acmeScope });
    expect(acmeSessions).toHaveLength(2);
    expect(acmeSessions.every((s) => s.tenantId === "acme")).toBe(true);

    await manager.deleteSession("sq-4", { scope: acmeScope });
    expect(await manager.loadSession("sq-4", { scope: acmeScope })).toBeNull();
    expect(await manager.loadSession("sq-5", { scope: acmeScope })).not.toBeNull();
  });

  // PYTHON: test_sqlite_legacy_flat_db
  it("uses a single db file when tenant_scoped is false", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "nexus-sqlite-"));
    const db = join(tmp, "test.db");
    const manager = new SessionManager(
      new SQLiteStorageAdapter({ db_path: db, tenant_scoped: false }),
    );
    await manager.createSession("a", "sq-legacy");
    expect(existsSync(db)).toBe(true);
    expect(await manager.loadSession("sq-legacy")).not.toBeNull();
  });
});
