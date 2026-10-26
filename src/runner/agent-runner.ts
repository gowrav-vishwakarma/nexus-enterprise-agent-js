import type { AgentConfig } from "../config/agent.js";
import { defaultTurnConfig } from "../config/agent.js";
import type { SessionStorageConfig } from "../config/storage.js";
import { ContextWindowBuilder } from "../context/builder.js";
import { TurnTimeoutError, ValidationError } from "../errors.js";
import {
  createBaseEvent,
  NexusEventType,
  type AgentCompletedEvent,
  type AgentErrorEvent,
  type AgentStartedEvent,
  type HumanInLoopRequestedEvent,
  type HumanInLoopResponseEvent,
  type LLMCallCompletedEvent,
  type LLMCallErrorEvent,
  type LLMCallStartedEvent,
  type LLMStreamChunkEvent,
  type ToolCallCompletedEvent,
  type ToolCallErrorEvent,
  type ToolCallStartedEvent,
  type TurnCompletedEvent,
  type TurnStartedEvent,
} from "../events/models.js";
import { NexusEventEmitter, StdoutEventSink } from "../events/emitter.js";
import { buildAssistantLlmMessage, promoteContentToolCalls } from "../llm/content-tool-calls.js";
import type { LLMAdapter } from "../llm/adapters/base.js";
import { LLMProxy } from "../llm/proxy.js";
import type { LLMResponse, TokenUsage, ToolCallRequest } from "../llm/response.js";
import { TokenCounter } from "../llm/token-counter.js";
import { toolResultToString } from "../utils/serialization.js";
import type { AgentSession, PendingInteraction, ToolCallRecord, TurnRecord } from "../session/models.js";
import {
  createPendingInteraction,
  createToolCallRecord,
  createTurnRecord,
  nextTcIndex,
  pendingInteractionToJson,
} from "../session/models.js";
import {
  resolveCrossSessionNamespace,
  type CrossSessionMemoryStore,
} from "../memory/cross-session-store.js";
import { MemoryCurator } from "../memory/curator.js";
import { createMemoryPlugin } from "../memory/plugin.js";
import type { MemoryProvider } from "../memory/provider.js";
import { BuiltInSemanticMemoryProvider } from "../memory/providers/builtin-semantic.js";
import { SessionManager } from "../session/manager.js";
import { SessionScope } from "../session/scope.js";
import { createRunContext, type RunContext } from "../tools/context.js";
import { ContextUpdateInterceptor } from "../tools/interceptor.js";
import { filterSchemasByTools } from "../tools/toolsets.js";
import { ToolRegistry } from "../tools/registry.js";
import type { StructuredResultSchema } from "./structured-output.js";
import type {
  LLMCallContext,
  RunnerHooks,
  ToolCallContext,
  TurnContext,
  TurnDecision,
} from "./hooks.js";
import {
  formatValidationRetryMessage,
  validateStructuredResult,
} from "./structured-output.js";
import {
  createAgentStreamEvent,
  type AgentRunResult,
  type AgentRunStatus,
  type AgentStreamEvent,
} from "./result.js";

// Result given to a client tool / elicitation the user moved on from (see
// AgentRunner.closePendingInteractions).
export const PENDING_SUPERSEDED = "Not answered by user: the user sent a new message instead.";

export class RunCancelled extends Error {
  constructor(message = "Run cancelled.") {
    super(message);
    this.name = "RunCancelled";
  }
}

interface LoopState {
  result: AgentRunResult | null;
}

function mergeToolCallDelta(
  accumulated: Map<number, { id?: string; name: string; arguments: string }>,
  delta: Record<string, unknown>,
): void {
  const index = Number(delta.index ?? 0);
  if (!accumulated.has(index)) {
    accumulated.set(index, { id: undefined, name: "", arguments: "" });
  }
  const entry = accumulated.get(index)!;
  if (delta.id) {
    entry.id = String(delta.id);
  }
  if (delta.name) {
    entry.name = String(delta.name);
  }
  if (delta.arguments) {
    entry.arguments += String(delta.arguments);
  }
  const fn = delta.function;
  if (fn && typeof fn === "object") {
    const functionObj = fn as Record<string, unknown>;
    if (functionObj.name) {
      entry.name = String(functionObj.name);
    }
    if (functionObj.arguments) {
      entry.arguments += String(functionObj.arguments);
    }
  }
}

function toolCallsFromAccumulated(
  accumulated: Map<number, { id?: string; name: string; arguments: string }>,
): ToolCallRequest[] {
  const toolCalls: ToolCallRequest[] = [];
  for (const idx of [...accumulated.keys()].sort((a, b) => a - b)) {
    const tc = accumulated.get(idx)!;
    if (!tc.name) {
      continue;
    }
    const id = tc.id ?? `call_stream_${idx}`;
    let toolInput: Record<string, unknown> = {};
    try {
      toolInput = tc.arguments ? (JSON.parse(tc.arguments) as Record<string, unknown>) : {};
    } catch {
      toolInput = {};
    }
    toolCalls.push({ id, toolName: tc.name, toolInput });
  }
  return toolCalls;
}

export class AgentRunner {
  readonly config: AgentConfig;
  readonly toolRegistry: ToolRegistry;
  readonly sessionManager: SessionManager;
  readonly runContext: RunContext;
  readonly eventEmitter: NexusEventEmitter;
  readonly llmProxy: LLMProxy;
  readonly ctxBuilder: ContextWindowBuilder;
  readonly hooks: RunnerHooks;
  readonly crossSessionMemoryStore: CrossSessionMemoryStore | null;
  readonly memoryProvider: MemoryProvider | null;
  readonly memoryCurator: MemoryCurator;
  readonly interceptor: ContextUpdateInterceptor;
  readonly extraVars: Record<string, unknown> | null;

  private streamSeq = 0;
  private _cancelRequested = false;
  private loopSession: AgentSession | null = null;
  private allowedTools: Set<string> | null = null;
  private runtimeGrantedTools = new Set<string>();
  private userMemory: Record<string, string> = {};

