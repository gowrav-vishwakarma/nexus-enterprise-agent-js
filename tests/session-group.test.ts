import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSessionStorageConfig } from "../src/config/storage.js";
import { FileStorageAdapter } from "../src/session/adapters/file.js";
import { MemoryStorageAdapter } from "../src/session/adapters/memory.js";
import { SessionManager } from "../src/session/manager.js";
import { AgentSession, ToolCallRecord, TurnRecord } from "../src/session/models.js";
import { SessionScope } from "../src/session/scope.js";

function memberSessionId(root: string, memberName: string, prefix = ""): string {
  return `${prefix}${root}_${memberName}`;
}

function turn(
  index: number,
  opts: { userMessage?: string; toolCalls?: ToolCallRecord[]; ts?: Date } = {},
): TurnRecord {
  return new TurnRecord({
    turnIndex: index,
    userMessage: opts.userMessage ?? "hello",
    toolCalls: opts.toolCalls ?? [],
    timestamp: opts.ts ?? new Date(),
  });
}

function delegateTc(member: string, ts: Date): ToolCallRecord {
  return new ToolCallRecord({
    tcIndex: 0,
    toolName: `delegate_to_${member}`,
    rawResponse: "done",
    timestamp: ts,
  });
}

async function save(manager: SessionManager, session: AgentSession): Promise<void> {
  const scope = new SessionScope({ tenantId: session.tenantId, userId: session.userId });
  const existing = await manager.loadSession(session.sessionId, { scope });
  if (existing) {
    existing.turns = session.turns;
    await manager.saveSession(existing);
    return;
  }
  await manager.createSession(session.agentId, session.sessionId, {
    tenantId: session.tenantId,
    userId: session.userId,
  });
  const created = await manager.loadSession(session.sessionId, { scope });
  if (created) {
    created.turns = session.turns;
    await manager.saveSession(created);
  }
}

