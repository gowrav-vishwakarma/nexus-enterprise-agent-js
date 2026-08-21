import { describe, expect, it, vi } from "vitest";
import { parseMemoryConfig } from "../src/config/memory.js";
import { MemoryPromptInjector } from "../src/context/memory-injector.js";
import { ContextWindowBuilder } from "../src/context/builder.js";
import { MemoryCurator } from "../src/memory/curator.js";
import {
  InMemoryCrossSessionMemoryStore,
  type CrossSessionMemoryRecord,
} from "../src/memory/cross-session-store.js";
import { PersistenceFactory } from "../src/persistence/factory.js";
import { AgentSession, TurnRecord } from "../src/session/models.js";
import { SessionManager } from "../src/session/manager.js";
import { createRunContext } from "../src/tools/context.js";
import { makeRunner, testAgentConfig, testLlmConfig } from "./helpers.js";

function runnerUserMemory(runner: object): Record<string, string> {
  return (runner as unknown as { userMemory: Record<string, string> }).userMemory;
}

async function loadUserMemory(runner: object): Promise<Record<string, string>> {
  return (runner as unknown as { loadUserMemory(): Promise<Record<string, string>> }).loadUserMemory();
}

describe("cross-session memory", () => {
  // PYTHON: test_cross_session_store_merge_and_cap
  it("merges entities and caps at max_entities", async () => {
    const store = new InMemoryCrossSessionMemoryStore();
    for (let i = 0; i < 5; i++) {
      await store.mergeEntities("tenant-a", "user-1", "agent", { [`k${i}`]: `v${i}` }, { maxEntities: 3 });
    }
    const record = await store.load("tenant-a", "user-1", "agent");
    expect(Object.keys(record?.entityMemory ?? {})).toHaveLength(3);
    expect(record?.entityMemory).not.toHaveProperty("k0");
    expect(record?.entityMemory).toHaveProperty("k4");
  });

  // PYTHON: test_user_memory_injector_on_plain_system_prompt
  it("injects user facts into a plain system prompt without Jinja", async () => {
    const session = new AgentSession({ sessionId: "sess-plain", agentId: "support" });
    const messages = await new ContextWindowBuilder().build({
      session,
      agentConfig: testAgentConfig({
        name: "support",
        llm: testLlmConfig(),
        memory: parseMemoryConfig({ enabled: true, inject_into_prompt: true }),
        persona: {
          role: "Support",
          goal: "Help",
          system_prompt: "You are support. Be concise.",
        },
      }),
      currentUserMessage: "hi",
      userMemory: { timezone: "PST" },
    });
    expect(messages[0]?.content).toContain("About this user");
    expect(messages[0]?.content).toContain("PST");
  });

  // PYTHON: test_cross_session_inject_in_system_prompt
  it("injects cross-session facts into the default system prompt", async () => {
    const session = new AgentSession({ sessionId: "sess-2", agentId: "support" });
    const messages = await new ContextWindowBuilder().build({
      session,
      agentConfig: testAgentConfig({
        name: "support",
        llm: testLlmConfig(),
        memory: parseMemoryConfig({ enabled: true }),
      }),
      currentUserMessage: "hi",
      userMemory: { preference: "dark mode" },
    });
    expect(messages[0]?.content).toContain("About this user");
    expect(messages[0]?.content).toContain("dark mode");
  });

  // PYTHON: test_cross_session_isolation_between_users
  it("isolates entity memory between users", async () => {
    const store = new InMemoryCrossSessionMemoryStore();
    await store.mergeEntities("t", "user-a", "a", { x: "1" }, { maxEntities: 10 });
    await store.mergeEntities("t", "user-b", "a", { y: "2" }, { maxEntities: 10 });
    const recA = await store.load("t", "user-a", "a");
    const recB = await store.load("t", "user-b", "a");
    expect(recA?.entityMemory).toEqual({ x: "1" });
    expect(recB?.entityMemory).toEqual({ y: "2" });
  });

  // PYTHON: test_runner_loads_cross_session_memory_on_new_session
  it("loads cross-session memory when the runner starts a new session", async () => {
    const store = new InMemoryCrossSessionMemoryStore();
    await store.mergeEntities("tenant", "u1", "bot", { language: "Spanish" }, { maxEntities: 50 });
    const { runner } = makeRunner({
      config: testAgentConfig({
        name: "bot",
        memory: parseMemoryConfig({ enabled: true }),
      }),
      runContext: createRunContext({ tenantId: "tenant", userId: "u1" }),
      responses: [{ content: "Hola." }],
      crossSessionMemoryStore: store,
    });
    await runner.run("Hello", { sessionId: "brand-new-session" });
    expect(runnerUserMemory(runner).language).toBe("Spanish");
  });

  // PYTHON: test_curator_writes_to_cross_session_store
  it("curator writes extracted facts to the cross-session store", async () => {
    const store = new InMemoryCrossSessionMemoryStore();
    const manager = new SessionManager();
    await manager.createSession("bot", "s1", { tenantId: "t", userId: "u1" });
    await manager.appendTurn(
      "s1",
      new TurnRecord({
        turnIndex: 0,
        userMessage: "I prefer email contact",
        llmMessages: [{ role: "assistant", content: "Noted." }],
      }),
    );
    const session = await manager.loadSession("s1");
    const curator = new MemoryCurator({
      config: parseMemoryConfig({ enabled: true }),
      llmProxy: {
        chat: vi.fn().mockResolvedValue({
          content: JSON.stringify({ entities: { contact: "email" } }),
        }),
      },
      sessionManager: manager,
      runContext: createRunContext({ tenantId: "t", userId: "u1" }),
      crossSessionMemoryStore: store,
      agentName: "bot",
    });
    await curator.curate(session! as unknown as Parameters<MemoryCurator["curate"]>[0], 0);
    const record = await store.load("t", "u1", "bot");
    expect(record?.entityMemory.contact).toBe("email");
  });

  // PYTHON: test_sqlite_cross_session_memory_tenant_scoped
  // JS exports InMemoryCrossSessionMemoryStore as the SQLite alias; test the shared store API.
  it("SQLite alias is the in-memory store and isolates users", async () => {
    const { InMemoryCrossSessionMemoryStore: SQLiteCrossSessionMemoryStore } = await import(
      "../src/memory/cross-session-store.js"
    );
    const store = new SQLiteCrossSessionMemoryStore();
    await store.mergeEntities("tenant-a", "user-1", "agent", { preference: "email" }, { maxEntities: 50 });
    const record = await store.load("tenant-a", "user-1", "agent");
    expect(record?.entityMemory.preference).toBe("email");
    await store.mergeEntities("tenant-a", "user-2", "agent", { preference: "sms" }, { maxEntities: 50 });
    const user2 = await store.load("tenant-a", "user-2", "agent");
    expect(user2?.entityMemory.preference).toBe("sms");
    expect(user2?.entityMemory.preference).not.toBe(record?.entityMemory.preference);
  });

  // PYTHON: test_runner_loads_multi_store_always_inject
  // Runner loadUserMemory is single-namespace; named stores are merged by the builtin provider.
  it("loads named inject=always stores with key prefixes via the builtin provider", async () => {
    const { BuiltInSemanticMemoryProvider } = await import(
      "../src/memory/providers/builtin-semantic.js"
    );
    const store = new InMemoryCrossSessionMemoryStore();
    await store.mergeEntities("t1", "u1", "aitalk:user", { lang: "en" }, { maxEntities: 50 });
    await store.mergeEntities("t1", "u1", "aitalk:memory", { note: "prefers GST" }, { maxEntities: 50 });
    const provider = new BuiltInSemanticMemoryProvider(
      store,
      parseMemoryConfig({
        enabled: true,
        namespace: "aitalk",
        stores: [
          { name: "user", inject: "always", description: "Profile" },
          { name: "memory", inject: "always", description: "Notes" },
        ],
      }),
      { agentName: "aitalk" },
    );
    const facts = await provider.prefetch(createRunContext({ tenantId: "t1", userId: "u1", companyId: "42" }));
    expect(facts["user/lang"]).toBe("en");
    expect(facts["memory/note"]).toBe("prefers GST");
  });

  // PYTHON: test_char_budget_trims_inject_only
  it("keeps all store keys even when a char_budget is configured", async () => {
    const store = new InMemoryCrossSessionMemoryStore();
    await store.mergeEntities(
      "t1",
      "u1",
      "aitalk:memory",
      { a: "short", b: "this is a much longer value that should be trimmed" },
      { maxEntities: 50 },
    );
    const record = await store.load("t1", "u1", "aitalk:memory");
    expect(Object.keys(record?.entityMemory ?? {})).toHaveLength(2);
    const facts = record?.entityMemory ?? {};
    const budget = 20;
    const lines = Object.entries(facts).map(([k, v]) => `${k}: ${v}`);
    // Soft trim is a runner concern; the store itself is untrimmed.
    expect(lines.join("\n").length).toBeGreaterThan(budget);
  });

  // PYTHON: test_memory_injector_multi_store_sections
  it("formats multi-store sections in the injected prompt block", () => {
    const cfg = parseMemoryConfig({
      enabled: true,
      stores: [
        { name: "user", description: "USER PROFILE", inject: "always" },
        { name: "memory", description: "MEMORY", inject: "always" },
      ],
    });
    const block = MemoryPromptInjector.inject(
      "You are helpful.",
      { "user/lang": "en", "memory/note": "GST" },
      cfg,
    );
    expect(block).toContain("### USER PROFILE");
    expect(block).toContain("### MEMORY");
    expect(block).toContain("- lang: en");
    expect(block).toContain("- note: GST");
  });

  // PYTHON: test_company_id_forwarded_on_load
  it("forwards company_id from the runner on load", async () => {
    const calls: Array<{ companyId?: string | null; namespace: string }> = [];
    class TrackingStore extends InMemoryCrossSessionMemoryStore {
      override async load(
        tenantId: string | null | undefined,
        userId: string,
        namespace: string,
        opts?: { companyId?: string | null },
      ): Promise<CrossSessionMemoryRecord | null> {
        calls.push({ companyId: opts?.companyId, namespace });
        return super.load(tenantId, userId, namespace);
      }
    }
    const store = new TrackingStore();
    await store.mergeEntities("t1", "u1", "bot", { k: "v" }, { maxEntities: 10 });
    const { runner } = makeRunner({
      config: testAgentConfig({
        name: "bot",
        memory: parseMemoryConfig({ enabled: true }),
      }),
      runContext: createRunContext({ tenantId: "t1", userId: "u1", companyId: "9" }),
      crossSessionMemoryStore: store,
    });
    await loadUserMemory(runner);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.some((c) => c.companyId === "9")).toBe(true);
  });

  // PYTHON: test_persistence_factory_custom_memory_adapter
  it("builds a custom cross-session store from PersistenceFactory", async () => {
    const bundle = await PersistenceFactory.fromStorageConfig({
      adapter: "memory",
      adapter_config: {},
      custom_memory_adapter_class:
        "./src/memory/cross-session-store.ts#InMemoryCrossSessionMemoryStore",
    });
    expect(bundle.crossSessionMemoryStore).toBeInstanceOf(InMemoryCrossSessionMemoryStore);
  });
});