  constructor(options: {
    config: AgentConfig;
    toolRegistry: ToolRegistry;
    storageConfig?: SessionStorageConfig | SessionManager | null;
    sessionManager?: SessionManager;
    runContext?: RunContext;
    eventEmitter?: NexusEventEmitter;
    crossSessionMemoryStore?: CrossSessionMemoryStore | null;
    memoryProvider?: MemoryProvider | null;
    extraVars?: Record<string, unknown> | null;
    hooks?: RunnerHooks;
    onTurnEnd?: RunnerHooks["onTurnEnd"];
    llmAdapter?: LLMAdapter;
    llmProxy?: LLMProxy;
  }) {
    this.config = options.config;
    this.toolRegistry = options.toolRegistry;
    if (options.sessionManager) {
      this.sessionManager = options.sessionManager;
    } else if (options.storageConfig instanceof SessionManager) {
      this.sessionManager = options.storageConfig;
    } else if (options.storageConfig) {
      this.sessionManager = SessionManager.fromConfig(options.storageConfig);
    } else if (this.config.storage) {
      this.sessionManager = SessionManager.fromConfig(this.config.storage);
    } else {
      this.sessionManager = new SessionManager();
    }
    this.runContext = options.runContext ?? createRunContext();
    this.eventEmitter = options.eventEmitter ?? new NexusEventEmitter();
    this.crossSessionMemoryStore = options.crossSessionMemoryStore ?? null;
    this.memoryProvider =
      options.memoryProvider ??
      buildSyncMemoryProvider(this.config.memory, this.crossSessionMemoryStore, this.config.name);
    this.extraVars = options.extraVars ?? null;
    this.hooks = options.hooks ?? {};
    if (options.onTurnEnd && !this.hooks.onTurnEnd) {
      this.hooks.onTurnEnd = options.onTurnEnd;
    }

    // Only trace to stdout when we own the emitter. A host that passes its own
    // emitter has already chosen its sinks.
    if (!options.eventEmitter && (this.config.trace_enabled || this.config.traceEnabled)) {
      this.eventEmitter.registerSink(new StdoutEventSink());
    }

    this.llmProxy = options.llmProxy ?? new LLMProxy(this.config.llm, options.llmAdapter);
    this.ctxBuilder = new ContextWindowBuilder(this.eventEmitter);
    this.interceptor = new ContextUpdateInterceptor(this.eventEmitter);
    this.memoryCurator = new MemoryCurator({
      config: this.config.memory,
      llmProxy: this.llmProxy,
      sessionManager: this.sessionManager,
      toolRegistry: this.toolRegistry,
      runContext: this.runContext,
      eventEmitter: this.eventEmitter,
      crossSessionMemoryStore: this.crossSessionMemoryStore,
      agentName: this.config.name,
      memoryProvider: this.memoryProvider,
    });
    this.setupMemoryPlugin();
  }

  private setupMemoryPlugin(): void {
    if (!this.config.memory?.enabled || !this.config.memory.expose_tools) return;
    if (!this.crossSessionMemoryStore && !this.memoryProvider) return;
    this.toolRegistry.registerPlugin(
      createMemoryPlugin(
        this.crossSessionMemoryStore,
        this.config.memory,
        this.config.name,
        this.memoryProvider,
      ),
    );
  }

  cancel(): void {
    this._cancelRequested = true;
  }

  private raiseIfCancelled(): void {
    if (this._cancelRequested) {
      throw new RunCancelled();
    }
  }

  private resolveStream(stream?: boolean | null): boolean {
    return stream ?? this.config.streamOutput ?? this.config.stream_output ?? false;
  }

  private sessionScope(session?: AgentSession | null): SessionScope {
    return new SessionScope({
      tenantId: this.runContext.tenantId ?? session?.tenantId ?? null,
      companyId: this.runContext.companyId ?? session?.companyId ?? null,
      userId: this.runContext.userId ?? session?.userId ?? null,
    });
  }

  private resolveToolsets(): void {
    const override =
      typeof this.runContext.get === "function"
        ? this.runContext.get("toolset_override", null)
        : this.runContext.metadata?.toolset_override ?? null;
    const toolset = override ?? this.config.toolset ?? null;
    this.allowedTools = this.toolRegistry.resolveToolset(
      toolset as string | string[] | null,
    );
    if (this.allowedTools && this.runtimeGrantedTools.size > 0) {
      for (const name of this.runtimeGrantedTools) {
        this.allowedTools.add(name);
      }
    }
  }

  grantTools(names: string | string[]): void {
    const list = typeof names === "string" ? [names] : names;
    for (const name of list) {
      this.runtimeGrantedTools.add(name);
    }
    if (this.allowedTools) {
      for (const name of list) {
        this.allowedTools.add(name);
      }
    }
  }

  grantToolset(nameOrNames: string | string[]): void {
    if (this.allowedTools == null) {
      return;
    }
    const resolved = this.toolRegistry.resolveToolset(nameOrNames);
    if (resolved) {
      for (const name of resolved) {
        this.allowedTools.add(name);
        this.runtimeGrantedTools.add(name);
      }
    }
  }

  revokeTools(names: string | string[]): void {
    if (this.allowedTools == null) {
      return;
    }
    const list = typeof names === "string" ? [names] : names;
    for (const name of list) {
      this.allowedTools.delete(name);
      this.runtimeGrantedTools.delete(name);
    }
  }

  private filterToolSchemas(toolSchemas: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    if (!this.allowedTools) {
      return toolSchemas;
    }
    return toolSchemas.filter((schema) => {
      const fn = (schema.function ?? schema) as Record<string, unknown>;
      return this.allowedTools!.has(String(fn.name ?? ""));
    });
  }

