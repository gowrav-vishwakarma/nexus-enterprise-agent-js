/** Memory curator: gated writer of cross-session user memory. */

import {
  defaultMemoryConfig,
  getCuratorPrompt,
  type MemoryConfig,
} from "../config/memory.js";
import type { RunContext } from "../tools/context.js";
import {
  resolveCrossSessionNamespace,
  type CrossSessionMemoryStore,
} from "./cross-session-store.js";
import type { MemoryProvider } from "./provider.js";

export interface MemoryUpdate {
  entities: Record<string, string>;
  isEmpty(): boolean;
}

export function createMemoryUpdate(
  entities: Record<string, string> = {},
): MemoryUpdate {
  return {
    entities,
    isEmpty() {
      return Object.keys(this.entities).length === 0;
    },
  };
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  if (!text) return null;
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z0-9]*\n?/, "");
    cleaned = cleaned.replace(/\n?```$/, "").trim();
  }
  try {
    const obj = JSON.parse(cleaned) as unknown;
    return obj && typeof obj === "object" && !Array.isArray(obj)
      ? (obj as Record<string, unknown>)
      : null;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        const obj = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
        return obj && typeof obj === "object" && !Array.isArray(obj)
          ? (obj as Record<string, unknown>)
          : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function memoryUpdateFromLlmOutput(text: string): MemoryUpdate {
  const data = parseJsonObject(text);
  if (!data) return createMemoryUpdate();
  const entities: Record<string, string> = {};
  const raw = data.entities;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      if (value == null) continue;
      entities[String(key)] = String(value);
    }
  }
  return createMemoryUpdate(entities);
}

export interface AgentSessionLike {
  sessionId: string;
  agentId?: string;
  turns: Array<{
    userMessage?: string;
    llmMessages?: Array<{ role?: string; content?: string }>;
  }>;
}

export interface LLMProxyLike {
  chat(opts: { messages: Array<{ role: string; content: string }> }): Promise<{
    content?: string | null;
  }>;
}

export class MemoryCurator {
  config: MemoryConfig;
  llmProxy: LLMProxyLike;
  sessionManager: unknown;
  toolRegistry?: unknown;
  runContext?: RunContext | null;
  eventEmitter?: { emit(event: unknown): Promise<void> } | null;
  crossSessionMemoryStore?: CrossSessionMemoryStore | null;
  agentName: string;
  memoryProvider?: MemoryProvider | null;
  private lastCuratedTurn: number | null = null;

  constructor(opts: {
    config?: MemoryConfig | null;
    llmProxy: LLMProxyLike;
    sessionManager: unknown;
    toolRegistry?: unknown;
    runContext?: RunContext | null;
    eventEmitter?: { emit(event: unknown): Promise<void> } | null;
    crossSessionMemoryStore?: CrossSessionMemoryStore | null;
    agentName?: string;
    memoryProvider?: MemoryProvider | null;
  }) {
    this.config = opts.config ?? defaultMemoryConfig();
    this.llmProxy = opts.llmProxy;
    this.sessionManager = opts.sessionManager;
    this.toolRegistry = opts.toolRegistry;
    this.runContext = opts.runContext;
    this.eventEmitter = opts.eventEmitter;
    this.crossSessionMemoryStore = opts.crossSessionMemoryStore;
    this.agentName = opts.agentName ?? "";
    this.memoryProvider = opts.memoryProvider;
  }

  get active(): boolean {
    return Boolean(this.config.enabled);
  }

  shouldTrigger(turnIndex: number, atEnd: boolean): boolean {
    if (!this.active) return false;
    if (atEnd) {
      if (!this.config.extract_at_end) return false;
      return this.lastCuratedTurn !== turnIndex;
    }
    if (this.config.extract_after_each_turn) return true;
    const interval = this.config.extraction_interval ?? 0;
    if (interval > 0) return (turnIndex + 1) % interval === 0;
    return false;
  }

  async curate(
    session: AgentSessionLike,
    turnIndex: number,
  ): Promise<MemoryUpdate> {
    if (!this.active) return createMemoryUpdate();
    const conversation = this.buildConversationDigest(session);
    if (!conversation.trim()) return createMemoryUpdate();
    const existingEntities = await this.loadExistingEntities();
    let raw = "";
    try {
      if (this.config.curator_agent != null) {
        raw = await this.runCuratorAgent(session, conversation, existingEntities);
      } else {
        raw = await this.runCuratorLlm(conversation, existingEntities);
      }
    } catch {
      return createMemoryUpdate();
    }
    const update = memoryUpdateFromLlmOutput(raw);
    this.lastCuratedTurn = turnIndex;
    if (!update.isEmpty()) {
      await this.persistEntities(session, turnIndex, update);
    }
    return update;
  }

  private persistStoreName(): string {
    if (this.config.require_approval) return "pending";
    if (this.config.stores?.length) return this.config.stores[0]!.name;
    return "default";
  }

  private async loadExistingEntities(): Promise<Record<string, string>> {
    const ctx = this.runContext;
    if (!ctx?.userId) return {};
    if (this.memoryProvider) {
      try {
        return { ...(await this.memoryProvider.prefetch(ctx)) };
      } catch {
        return {};
      }
    }
    if (!this.crossSessionMemoryStore) return {};
    const namespace = resolveCrossSessionNamespace(
      this.config.namespace ?? "",
      this.agentName,
    );
    try {
      const record = await this.crossSessionMemoryStore.load(
        ctx.tenantId,
        ctx.userId,
        namespace,
      );
      return record?.entityMemory ? { ...record.entityMemory } : {};
    } catch {
      return {};
    }
  }

  private async persistEntities(
    session: AgentSessionLike,
    turnIndex: number,
    update: MemoryUpdate,
  ): Promise<void> {
    const ctx = this.runContext;
    if (!ctx?.userId) return;
    let namespace = resolveCrossSessionNamespace(
      this.config.namespace ?? "",
      this.agentName,
    );
    const storeName = this.persistStoreName();
    if (storeName !== "default") namespace = `${namespace}:${storeName}`;
    try {
      let entityCount = 0;
      if (this.memoryProvider) {
        for (const [key, value] of Object.entries(update.entities)) {
          await this.memoryProvider.write(ctx, key, value, storeName);
        }
        entityCount = Object.keys(update.entities).length;
      } else if (this.crossSessionMemoryStore) {
        const record = await this.crossSessionMemoryStore.mergeEntities(
          ctx.tenantId,
          ctx.userId,
          namespace,
          update.entities,
          { maxEntities: this.config.max_entities ?? 100 },
        );
        entityCount = Object.keys(record.entityMemory).length;
      } else {
        return;
      }
      if (this.eventEmitter && entityCount) {
        await this.eventEmitter.emit({
          eventType: "entity_extracted",
          sessionId: session.sessionId,
          agentId: session.agentId,
          turnIndex,
          data: {
            scope: "cross_session",
            entityCount,
            updatedKeys: Object.keys(update.entities),
            namespace,
            pending: this.config.require_approval,
          },
        });
      }
    } catch {
      /* skip persist errors */
    }
  }

  private buildConversationDigest(session: AgentSessionLike): string {
    const lines: string[] = [];
    for (const turn of session.turns) {
      if (turn.userMessage) lines.push(`User: ${turn.userMessage}`);
      for (const msg of turn.llmMessages ?? []) {
        if (msg.role === "assistant" && msg.content) {
          lines.push(`Assistant: ${msg.content}`);
        }
      }
    }
    let text = lines.join("\n");
    const limit = this.config.max_conversation_chars ?? 6000;
    if (text.length > limit) text = text.slice(-limit);
    return text;
  }

  private async runCuratorLlm(
    conversation: string,
    existingEntities: Record<string, string>,
  ): Promise<string> {
    const prompt = getCuratorPrompt(this.config)
      .replace("{existing_entities}", JSON.stringify(existingEntities))
      .replace("{conversation}", conversation);
    const response = await this.llmProxy.chat({
      messages: [{ role: "user", content: prompt }],
    });
    return response.content ?? "";
  }

  private async runCuratorAgent(
    _session: AgentSessionLike,
    conversation: string,
    existingEntities: Record<string, string>,
  ): Promise<string> {
    const userMsg = `Existing entities (JSON): ${JSON.stringify(existingEntities)}\n\nRecent conversation:\n${conversation}`;
    void userMsg;
    throw new Error(
      "curator_agent sub-runner is not wired in the JS port yet",
    );
  }
}
