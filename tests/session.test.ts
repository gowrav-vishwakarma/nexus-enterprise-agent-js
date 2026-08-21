/** Ports of Python tests/test_session.py — storage adapters and SessionManager. */

import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileStorageAdapter } from "../src/session/adapters/file.js";
import { MemoryStorageAdapter } from "../src/session/adapters/memory.js";
import { SessionManager } from "../src/session/manager.js";
import { ToolCallRecord, TurnRecord } from "../src/session/models.js";
import { SessionScope } from "../src/session/scope.js";
import { sessionFile } from "../src/storage/paths.js";

describe("SessionManager", () => {
  // PYTHON: test_memory_storage_adapter
  it("creates, loads, updates, and evicts in-memory sessions", async () => {
    const adapter = new MemoryStorageAdapter({ max_sessions: 2 });
    const manager = new SessionManager(adapter);

    const sess = await manager.createSession("agent-1", "sess-1");
    expect(sess.sessionId).toBe("sess-1");
    expect(sess.agentId).toBe("agent-1");

    const loaded = await manager.loadSession("sess-1");
    expect(loaded).not.toBeNull();
    expect(loaded!.agentId).toBe("agent-1");

    sess.metadata.notes = "New working notes";
    await manager.saveSession(sess);
    const reloaded = await manager.loadSession("sess-1");
    expect(reloaded!.metadata.notes).toBe("New working notes");

    const tc = new ToolCallRecord({
      tcIndex: 1,
      toolName: "web_search",
      rawResponse: "Search result content",
    });
    const turn = new TurnRecord({
      turnIndex: 0,
      userMessage: "Hello",
      toolCalls: [tc],
      status: "completed",
    });
    await manager.appendTurn("sess-1", turn);
    const withTurn = await manager.loadSession("sess-1");
    expect(withTurn!.turns).toHaveLength(1);
    expect(withTurn!.turns[0]!.userMessage).toBe("Hello");
    expect(withTurn!.turns[0]!.toolCalls).toHaveLength(1);

    await manager.createSession("agent-2", "sess-2");
    await manager.createSession("agent-3", "sess-3");
    expect(await manager.loadSession("sess-1")).toBeNull();
    expect(await manager.loadSession("sess-2")).not.toBeNull();
    expect(await manager.loadSession("sess-3")).not.toBeNull();
  });

  // PYTHON: test_file_storage_adapter_tenant_scoped
  it("stores tenant-scoped sessions on disk", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "nexus-file-sess-"));
    const adapter = new FileStorageAdapter({
      data_root: tmp,
      pretty_print: true,
      tenant_scoped: true,
    });
    const manager = new SessionManager(adapter);
    const scope = new SessionScope({ tenantId: "t1", userId: "u1" });

    const sess = await manager.createSession("agent-1", "file-sess-1", {
      tenantId: "t1",
      userId: "u1",
    });
    expect(sess.sessionId).toBe("file-sess-1");

    const expected = sessionFile("t1", "u1", "file-sess-1", tmp);
    expect(existsSync(expected)).toBe(true);

    const loaded = await manager.loadSession("file-sess-1", { scope });
    expect(loaded).not.toBeNull();
    expect(loaded!.agentId).toBe("agent-1");

    const tc = new ToolCallRecord({
      tcIndex: 0,
      toolName: "run_code",
      rawResponse: "print('hi')",
    });
    const turn = new TurnRecord({
      turnIndex: 0,
      userMessage: "run this code",
      toolCalls: [tc],
    });
    await manager.appendTurn("file-sess-1", turn, { scope });

    const withTurn = await manager.loadSession("file-sess-1", { scope });
    expect(withTurn!.turns).toHaveLength(1);
    expect(withTurn!.turns[0]!.toolCalls[0]!.toolName).toBe("run_code");

    const sessions = await manager.listSessions({ agentId: "agent-1", scope });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.sessionId).toBe("file-sess-1");

    await manager.deleteSession("file-sess-1", { scope });
    expect(existsSync(expected)).toBe(false);
    expect(await manager.loadSession("file-sess-1", { scope })).toBeNull();
  });

  // PYTHON: test_file_storage_adapter_legacy_flat
  it("writes a legacy flat JSON file when tenant_scoped is false", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "nexus-file-flat-"));
    const adapter = new FileStorageAdapter({
      base_path: tmp,
      tenant_scoped: false,
      pretty_print: true,
    });
    const manager = new SessionManager(adapter);
    await manager.createSession("agent-1", "file-sess-1");
    expect(existsSync(join(tmp, "file-sess-1.json"))).toBe(true);
    expect(await manager.loadSession("file-sess-1")).not.toBeNull();
  });
});