  private jsonSafeState(state: Record<string, unknown>): Record<string, unknown> {
    const safe: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(state)) {
      try {
        JSON.stringify(value);
        safe[key] = value;
      } catch {
        // skip non-serializable values
      }
    }
    return safe;
  }

  private hydrateStateFromSession(
    session: AgentSession,
    initialContext?: Record<string, unknown> | null,
  ): void {
    const base = { ...(session.state ?? {}) };
    if (initialContext) {
      Object.assign(base, initialContext);
    }
    const preSet = { ...(this.runContext.state ?? {}) };
    const merged = { ...base, ...preSet };
    this.runContext.state = merged;
    session.state = { ...merged };
  }

  private bindLoopSession(session: AgentSession): AgentSession {
    session.streamSeq = this.streamSeq;
    this.loopSession = session;
    return session;
  }

  private nextStreamSeq(): number {
    this.streamSeq += 1;
    return this.streamSeq;
  }

  private numberStreamEvent(event: AgentStreamEvent): AgentStreamEvent {
    const payload = { ...(event.data ?? {}) };
    payload.seq = this.nextStreamSeq();
    event.data = payload;
    if (this.loopSession) {
      this.loopSession.streamSeq = this.streamSeq;
    }
    return event;
  }

  private async persistTurn(session: AgentSession, turn: TurnRecord): Promise<AgentSession> {
    if (this.runContext.shouldPersist === false) {
      session.turns.push(turn);
      session.updatedAt = new Date().toISOString();
      return session;
    }
    await this.sessionManager.appendTurn(session.sessionId, turn, {
      scope: this.sessionScope(session),
    });
    const reloaded = await this.sessionManager.loadSession(session.sessionId, {
      scope: this.sessionScope(session),
    });
    return reloaded ?? session;
  }

  private async maybeSaveSession(session: AgentSession): Promise<void> {
    if (this.loopSession?.sessionId === session.sessionId) {
      session.streamSeq = this.streamSeq;
      this.loopSession = session;
    }
    if (this.runContext.shouldPersist === false) {
      return;
    }
    await this.sessionManager.saveSession(session);
  }

  private async persistTurnWithState(session: AgentSession, turn: TurnRecord): Promise<AgentSession> {
    const snapshot = this.jsonSafeState({ ...(this.runContext.state ?? {}) });
    session.state = snapshot;
    this.runContext.state = { ...snapshot };
    await this.maybeSaveSession(session);
    session = await this.persistTurn(session, turn);
    session.state = { ...snapshot };
    this.runContext.state = { ...snapshot };
    return this.bindLoopSession(session);
  }

  private memoryStoreNamespace(storeName = "default"): string {
    const base = resolveCrossSessionNamespace(
      this.config.memory?.namespace ?? "",
      this.config.name,
    );
    if (storeName && storeName !== "default") return `${base}:${storeName}`;
    return base;
  }

  private async loadUserMemory(): Promise<Record<string, string>> {
    if (!this.config.memory?.enabled || !this.runContext.userId) {
      return {};
    }
    if (this.memoryProvider) {
      try {
        return { ...(await this.memoryProvider.prefetch(this.runContext)) };
      } catch (error) {
        console.warn("AgentRunner: failed to prefetch memory via provider:", error);
        return {};
      }
    }
    if (!this.crossSessionMemoryStore) return {};
    const companyId = this.runContext.companyId;
    const stores = this.config.memory.stores ?? [];
    try {
      if (!stores.length) {
        const record = await this.crossSessionMemoryStore.load(
          this.runContext.tenantId,
          this.runContext.userId,
          this.memoryStoreNamespace("default"),
          { companyId },
        );
        return record?.entityMemory ? { ...record.entityMemory } : {};
      }
      const always = stores.filter((s) => (s.inject ?? "always") === "always");
      const multi = always.length > 1;
      const merged: Record<string, string> = {};
      for (const storeCfg of always) {
        const record = await this.crossSessionMemoryStore.load(
          this.runContext.tenantId,
          this.runContext.userId,
          this.memoryStoreNamespace(storeCfg.name),
          { companyId },
        );
        if (!record?.entityMemory) continue;
        const entries = trimToCharBudget(record.entityMemory, storeCfg.char_budget ?? 0);
        for (const [key, value] of Object.entries(entries)) {
          merged[multi ? `${storeCfg.name}/${key}` : key] = value;
        }
      }
      return merged;
    } catch (error) {
      console.warn("AgentRunner: failed to load cross-session memory:", error);
      return {};
    }
  }

  private async maybeCurateAfterTurn(
    session: AgentSession,
    turnIndex: number,
    atEnd = false,
  ): Promise<AgentSession> {
    if (!this.memoryCurator.shouldTrigger(turnIndex, atEnd)) return session;
    await this.memoryCurator.curate(session, turnIndex);
    const reloaded = await this.sessionManager.loadSession(session.sessionId, {
      scope: this.sessionScope(session),
    });
    if (reloaded) session = reloaded;
    this.userMemory = await this.loadUserMemory();
    return this.bindLoopSession(session);
  }

  private async getOrCreateSession(sessionId?: string | null): Promise<AgentSession> {
    const sid = sessionId ?? this.runContext.sessionId ?? null;
    let session: AgentSession | null = null;
    if (sid) {
      session = await this.sessionManager.loadSession(sid, { scope: this.sessionScope() });
    }
    if (!session) {
      session = await this.sessionManager.createSession(this.config.name, sid, {
        scope: this.sessionScope(),
        userName: this.runContext.userName ?? null,
      });
      this.runContext.sessionId = session.sessionId;
    }
    return session;
  }

  private async buildContextMessages(
    session: AgentSession,
    currentUserMessage?: string | null,
  ): Promise<Array<Record<string, unknown>>> {
    try {
      return await this.ctxBuilder.build({
        session,
        agentConfig: this.config,
        currentUserMessage,
        tokenBudget: this.config.llm.context_window_tokens ?? 128_000,
        userMemory: this.userMemory,
        summaryText: session.summaryText,
        runContext: this.runContext,
        extraVars: this.extraVars,
      });
    } catch (error) {
      console.warn("ContextWindowBuilder failed, using simple message list:", error);
      const messages: Array<Record<string, unknown>> = [];
      if (currentUserMessage) {
        messages.push({ role: "user", content: currentUserMessage });
      }
      return messages;
    }
  }

  private limitToolCalls(toolCalls: ToolCallRequest[]): ToolCallRequest[] {
    const limit =
      this.config.turns?.maxToolCallsPerTurn ??
      this.config.turns?.max_tool_calls_per_turn ??
      defaultTurnConfig().maxToolCallsPerTurn ??
      5;
    if (limit <= 0 || toolCalls.length <= limit) {
      return toolCalls;
    }
    return toolCalls.slice(0, limit);
  }

  /**
   * A new user message ends whatever the paused run was waiting for.
   *
   * Each pending tool call gets a "not run" result (so the model sees it never
   * happened) and the list is cleared. Left open, the next pause would list them
   * again next to the new ones: the client asks the same question and repeats old
   * actions on every message.
   */
  private closePendingInteractions(session: AgentSession): void {
    const openIds = new Set(session.pendingInteractions.map((p) => p.tcId));
    for (const turn of session.turns) {
      for (const tc of turn.toolCalls) {
        if (openIds.has(tc.tcId) && !tc.rawResponse) {
          tc.rawResponse = PENDING_SUPERSEDED;
        }
      }
    }
    session.pendingInteractions = [];
  }

  private maybePauseForHumanInLoop(session: AgentSession, runTurnIndex: number): boolean {
    const limit =
      this.config.turns?.humanInLoopAfterTurns ??
      this.config.turns?.human_in_loop_after_turns ??
      null;
    if (limit == null || runTurnIndex + 1 < limit) {
      return false;
    }
    session.pendingInteractions.push(
      createPendingInteraction({
        tcId: "HITL",
        callId: "",
        toolName: "human_in_loop",
        args: {},
        kind: "elicitation",
      }),
    );
    return true;
  }

  private async emitHitlRequested(
    session: AgentSession,
    options: {
      kind: string;
      toolName?: string | null;
      tcId?: string | null;
      reason?: string;
      turnIndex?: number;
    },
  ): Promise<void> {
    const event: HumanInLoopRequestedEvent = {
      ...createBaseEvent(NexusEventType.HUMAN_IN_LOOP_REQUESTED, {
        sessionId: session.sessionId,
        agentId: this.config.name,
        turnIndex: options.turnIndex ?? 0,
      }),
      eventType: NexusEventType.HUMAN_IN_LOOP_REQUESTED,
      kind: options.kind,
      toolName: options.toolName ?? null,
      tcId: options.tcId ?? null,
      reason: options.reason ?? "",
    };
    await this.eventEmitter.emit(event);
  }

  private async invokeTurnEndHook(
    session: AgentSession,
    sessionTurnIndex: number,
    runTurnIndex: number,
    toolResults: Array<Record<string, unknown>>,
    finalResponse?: string | null,
  ): Promise<TurnDecision | null | undefined> {
    const hook = this.hooks.onTurnEnd;
    if (!hook) {
      return null;
    }
    const ctx: TurnContext = {
      session,
      turnIndex: sessionTurnIndex,
      runTurnIndex,
      toolResults,
      state: this.runContext.state ?? {},
      finalResponse: finalResponse ?? null,
    };
    try {
      return await hook(ctx);
    } catch (error) {
      console.warn("AgentRunner: on_turn_end hook failed:", error);
      return null;
    }
  }

  private streamEvent(
    eventType: AgentStreamEvent["eventType"],
    options: { content?: string | null; data?: Record<string, unknown> } = {},
  ): AgentStreamEvent {
    return createAgentStreamEvent(eventType, options);
  }

  private async callLlm(options: {
    stream: boolean;
    messages: Array<Record<string, unknown>>;
    toolSchemas: Array<Record<string, unknown>> | null;
    session: AgentSession;
    turnIndex: number;
  }): Promise<AsyncGenerator<AgentStreamEvent | LLMResponse>> {
    const { stream, messages, toolSchemas, session, turnIndex } = options;
    const started: LLMCallStartedEvent = {
      ...createBaseEvent(NexusEventType.LLM_CALL_STARTED, {
        sessionId: session.sessionId,
        agentId: this.config.name,
        turnIndex,
      }),
      eventType: NexusEventType.LLM_CALL_STARTED,
      provider: this.config.llm.provider,
      model: this.config.llm.model,
      messagesCount: messages.length,
    };
    await this.eventEmitter.emit(started);

    const llmStart = Date.now();
    const tools = toolSchemas?.length ? toolSchemas : null;

    async function* generator(runner: AgentRunner): AsyncGenerator<AgentStreamEvent | LLMResponse> {
      try {
        if (!stream) {
          const llmResponse = await runner.llmProxy.chat(messages, { tools });
          const completed: LLMCallCompletedEvent = {
            ...createBaseEvent(NexusEventType.LLM_CALL_COMPLETED, {
              sessionId: session.sessionId,
              agentId: runner.config.name,
              turnIndex,
            }),
            eventType: NexusEventType.LLM_CALL_COMPLETED,
            provider: runner.config.llm.provider,
            model: runner.config.llm.model,
            tokensIn: llmResponse.usage.promptTokens,
            tokensOut: llmResponse.usage.completionTokens,
            durationMs: Date.now() - llmStart,
          };
          await runner.eventEmitter.emit(completed);
          yield llmResponse;
          return;
        }

        const contentParts: string[] = [];
        const reasoningParts: string[] = [];
        const toolCallsAcc = new Map<number, { id?: string; name: string; arguments: string }>();
        let usage: TokenUsage = {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          cachedTokens: 0,
        };
        let finishReason = "stop";

        for await (const chunk of runner.llmProxy.chatStream(messages, { tools })) {
          runner.raiseIfCancelled();
          if (chunk.reasoning) {
            reasoningParts.push(chunk.reasoning);
            const streamEvent: LLMStreamChunkEvent = {
              ...createBaseEvent(NexusEventType.LLM_STREAM_CHUNK, {
                sessionId: session.sessionId,
                agentId: runner.config.name,
                turnIndex,
              }),
              eventType: NexusEventType.LLM_STREAM_CHUNK,
              provider: runner.config.llm.provider,
              model: runner.config.llm.model,
              turnIndex,
              reasoningDelta: chunk.reasoning,
              hasToolCallDelta: false,
            };
            await runner.eventEmitter.emit(streamEvent);
            yield runner.streamEvent("reasoning", {
              content: chunk.reasoning,
              data: { agentId: runner.config.name, turnIndex },
            });
          }
          if (chunk.content) {
            contentParts.push(chunk.content);
            const streamEvent: LLMStreamChunkEvent = {
              ...createBaseEvent(NexusEventType.LLM_STREAM_CHUNK, {
                sessionId: session.sessionId,
                agentId: runner.config.name,
                turnIndex,
              }),
              eventType: NexusEventType.LLM_STREAM_CHUNK,
              provider: runner.config.llm.provider,
              model: runner.config.llm.model,
              turnIndex,
              contentDelta: chunk.content,
              hasToolCallDelta: false,
            };
            await runner.eventEmitter.emit(streamEvent);
            yield runner.streamEvent("content", {
              content: chunk.content,
              data: { agentId: runner.config.name, turnIndex },
            });
          }
          if (chunk.toolCalls?.length) {
            for (const tcDelta of chunk.toolCalls) {
              mergeToolCallDelta(toolCallsAcc, tcDelta);
            }
            const streamEvent: LLMStreamChunkEvent = {
              ...createBaseEvent(NexusEventType.LLM_STREAM_CHUNK, {
                sessionId: session.sessionId,
                agentId: runner.config.name,
                turnIndex,
              }),
              eventType: NexusEventType.LLM_STREAM_CHUNK,
              provider: runner.config.llm.provider,
              model: runner.config.llm.model,
              turnIndex,
              hasToolCallDelta: true,
            };
            await runner.eventEmitter.emit(streamEvent);
          }
          if (chunk.usage) {
            usage = chunk.usage;
          }
          if (chunk.finishReason) {
            finishReason = chunk.finishReason;
          }
        }

        const llmResponse: LLMResponse = {
          content: contentParts.length > 0 ? contentParts.join("") : null,
          reasoning: reasoningParts.length > 0 ? reasoningParts.join("") : null,
          toolCalls: toolCallsFromAccumulated(toolCallsAcc),
          usage,
          finishReason,
          rawResponse: {},
        };

        const completed: LLMCallCompletedEvent = {
          ...createBaseEvent(NexusEventType.LLM_CALL_COMPLETED, {
            sessionId: session.sessionId,
            agentId: runner.config.name,
            turnIndex,
          }),
          eventType: NexusEventType.LLM_CALL_COMPLETED,
          provider: runner.config.llm.provider,
          model: runner.config.llm.model,
          tokensIn: llmResponse.usage.promptTokens,
          tokensOut: llmResponse.usage.completionTokens,
          durationMs: Date.now() - llmStart,
        };
        await runner.eventEmitter.emit(completed);
        yield llmResponse;
      } catch (error) {
        if (error instanceof RunCancelled) {
          throw error;
        }
        const errEvent: LLMCallErrorEvent = {
          ...createBaseEvent(NexusEventType.LLM_CALL_ERROR, {
            sessionId: session.sessionId,
            agentId: runner.config.name,
            turnIndex,
          }),
          eventType: NexusEventType.LLM_CALL_ERROR,
          provider: runner.config.llm.provider,
          error: String(error),
        };
        await runner.eventEmitter.emit(errEvent);
        throw error;
      }
    }

    return generator(this);
  }

  private async *runLoop(options: {
    stream: boolean;
    state: LoopState;
    userMessage: string;
    sessionId?: string | null;
    initialContext?: Record<string, unknown> | null;
    maxTurns?: number | null;
  }): AsyncGenerator<AgentStreamEvent> {
    const { stream, state, userMessage, sessionId, initialContext, maxTurns } = options;
    this._cancelRequested = false;

    let session = await this.getOrCreateSession(sessionId);
    this.userMemory = await this.loadUserMemory();
    this.streamSeq = session.streamSeq ?? 0;
    this.bindLoopSession(session);
    session.rcsEnabled = false;
    if (userMessage && session.pendingInteractions.length > 0) {
      this.closePendingInteractions(session);
    }
    await this.maybeSaveSession(session);
    this.resolveToolsets();
    this.hydrateStateFromSession(session, initialContext);
    if (initialContext) {
      session.metadata = { ...session.metadata, ...initialContext };
      await this.maybeSaveSession(session);
    }

    const started: AgentStartedEvent = {
      ...createBaseEvent(NexusEventType.AGENT_STARTED, {
        sessionId: session.sessionId,
        agentId: this.config.name,
      }),
      eventType: NexusEventType.AGENT_STARTED,
      agentName: this.config.name,
      userMessage,
    };
    await this.eventEmitter.emit(started);

    if (stream) {
      yield this.streamEvent("event", {
        content: "Agent started execution.",
        data: { agentId: this.config.name, sessionId: session.sessionId },
      });
    }

    const startTime = Date.now();
    let sessionTurnIndex = session.turns.length;
    let runTurnIndex = 0;
    let status: AgentRunStatus = "completed";
    let errorMsg: string | null = null;
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let finalResp: string | null | undefined = null;
    let structuredResult: Record<string, unknown> | null = null;
    let structRetriesRemaining =
      this.config.structuredOutputMaxRetries ?? this.config.structured_output_max_retries ?? 2;
    const turnDefaults = defaultTurnConfig();
    let turnLimit =
      this.config.turns?.max_turns ?? this.config.turns?.maxTurns ?? turnDefaults.maxTurns ?? 10;
    if (maxTurns != null) {
      turnLimit = Math.min(turnLimit, maxTurns);
    }

    let currentUserMessage = userMessage;

    try {
      while (runTurnIndex < turnLimit) {
        this.raiseIfCancelled();
        const turnStartedAt = Date.now();
        const turnUserMsg = runTurnIndex === 0 ? currentUserMessage : null;
        let messages = await this.buildContextMessages(session, turnUserMsg);
        const recurringSavingsThisTurn = this.ctxBuilder.countRcsSavings(messages, session, this.config);
        session.cumulativeInputTokensSavedByRcs =
          (session.cumulativeInputTokensSavedByRcs ?? 0) + recurringSavingsThisTurn;

        const turnStarted: TurnStartedEvent = {
          ...createBaseEvent(NexusEventType.TURN_STARTED, {
            sessionId: session.sessionId,
            agentId: this.config.name,
            turnIndex: sessionTurnIndex,
          }),
          eventType: NexusEventType.TURN_STARTED,
          turnIndex: sessionTurnIndex,
          userMessage: runTurnIndex === 0 ? currentUserMessage : null,
        };
        await this.eventEmitter.emit(turnStarted);

        if (stream) {
          yield this.streamEvent("event", {
            content: `Turn ${sessionTurnIndex} started.`,
            data: { agentId: this.config.name, turnIndex: sessionTurnIndex },
          });
        }

        const toolSchemas = filterSchemasByTools(
          this.toolRegistry.getToolSchemasForLlm(
            this.allowedTools != null ? null : this.config.tool_plugins,
            this.config.rcs,
          ),
          this.allowedTools,
        );

        if (this.hooks.beforeLLMCall) {
          const hookCtx: LLMCallContext = {
            session,
            turnIndex: sessionTurnIndex,
            messages,
            runContext: this.runContext,
          };
          try {
            const modified = await this.hooks.beforeLLMCall(hookCtx);
            if (modified) {
              messages = modified;
            }
          } catch (error) {
            console.warn("AgentRunner: before_llm_call hook failed:", error);
          }
        }

        let llmResponse: LLMResponse | null = null;
        const llmIterator = await this.callLlm({
          stream,
          messages,
          toolSchemas,
          session,
          turnIndex: sessionTurnIndex,
        });
        for await (const item of llmIterator) {
          if ("eventType" in item) {
            yield item;
          } else {
            llmResponse = item;
          }
        }

        if (!llmResponse) {
          throw new Error("LLM call did not return a response");
        }

        llmResponse = promoteContentToolCalls(llmResponse);
        if (llmResponse.toolCalls.length > 0) {
          const limited = this.limitToolCalls(llmResponse.toolCalls);
          if (limited.length !== llmResponse.toolCalls.length) {
            llmResponse = { ...llmResponse, toolCalls: limited };
          }
        }

        totalTokensIn += llmResponse.usage.promptTokens;
        totalTokensOut += llmResponse.usage.completionTokens;

        let turnStructured: Record<string, unknown> | null = null;
        const resultType = (this.config.resultType ?? this.config.result_type) as
          | StructuredResultSchema
          | undefined;
        if (llmResponse.toolCalls.length === 0 && resultType && typeof resultType !== "string") {
          try {
            turnStructured = validateStructuredResult(llmResponse.content, resultType);
            structuredResult = turnStructured;
            structRetriesRemaining = this.config.structuredOutputMaxRetries ?? 2;
          } catch (error) {
            if (structRetriesRemaining > 0) {
              structRetriesRemaining -= 1;
              currentUserMessage = formatValidationRetryMessage(
                error instanceof ValidationError
                  ? error
                  : new ValidationError(String(error), error),
              );
              continue;
            }
            throw error;
          }
        }

        if (
          turnStructured &&
          (this.config.turns?.stopOnResultType ?? turnDefaults.stopOnResultType) &&
          llmResponse.toolCalls.length === 0
        ) {
          finalResp = llmResponse.content ?? null;
        }

        if (
          llmResponse.toolCalls.length === 0 &&
          (this.config.turns?.stopOnEmptyToolCalls ?? turnDefaults.stopOnEmptyToolCalls)
        ) {
          finalResp = llmResponse.content ?? null;
          const finalTurn = createTurnRecord({
            turnIndex: sessionTurnIndex,
            userMessage: runTurnIndex === 0 ? currentUserMessage : null,
            llmMessages: [
              buildAssistantLlmMessage({
                content: llmResponse.content,
                toolCalls: llmResponse.toolCalls,
              }),
            ],
            reasoning: llmResponse.reasoning,
            toolCalls: [],
            totalTokensIn: llmResponse.usage.promptTokens,
            totalTokensOut: llmResponse.usage.completionTokens,
            recurringSavingsThisTurn: recurringSavingsThisTurn,
            durationMs: Date.now() - startTime,
            status: "completed",
          });
          session = await this.persistTurnWithState(session, finalTurn);
          session = await this.maybeCurateAfterTurn(session, sessionTurnIndex);

          const decision = await this.invokeTurnEndHook(session, sessionTurnIndex, runTurnIndex, [], finalResp);
          if (decision?.action === "stop") {
            status = "interrupted";
            break;
          }
          if (decision?.action === "inject" && decision.message) {
            currentUserMessage = decision.message;
            sessionTurnIndex += 1;
            runTurnIndex += 1;
            continue;
          }

          if (this.maybePauseForHumanInLoop(session, runTurnIndex)) {
            status = "paused";
            await this.emitHitlRequested(session, {
              kind: "human_in_loop",
              toolName: "human_in_loop",
              tcId: "HITL",
              reason: `Paused after ${runTurnIndex + 1} turns`,
              turnIndex: sessionTurnIndex,
            });
            await this.maybeSaveSession(session);
            if (stream) {
              yield this.streamEvent("paused", {
                data: {
                  sessionId: session.sessionId,
                  pendingInteractions: session.pendingInteractions.map(pendingInteractionToJson),
                },
              });
            }
            break;
          }

          sessionTurnIndex += 1;
          runTurnIndex += 1;
          if (structuredResult && (this.config.turns?.stopOnResultType ?? turnDefaults.stopOnResultType)) {
            break;
          }
          break;
        }

        const turnToolRecords: ToolCallRecord[] = [];

        const handleTool = async (
          tcReq: ToolCallRequest,
          activeSession: AgentSession,
          activeTurnIndex: number,
        ): Promise<{ record: ToolCallRecord; paused: boolean }> => {
          const tcIndex = nextTcIndex(activeSession);
          const tcId = `TC${tcIndex}`;
          const callId = tcReq.id || "";
          let resolvedTool = tcReq.toolName;
          try {
            resolvedTool = this.toolRegistry.resolveToolName(tcReq.toolName);
          } catch {
            // keep original name
          }
          const execution = this.toolRegistry.getExecutionMode(resolvedTool);
          const needsApproval = this.toolRegistry.requiresApproval(resolvedTool);
          if (
            execution === "client" ||
            tcReq.toolName.endsWith("request_user_input") ||
            needsApproval
          ) {
            const kind = needsApproval
              ? "approval"
              : tcReq.toolName.endsWith("request_user_input")
                ? "elicitation"
                : "client_tool";
            const pending: PendingInteraction = createPendingInteraction({
              tcId,
              callId,
              toolName: tcReq.toolName,
              args: tcReq.toolInput,
              kind: kind as PendingInteraction["kind"],
            });
            activeSession.pendingInteractions.push(pending);
            await this.emitHitlRequested(activeSession, {
              kind,
              toolName: tcReq.toolName,
              tcId,
              turnIndex: activeTurnIndex,
            });
            status = "paused";
            return {
              record: createToolCallRecord({
                tcId,
                tcIndex,
                toolName: tcReq.toolName,
                callId,
                toolInput: tcReq.toolInput,
                rawResponse: "",
                tokensRaw: 0,
              }),
              paused: true,
            };
          }

          if (this.hooks.beforeToolCall) {
            const tctx: ToolCallContext = {
              session: activeSession,
              turnIndex: activeTurnIndex,
              toolName: tcReq.toolName,
              toolArgs: tcReq.toolInput,
              runContext: this.runContext,
              tcId,
            };
            try {
              await this.hooks.beforeToolCall(tctx);
            } catch (error) {
              console.warn("AgentRunner: before_tool_call hook failed:", error);
            }
          }

          let cleanArgs = tcReq.toolInput;
          try {
            const [intercepted] = await this.interceptor.intercept(
              tcReq.toolName,
              tcReq.toolInput,
              activeSession,
              activeTurnIndex,
              this.sessionManager,
              this.config.rcs,
            );
            cleanArgs = intercepted;
          } catch (error) {
            console.warn("AgentRunner: interceptor failed:", error);
          }

          const toolStart = Date.now();
          let resultStr: string;
          try {
            const parts = tcReq.toolName.split(".");
            const plugin = parts[0] ?? "";
            const tool = parts.slice(1).join(".") ?? "";
            const rawResult = await this.toolRegistry.execute(
              plugin,
              tool,
              cleanArgs,
              this.runContext,
            );
            resultStr = toolResultToString(rawResult);
            const completed: ToolCallCompletedEvent = {
              ...createBaseEvent(NexusEventType.TOOL_CALL_COMPLETED, {
                sessionId: activeSession.sessionId,
                agentId: this.config.name,
                turnIndex: activeTurnIndex,
              }),
              eventType: NexusEventType.TOOL_CALL_COMPLETED,
              toolName: tcReq.toolName,
              toolOutputLength: resultStr.length,
              durationMs: Date.now() - toolStart,
            };
            await this.eventEmitter.emit(completed);
          } catch (error) {
            resultStr = `Error executing tool ${tcReq.toolName}: ${String(error)}`;
            const errEvent: ToolCallErrorEvent = {
              ...createBaseEvent(NexusEventType.TOOL_CALL_ERROR, {
                sessionId: activeSession.sessionId,
                agentId: this.config.name,
                turnIndex: activeTurnIndex,
              }),
              eventType: NexusEventType.TOOL_CALL_ERROR,
              toolName: tcReq.toolName,
              error: String(error),
            };
            await this.eventEmitter.emit(errEvent);
          }

          if (this.hooks.afterToolCall) {
            try {
              await this.hooks.afterToolCall(
                {
                  session: activeSession,
                  turnIndex: activeTurnIndex,
                  toolName: tcReq.toolName,
                  toolArgs: cleanArgs,
                  runContext: this.runContext,
                  tcId,
                },
                resultStr,
              );
            } catch (error) {
              console.warn("AgentRunner: after_tool_call hook failed:", error);
            }
          }

          return {
            record: createToolCallRecord({
              tcId,
              tcIndex,
              toolName: tcReq.toolName,
              callId,
              toolInput: cleanArgs,
              rawResponse: resultStr,
              tokensRaw: TokenCounter.countString(resultStr, this.config.llm.model),
            }),
            paused: false,
          };
        };

        let pausedThisTurn = false;
        for (const tcReq of llmResponse.toolCalls) {
          this.raiseIfCancelled();
          const startedTool: ToolCallStartedEvent = {
            ...createBaseEvent(NexusEventType.TOOL_CALL_STARTED, {
              sessionId: session.sessionId,
              agentId: this.config.name,
              turnIndex: sessionTurnIndex,
            }),
            eventType: NexusEventType.TOOL_CALL_STARTED,
            toolName: tcReq.toolName,
            toolArgs: tcReq.toolInput,
          };
          await this.eventEmitter.emit(startedTool);
          if (stream) {
            yield this.streamEvent("tool_call", {
              data: {
                agentId: this.config.name,
                turnIndex: sessionTurnIndex,
                toolName: tcReq.toolName,
                toolArgs: tcReq.toolInput,
              },
            });
          }
          const { record, paused } = await handleTool(tcReq, session, sessionTurnIndex);
          turnToolRecords.push(record);
          if (stream && record.rawResponse) {
            yield this.streamEvent("tool_result", {
              content: record.rawResponse,
              data: {
                agentId: this.config.name,
                turnIndex: sessionTurnIndex,
                toolName: tcReq.toolName,
                tcId: record.tcId,
              },
            });
          }
          if (paused) {
            pausedThisTurn = true;
            if (stream) {
              yield this.streamEvent("paused", {
                data: {
                  sessionId: session.sessionId,
                  pendingInteractions: session.pendingInteractions.map(pendingInteractionToJson),
                },
              });
            }
            break;
          }
        }

        const turnRecord = createTurnRecord({
          turnIndex: sessionTurnIndex,
          userMessage: runTurnIndex === 0 ? currentUserMessage : null,
          llmMessages: [
            buildAssistantLlmMessage({
              content: llmResponse.content,
              toolCalls: llmResponse.toolCalls,
            }),
          ],
          reasoning: llmResponse.reasoning,
          toolCalls: turnToolRecords,
          totalTokensIn: llmResponse.usage.promptTokens,
          totalTokensOut: llmResponse.usage.completionTokens,
          recurringSavingsThisTurn: recurringSavingsThisTurn,
          durationMs: Date.now() - startTime,
          status: pausedThisTurn ? "paused" : "completed",
        });

        session = await this.persistTurnWithState(session, turnRecord);
        session = await this.maybeCurateAfterTurn(session, sessionTurnIndex);
        if (pausedThisTurn) {
          status = "paused";
          await this.maybeSaveSession(session);
          break;
        }

        const toolResultSummaries = turnToolRecords.map((tc) => ({
          tool_name: tc.toolName,
          content: tc.rawResponse,
        }));
        const turnFinal = llmResponse.toolCalls.length === 0 ? llmResponse.content : null;

        const turnCompleted: TurnCompletedEvent = {
          ...createBaseEvent(NexusEventType.TURN_COMPLETED, {
            sessionId: session.sessionId,
            agentId: this.config.name,
            turnIndex: sessionTurnIndex,
          }),
          eventType: NexusEventType.TURN_COMPLETED,
          turnIndex: sessionTurnIndex,
          toolCallsCount: turnToolRecords.length,
          tokensIn: llmResponse.usage.promptTokens,
          tokensOut: llmResponse.usage.completionTokens,
          recurringSavings: recurringSavingsThisTurn,
          durationMs: Date.now() - startTime,
        };
        await this.eventEmitter.emit(turnCompleted);

        const decision = await this.invokeTurnEndHook(
          session,
          sessionTurnIndex,
          runTurnIndex,
          toolResultSummaries,
          turnFinal,
        );
        if (decision?.action === "stop") {
          status = "interrupted";
          break;
        }
        if (decision?.action === "inject" && decision.message) {
          currentUserMessage = decision.message;
          sessionTurnIndex += 1;
          runTurnIndex += 1;
          continue;
        }

        if (this.maybePauseForHumanInLoop(session, runTurnIndex)) {
          status = "paused";
          await this.emitHitlRequested(session, {
            kind: "human_in_loop",
            toolName: "human_in_loop",
            tcId: "HITL",
            reason: `Paused after ${runTurnIndex + 1} turns`,
            turnIndex: sessionTurnIndex,
          });
          await this.maybeSaveSession(session);
          if (stream) {
            yield this.streamEvent("paused", {
              data: {
                sessionId: session.sessionId,
                pendingInteractions: session.pendingInteractions.map(pendingInteractionToJson),
              },
            });
          }
          break;
        }

        const elapsedTurn = Date.now() - turnStartedAt;
        const turnTimeoutSeconds =
          this.config.turns?.turnTimeoutSeconds ??
          this.config.turns?.turn_timeout_seconds ??
          turnDefaults.turnTimeoutSeconds ??
          300;
        if (elapsedTurn > turnTimeoutSeconds * 1000) {
          throw new TurnTimeoutError(`Turn exceeded timeout of ${turnTimeoutSeconds}s`);
        }

        sessionTurnIndex += 1;
        runTurnIndex += 1;
      }

      if (runTurnIndex >= turnLimit) {
        status = "max_turns_reached";
      }
    } catch (error) {
      if (error instanceof TurnTimeoutError) {
        status = "error";
        errorMsg = error.message;
        const errEvent: AgentErrorEvent = {
          ...createBaseEvent(NexusEventType.AGENT_ERROR, {
            sessionId: session.sessionId,
            agentId: this.config.name,
          }),
          eventType: NexusEventType.AGENT_ERROR,
          error: errorMsg,
        };
        await this.eventEmitter.emit(errEvent);
        if (stream) {
          yield this.streamEvent("error", {
            content: errorMsg,
            data: { agentId: this.config.name, status: "error" },
          });
        }
      } else if (error instanceof RunCancelled) {
        status = "interrupted";
        if (stream) {
          yield this.streamEvent("event", {
            content: "Run cancelled.",
            data: { cancelled: true, status: "interrupted" },
          });
        }
      } else {
        status = "error";
        errorMsg = String(error);
        const errEvent: AgentErrorEvent = {
          ...createBaseEvent(NexusEventType.AGENT_ERROR, {
            sessionId: session.sessionId,
            agentId: this.config.name,
          }),
          eventType: NexusEventType.AGENT_ERROR,
          error: errorMsg,
        };
        await this.eventEmitter.emit(errEvent);
        if (stream) {
          yield this.streamEvent("error", {
            content: errorMsg,
            data: { agentId: this.config.name, status: "error" },
          });
        }
      }
    }

    if (finalResp == null && session.turns.length > 0) {
      const lastTurn = session.turns[session.turns.length - 1]!;
      for (const msg of lastTurn.llmMessages) {
        if (msg.role === "assistant" && msg.content) {
          finalResp = String(msg.content);
          break;
        }
      }
    }

    if (status !== "error" && this.memoryCurator.active) {
      const finalTurnIdx = Math.max(0, sessionTurnIndex - 1);
      session = await this.maybeCurateAfterTurn(session, finalTurnIdx, true);
    }

    const snapshot = this.jsonSafeState({ ...(this.runContext.state ?? {}) });
    session.state = snapshot;
    this.runContext.state = { ...snapshot };
    await this.maybeSaveSession(session);

    const runResult: AgentRunResult = {
      sessionId: session.sessionId,
      finalResponse: finalResp ?? null,
      structuredResult,
      turnsUsed: runTurnIndex,
      totalTokensIn,
      totalTokensOut,
      totalTokensSavedByRcs: session.totalTokensSavedByRcs ?? 0,
      cumulativeInputTokensSavedByRcs: session.cumulativeInputTokensSavedByRcs ?? 0,
      durationMs: Date.now() - startTime,
      status,
      error: errorMsg,
      pendingInteractions: session.pendingInteractions.map(pendingInteractionToJson),
      state: { ...snapshot },
    };
    state.result = runResult;

    const completed: AgentCompletedEvent = {
      ...createBaseEvent(NexusEventType.AGENT_COMPLETED, {
        sessionId: session.sessionId,
        agentId: this.config.name,
      }),
      eventType: NexusEventType.AGENT_COMPLETED,
      turnsUsed: runTurnIndex,
      totalTokensIn,
      totalTokensOut,
      totalTokensSavedByRcs: session.totalTokensSavedByRcs ?? 0,
      cumulativeTokensSavedByRcs: session.cumulativeInputTokensSavedByRcs ?? 0,
    };
    await this.eventEmitter.emit(completed);

    if (stream) {
      yield this.streamEvent("final_response", {
        content: finalResp ?? null,
        data: runResult as unknown as Record<string, unknown>,
      });
    }
  }

  async run(
    userMessageOrOptions:
      | string
      | {
          userMessage: string;
          sessionId?: string | null;
          initialContext?: Record<string, unknown> | null;
          stream?: boolean | null;
          maxTurns?: number | null;
        },
    extra: {
      sessionId?: string | null;
      initialContext?: Record<string, unknown> | null;
      stream?: boolean | null;
      maxTurns?: number | null;
    } = {},
  ): Promise<AgentRunResult> {
    const options =
      typeof userMessageOrOptions === "string"
        ? { userMessage: userMessageOrOptions, ...extra }
        : userMessageOrOptions;
    if (this.resolveStream(options.stream)) {
      throw new Error("Streaming mode enabled; use runStream() or pass stream=false.");
    }
    const state: LoopState = { result: null };
    for await (const _ of this.runLoop({
      stream: false,
      state,
      userMessage: options.userMessage,
      sessionId: options.sessionId,
      initialContext: options.initialContext,
      maxTurns: options.maxTurns,
    })) {
      // consume loop
    }
    if (!state.result) {
      throw new Error("Agent run did not produce a result");
    }
    return state.result;
  }

  async *runStream(
    userMessageOrOptions:
      | string
      | {
          userMessage: string;
          sessionId?: string | null;
          initialContext?: Record<string, unknown> | null;
          stream?: boolean | null;
          maxTurns?: number | null;
        },
    extra: {
      sessionId?: string | null;
      initialContext?: Record<string, unknown> | null;
      stream?: boolean | null;
      maxTurns?: number | null;
    } = {},
  ): AsyncGenerator<AgentStreamEvent> {
    const options =
      typeof userMessageOrOptions === "string"
        ? { userMessage: userMessageOrOptions, ...extra }
        : userMessageOrOptions;
    if (!this.resolveStream(options.stream ?? true)) {
      throw new Error("Non-streaming mode; use run() or pass stream=true.");
    }
    const state: LoopState = { result: null };
    for await (const event of this.runLoop({
      stream: true,
      state,
      userMessage: options.userMessage,
      sessionId: options.sessionId,
      initialContext: options.initialContext,
      maxTurns: options.maxTurns,
    })) {
      yield this.numberStreamEvent(event);
    }
    if (this.loopSession) {
      this.loopSession.streamSeq = this.streamSeq;
      await this.maybeSaveSession(this.loopSession);
    }
    if (!state.result) {
      throw new Error("Agent run did not produce a result");
    }
  }

  async resume(
    sessionIdOrOptions:
      | string
      | {
          sessionId: string;
          results: Array<Record<string, unknown>>;
          stream?: boolean | null;
        },
    results: Array<Record<string, unknown>> = [],
    extra: { stream?: boolean | null } = {},
  ): Promise<AgentRunResult> {
    const options =
      typeof sessionIdOrOptions === "string"
        ? { sessionId: sessionIdOrOptions, results, stream: extra.stream }
        : sessionIdOrOptions;
    const session = await this.sessionManager.loadSession(options.sessionId, {
      scope: this.sessionScope(),
    });
    if (!session) {
      throw new Error(`Session not found: ${options.sessionId}`);
    }
    if (session.pendingInteractions.length === 0) {
      throw new Error("Session has no pending interactions to resume");
    }

    const byTc = new Map<string, Record<string, unknown>>();
    const byCall = new Map<string, Record<string, unknown>>();
    for (const result of options.results) {
      const tcId = result.tc_id ?? result.tcId;
      const callId = result.call_id ?? result.callId;
      if (tcId) {
        byTc.set(String(tcId), result);
      }
      if (callId) {
        byCall.set(String(callId), result);
      }
    }

    for (const pending of [...session.pendingInteractions]) {
      const match = byTc.get(pending.tcId) ?? byCall.get(pending.callId);
      const content = match?.content ?? "";
      const responseEvent: HumanInLoopResponseEvent = {
        ...createBaseEvent(NexusEventType.HUMAN_IN_LOOP_RESPONSE, {
          sessionId: options.sessionId,
          agentId: this.config.name,
        }),
        eventType: NexusEventType.HUMAN_IN_LOOP_RESPONSE,
        tcId: pending.tcId,
        kind: pending.kind,
      };
      await this.eventEmitter.emit(responseEvent);
      for (const turn of [...session.turns].reverse()) {
        for (const tc of turn.toolCalls) {
          if (tc.tcId === pending.tcId && !tc.rawResponse) {
            tc.rawResponse = String(content);
            break;
          }
        }
      }
    }
    session.pendingInteractions = [];
    await this.maybeSaveSession(session);

    if (this.resolveStream(options.stream)) {
      const state: LoopState = { result: null };
      for await (const _ of this.runLoop({
        stream: true,
        state,
        userMessage: "",
        sessionId: options.sessionId,
        initialContext: null,
      })) {
        // consume stream
      }
      if (!state.result) {
        throw new Error("Agent resume did not produce a result");
      }
      return state.result;
    }

    return this.run({
      userMessage: "",
      sessionId: options.sessionId,
      stream: false,
    });
  }
}

function buildSyncMemoryProvider(
  memory: AgentConfig["memory"] | undefined,
  store: CrossSessionMemoryStore | null,
  agentName: string,
): MemoryProvider | null {
  if (!memory?.provider) return null;
  if (memory.provider === "custom_class") return null;
  if (memory.provider === "mem0" || memory.provider === "honcho") return null;
  if (!store) return null;
  return new BuiltInSemanticMemoryProvider(store, memory, { agentName });
}

function trimToCharBudget(
  entities: Record<string, string>,
  budget: number,
): Record<string, string> {
  if (!budget || budget <= 0) return entities;
  const kept: Record<string, string> = {};
  let used = 0;
  for (const [key, value] of Object.entries(entities)) {
    const line = `${key}: ${value}`;
    if (used + line.length > budget && Object.keys(kept).length > 0) break;
    kept[key] = value;
    used += line.length;
  }
  return kept;
}