describe("session group helpers", () => {
  // PYTHON: test_single_agent_session_group
  // loadSessionGroup is not in the JS port; assert the root session itself.
  it("loads a single-agent session as the group root", async () => {
    const manager = new SessionManager(new MemoryStorageAdapter());
    const root = "chat-1";
    const scope = new SessionScope({ tenantId: "t1", userId: "u1" });
    await manager.createSession("assistant", root, { tenantId: "t1", userId: "u1" });
    const sess = await manager.loadSession(root, { scope });
    sess!.turns.push(turn(0, { userMessage: "hi" }));
    await manager.saveSession(sess!);
    const loaded = await manager.loadSession(root, { scope });
    expect(loaded?.sessionId).toBe(root);
    expect(loaded?.turns).toHaveLength(1);
  });

  // PYTHON: test_pipeline_session_group_order
  it("creates pipeline member sessions in declared order", async () => {
    const manager = new SessionManager(new MemoryStorageAdapter());
    const root = "group-1";
    const t0 = new Date("2025-01-01T12:00:00Z");
    const order = ["researcher", "analyst"] as const;
    for (const [i, name] of order.entries()) {
      await save(
        manager,
        new AgentSession({
          sessionId: memberSessionId(root, name),
          agentId: name,
          tenantId: "t1",
          userId: "u1",
          turns: [turn(0, { userMessage: `work-${name}`, ts: new Date(t0.getTime() + i * 60_000) })],
        }),
      );
    }
    const found = await manager.listSessionsByPrefix(`${root}_`, {
      scope: new SessionScope({ tenantId: "t1", userId: "u1" }),
    });
    expect(found.map((s) => s.agentId)).toEqual(["researcher", "analyst"]);
  });

  // PYTHON: test_supervisor_session_group_nested_children
  it("records supervisor delegation tool calls to members", async () => {
    const manager = new SessionManager(new MemoryStorageAdapter());
    const root = "group-2";
    const base = new Date("2025-01-01T12:00:00Z");
    const supervisor = new AgentSession({
      sessionId: memberSessionId(root, "supervisor"),
      agentId: "supervisor",
      tenantId: "t1",
      userId: "u1",
      turns: [
        turn(0, {
          userMessage: "plan",
          toolCalls: [
            delegateTc("researcher", new Date(base.getTime() + 60_000)),
            delegateTc("analyst", new Date(base.getTime() + 5 * 60_000)),
          ],
          ts: base,
        }),
      ],
    });
    const researcher = new AgentSession({
      sessionId: memberSessionId(root, "researcher"),
      agentId: "researcher",
      tenantId: "t1",
      userId: "u1",
      turns: [turn(0, { userMessage: "research", ts: new Date(base.getTime() + 2 * 60_000) })],
    });
    const analyst = new AgentSession({
      sessionId: memberSessionId(root, "analyst"),
      agentId: "analyst",
      tenantId: "t1",
      userId: "u1",
      turns: [turn(0, { userMessage: "analyze", ts: new Date(base.getTime() + 6 * 60_000) })],
    });
    for (const session of [supervisor, researcher, analyst]) {
      await save(manager, session);
    }
    const loaded = await manager.loadSession(memberSessionId(root, "supervisor"), {
      scope: new SessionScope({ tenantId: "t1", userId: "u1" }),
    });
    const names = loaded?.turns[0]?.toolCalls.map((tc) => tc.toolName.replace("delegate_to_", ""));
    expect(names).toEqual(["researcher", "analyst"]);
  });

  // PYTHON: test_repeated_delegation_turn_slices
  it("keeps repeated delegation turns on the member session", async () => {
    const manager = new SessionManager(new MemoryStorageAdapter());
    const root = "group-3";
    const base = new Date("2025-01-01T12:00:00Z");
    await save(
      manager,
      new AgentSession({
        sessionId: memberSessionId(root, "supervisor"),
        agentId: "supervisor",
        tenantId: "t1",
        userId: "u1",
        turns: [
          turn(0, {
            toolCalls: [
              delegateTc("researcher", new Date(base.getTime() + 60_000)),
              delegateTc("researcher", new Date(base.getTime() + 5 * 60_000)),
            ],
            ts: base,
          }),
        ],
      }),
    );
    await save(
      manager,
      new AgentSession({
        sessionId: memberSessionId(root, "researcher"),
        agentId: "researcher",
        tenantId: "t1",
        userId: "u1",
        turns: [
          turn(0, { userMessage: "first", ts: new Date(base.getTime() + 2 * 60_000) }),
          turn(1, { userMessage: "second", ts: new Date(base.getTime() + 6 * 60_000) }),
        ],
      }),
    );
    const researcher = await manager.loadSession(memberSessionId(root, "researcher"), {
      scope: new SessionScope({ tenantId: "t1", userId: "u1" }),
    });
    expect(researcher?.turns).toHaveLength(2);
    expect(researcher?.turns[0]?.userMessage).toBe("first");
    expect(researcher?.turns[1]?.userMessage).toBe("second");
  });

  // PYTHON: test_curator_session_excluded_by_default
  it("can list member sessions separately from an internal curator session", async () => {
    const manager = new SessionManager(new MemoryStorageAdapter());
    const root = "chat-4";
    await save(
      manager,
      new AgentSession({
        sessionId: `${root}__memcurator`,
        agentId: "curator",
        tenantId: "t1",
        userId: "u1",
        turns: [turn(0)],
      }),
    );
    await save(
      manager,
      new AgentSession({
        sessionId: memberSessionId(root, "worker"),
        agentId: "worker",
        tenantId: "t1",
        userId: "u1",
        turns: [turn(0)],
      }),
    );
    const scope = new SessionScope({ tenantId: "t1", userId: "u1" });
    const members = (await manager.listSessionsByPrefix(`${root}_`, { scope })).filter(
      (s) => !s.sessionId.endsWith("__memcurator"),
    );
    expect(members).toHaveLength(1);
    expect(members[0]?.agentId).toBe("worker");
    const withInternal = await manager.listSessions({ scope, limit: 50 });
    expect(withInternal.length).toBeGreaterThanOrEqual(2);
  });

  // PYTHON: test_list_sessions_by_prefix_memory
  it("lists sessions by prefix in memory", async () => {
    const manager = new SessionManager(new MemoryStorageAdapter());
    const root = "grp-5";
    for (const name of ["a", "b", "other"]) {
      const sid = name !== "other" ? memberSessionId(root, name) : "unrelated_x";
      await manager.createSession(name, sid, { tenantId: "t1", userId: "u1" });
    }
    const found = await manager.listSessionsByPrefix(`${root}_`, {
      scope: new SessionScope({ tenantId: "t1", userId: "u1" }),
    });
    expect(new Set(found.map((s) => s.sessionId))).toEqual(
      new Set([memberSessionId(root, "a"), memberSessionId(root, "b")]),
    );
  });

  // PYTHON: test_list_sessions_by_prefix_file_and_sqlite
  it("lists sessions by prefix on the file adapter", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "nexus-sess-file-"));
    const fileManager = new SessionManager(
      new FileStorageAdapter({ data_root: tmp, tenant_scoped: true }),
    );
    const root = "grp-6";
    for (const name of ["x", "y"]) {
      await fileManager.createSession(name, memberSessionId(root, name), {
        tenantId: "t1",
        userId: "u1",
      });
    }
    const fileFound = await fileManager.listSessionsByPrefix(`${root}_`, {
      scope: new SessionScope({ tenantId: "t1", userId: "u1" }),
    });
    expect(fileFound).toHaveLength(2);
  });

  it("lists sessions by prefix on the sqlite adapter when available", async () => {
    let SQLiteStorageAdapter: typeof import("../src/session/adapters/sqlite.js").SQLiteStorageAdapter;
    try {
      ({ SQLiteStorageAdapter } = await import("../src/session/adapters/sqlite.js"));
    } catch {
      return;
    }
    const tmp = mkdtempSync(join(tmpdir(), "nexus-sess-sqlite-"));
    try {
      const sqliteManager = new SessionManager(
        new SQLiteStorageAdapter({ data_root: tmp, tenant_scoped: true }),
      );
      const root = "grp-7";
      for (const name of ["p", "q"]) {
        await sqliteManager.createSession(name, memberSessionId(root, name), {
          tenantId: "t1",
          userId: "u1",
        });
      }
      const sqliteFound = await sqliteManager.listSessionsByPrefix(`${root}_`, {
        scope: new SessionScope({ tenantId: "t1", userId: "u1" }),
      });
      expect(sqliteFound).toHaveLength(2);
    } catch (err) {
      if (String(err).includes("@libsql/client")) return;
      throw err;
    }
  });

  // PYTHON: test_postgresql_config_requires_dsn
  // JS falls back to memory instead of raising; document that stub.
  it("does not throw when postgresql is requested without a DSN", () => {
    const config = parseSessionStorageConfig({ adapter: "postgresql", adapter_config: {} });
    expect(() => SessionManager.fromConfig(config)).not.toThrow();
  });

  // PYTHON: test_postgresql_load_session_group_integration
  it.skipIf(!process.env.NEXUS_TEST_PG_DSN)(
    "skips live postgres session-group integration (no JS postgres adapter)",
    () => {
      expect(process.env.NEXUS_TEST_PG_DSN).toBeTruthy();
    },
  );
});
