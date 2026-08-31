/** Context window builder for the Nexus Agent Framework. */

import type { AgentConfig } from "../config/agent.js";
import type { MemoryConfig } from "../config/memory.js";
import type { ContextSummaryConfig } from "../config/context-summary.js";
import {
  EMPTY_ASSISTANT_PLACEHOLDER,
  sanitizeAssistantLlmMessage,
} from "../llm/content-tool-calls.js";
import { TokenCounter } from "../llm/token-counter.js";
import type { AgentSession, ToolCallRecord, TurnRecord } from "../session/models.js";
import type { RunContext } from "../tools/context.js";
import { renderSystemPrompt } from "../utils/jinja.js";
import { MemoryPromptInjector } from "./memory-injector.js";
import { RCSSystemPromptInjector } from "./rcs-injector.js";
import { SummaryPromptInjector } from "./summary-injector.js";
import { NexusEventType } from "../events/models.js";

export interface ChatMessage {
  role: string;
  content?: string | null;
  tool_calls?: Array<Record<string, unknown>>;
  tool_call_id?: string;
  [key: string]: unknown;
}

export interface EventEmitterLike {
  emit(event: unknown): Promise<void>;
}

export interface BuildContextOptions {
  session: AgentSession;
  agentConfig: AgentConfig;
  currentUserMessage?: string | null;
  tokenBudget?: number;
  userMemory?: Record<string, string> | null;
  summaryText?: string;
  runContext?: RunContext | null;
  skillsCatalog?: string | null;
  explicitSkillsContent?: string | null;
  extraVars?: Record<string, unknown> | null;
}

const FALLBACK_USER_MESSAGE = "Continue.";

const OVERSIZED_TOOL_RESULT_NOTICE =
  "Result not included: it was {tokens} tokens, which does not fit the remaining " +
  "context budget. Re-run this tool with a narrower scope (shorter date range, " +
  "fewer rows or columns, filters, or pagination), or use a tool that returns " +
  "aggregates instead of raw records.";

export class ContextWindowBuilder {
  eventEmitter: EventEmitterLike | null;
  lastUntrimmedTokens = 0;

  constructor(eventEmitter: EventEmitterLike | null = null) {
    this.eventEmitter = eventEmitter;
  }

  private static formatToolSignature(
    tc: ToolCallRecord,
    includeSignature: boolean,
  ): string {
    if (!includeSignature) return "";
    const args = Object.entries(tc.toolInput ?? {})
      .filter(([k]) => k !== "_context_updates")
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(", ");
    return `${tc.toolName}(${args})`;
  }

  private static summaryText(tc: ToolCallRecord): string {
    const summary = (tc.summarizedResponse ?? "").trim();
    return summary === "[]" ? "" : summary;
  }

  private static coalesceConsecutiveAssistants(messages: ChatMessage[]): ChatMessage[] {
    const out: ChatMessage[] = [];
    for (const msg of messages) {
      const prev = out[out.length - 1];
      const mergeable =
        prev != null &&
        prev.role === "assistant" &&
        msg.role === "assistant" &&
        !prev.tool_calls?.length &&
        !msg.tool_calls?.length &&
        typeof prev.content === "string" &&
        typeof msg.content === "string";

      if (!mergeable) {
        out.push({ ...msg });
        continue;
      }

      const joined = [prev.content?.trim(), msg.content?.trim()]
        .filter(Boolean)
        .join("\n\n");
      out[out.length - 1] = { ...prev, content: joined || prev.content };
    }
    return out;
  }

  private static overflowNotice(tokens: number): string {
    return OVERSIZED_TOOL_RESULT_NOTICE.replace("{tokens}", String(tokens));
  }

  private static hasBareUserMessage(messages: ChatMessage[]): boolean {
    for (const msg of messages) {
      if (msg.role !== "user") continue;
      if (typeof msg.content === "string" && msg.content.trim()) {
        return true;
      }
    }
    return false;
  }

  private static ensureUserQuery(
    messages: ChatMessage[],
    anchor: string | null | undefined,
  ): ChatMessage[] {
    if (ContextWindowBuilder.hasBareUserMessage(messages)) {
      return messages;
    }
    const text = (anchor ?? "").trim() || FALLBACK_USER_MESSAGE;
    const userMsg: ChatMessage = { role: "user", content: text };
    if (messages[0]?.role === "system") {
      return [messages[0], userMsg, ...messages.slice(1)];
    }
    return [userMsg, ...messages];
  }

  private degradeOldestTool(
    turns: TurnRecord[],
    degradedTcIds: Set<string>,
  ): boolean {
    for (const turn of turns) {
      for (const tc of turn.toolCalls) {
        if (degradedTcIds.has(tc.tcId)) continue;
        if (ContextWindowBuilder.summaryText(tc)) continue;
        degradedTcIds.add(tc.tcId);
        return true;
      }
    }
    return false;
  }

  private turnToMessages(
    turn: TurnRecord,
    opts: {
      rcsEnabled: boolean;
      tcTagFormat: string;
      includeSignature: boolean;
      degradedTcIds: Set<string>;
    },
  ): ChatMessage[] {
    const turnMessages: ChatMessage[] = [];

    if (turn.userMessage) {
      turnMessages.push({ role: "user", content: turn.userMessage });
    }

    for (const msg of turn.llmMessages) {
      let msgCopy = structuredClone(msg) as ChatMessage;
      if (msgCopy.role === "assistant") {
        msgCopy = sanitizeAssistantLlmMessage(msgCopy, {
          placeholder: EMPTY_ASSISTANT_PLACEHOLDER,
        }) as ChatMessage;
      }
      turnMessages.push(msgCopy);
    }

    for (let tcIdx = 0; tcIdx < turn.toolCalls.length; tcIdx++) {
      const tc = turn.toolCalls[tcIdx]!;
      const content = this.renderToolMessage(tc, {
        rcsEnabled: opts.rcsEnabled,
        tcTagFormat: opts.tcTagFormat,
        includeSignature: opts.includeSignature,
        degraded: opts.degradedTcIds.has(tc.tcId),
      });

      let toolCallId = `call_${tc.tcId}`;
      for (const msg of turn.llmMessages) {
        if (msg.role === "assistant" && msg.tool_calls) {
          const calls = msg.tool_calls as Array<{ id?: string }>;
          if (tcIdx < calls.length) {
            toolCallId = calls[tcIdx]?.id ?? toolCallId;
          }
        }
      }

      turnMessages.push({
        role: "tool",
        tool_call_id: toolCallId,
        content,
      });
    }

    return turnMessages;
  }

  private renderToolMessage(
    tc: ToolCallRecord,
    opts: {
      rcsEnabled: boolean;
      tcTagFormat: string;
      includeSignature: boolean;
      degraded?: boolean;
    },
  ): string {
    if (opts.degraded) {
      const tokens =
        tc.tokensRaw || TokenCounter.countString(tc.rawResponse);
      const notice = ContextWindowBuilder.overflowNotice(tokens);
      if (opts.rcsEnabled) {
        const tag = opts.tcTagFormat.replace("{n}", String(tc.tcIndex));
        const signature = ContextWindowBuilder.formatToolSignature(
          tc,
          opts.includeSignature,
        );
        const prefix = signature ? `${tag} ${signature}\n` : `${tag}\n`;
        return `${prefix}${notice}`;
      }
      return notice;
    }

    const summary = ContextWindowBuilder.summaryText(tc);
    if (summary) {
      const signature = ContextWindowBuilder.formatToolSignature(
        tc,
        opts.includeSignature,
      );
      return signature ? `${signature}\n${summary}` : summary;
    }

    if (opts.rcsEnabled) {
      const tag = opts.tcTagFormat.replace("{n}", String(tc.tcIndex));
      const signature = ContextWindowBuilder.formatToolSignature(
        tc,
        opts.includeSignature,
      );
      const prefix = signature ? `${tag} ${signature}\n` : `${tag}\n`;
      return `${prefix}${tc.rawResponse}`;
    }

    return tc.rawResponse;
  }

  private buildToolContext(
    turns: TurnRecord[],
    opts: {
      rcsEnabled: boolean;
      tcTagFormat: string;
      includeSignature: boolean;
      degradedTcIds: Set<string>;
    },
  ): Array<{ tcId: string; toolName: string; mode: "raw" | "summarized"; text: string }> {
    const out: Array<{ tcId: string; toolName: string; mode: "raw" | "summarized"; text: string }> = [];
    for (const turn of turns) {
      for (const tc of turn.toolCalls) {
        const summary = ContextWindowBuilder.summaryText(tc);
        out.push({
          tcId: opts.rcsEnabled
            ? opts.tcTagFormat.replace("{n}", String(tc.tcIndex))
            : tc.tcId,
          toolName: tc.toolName,
          mode: summary ? "summarized" : "raw",
          text: this.renderToolMessage(tc, {
            rcsEnabled: opts.rcsEnabled,
            tcTagFormat: opts.tcTagFormat,
            includeSignature: opts.includeSignature,
            degraded: opts.degradedTcIds.has(tc.tcId),
          }),
        });
      }
    }
    return out;
  }

  async build(options: BuildContextOptions): Promise<Array<Record<string, unknown>>> {
    const {
      session,
      agentConfig,
      currentUserMessage = null,
      tokenBudget = agentConfig.llm.context_window_tokens ?? 100_000,
      userMemory = null,
      summaryText = session.summaryText ?? "",
      runContext = null,
      skillsCatalog = null,
      explicitSkillsContent = null,
      extraVars = null,
    } = options;

    const rcsEnabled = agentConfig.rcs?.enabled ?? false;
    const tcTagFormat = agentConfig.rcs?.tc_tag_format ?? "[TC{n}]";
    const includeSignature = agentConfig.rcs?.tc_tag_include_tool_signature ?? true;

    const persona = agentConfig.persona ?? {};
    const memoryCfg = agentConfig.memory as MemoryConfig | undefined;
    const summaryCfg = agentConfig.context_summary as ContextSummaryConfig | undefined;
    const facts = userMemory ?? {};

    const memoryForJinja =
      memoryCfg?.enabled && memoryCfg.inject_into_prompt ? facts : {};

    let summaryForJinja = "";
    if (summaryCfg?.summarize_on != null && summaryCfg.inject_into_prompt) {
      summaryForJinja = summaryText || "";
    }

    const template =
      persona.system_prompt ?? persona.system_prompt_template;

    let systemContent = renderSystemPrompt({
      persona: persona as Record<string, unknown>,
      userMemory: memoryForJinja,
      summaryText: summaryForJinja,
      currentDate: new Date().toISOString().slice(0, 10),
      template,
      runContext,
      session,
      extraVars,
    });

    systemContent = MemoryPromptInjector.inject(systemContent, facts, memoryCfg);
    systemContent = SummaryPromptInjector.inject(
      systemContent,
      summaryText || "",
      summaryCfg,
    );

    if (rcsEnabled && agentConfig.rcs) {
      systemContent = RCSSystemPromptInjector.inject(systemContent, agentConfig.rcs);
    }

    if (explicitSkillsContent) {
      systemContent = `${systemContent}\n\n${explicitSkillsContent}`;
    }
    if (skillsCatalog) {
      systemContent = `${systemContent}\n\n${skillsCatalog}`;
    }

    const systemMessage: ChatMessage = { role: "system", content: systemContent };

    let turnsInWindow = [...session.turns];
    const degradedTcIds = new Set<string>();
    let turnsDropped = 0;
    const model = agentConfig.llm?.model ?? "gpt-4o";

    const anchorUserMessage =
      currentUserMessage ??
      [...session.turns].reverse().find((t) => t.userMessage)?.userMessage ??
      null;

    const currentMessages: ChatMessage[] = [];
    if (currentUserMessage) {
      currentMessages.push({ role: "user", content: currentUserMessage });
    }

    this.lastUntrimmedTokens = 0;
    let flatHistory: ChatMessage[] = [];

    while (true) {
      flatHistory = [];
      for (const turn of turnsInWindow) {
        flatHistory.push(
          ...this.turnToMessages(turn, {
            rcsEnabled,
            tcTagFormat,
            includeSignature,
            degradedTcIds,
          }),
        );
      }

      const fullMessages = [systemMessage, ...flatHistory, ...currentMessages];
      const totalTokens = TokenCounter.countMessages(fullMessages, model);

      if (this.lastUntrimmedTokens === 0) {
        this.lastUntrimmedTokens = totalTokens;
      }

      if (totalTokens <= tokenBudget) {
        break;
      }

      if (this.degradeOldestTool(turnsInWindow, degradedTcIds)) {
        continue;
      }

      if (turnsInWindow.length) {
        turnsInWindow.shift();
        turnsDropped += 1;
        continue;
      }

      break;
    }

    if (degradedTcIds.size || turnsDropped) {
      console.warn(
        `Context window over budget (${this.lastUntrimmedTokens} > ${tokenBudget}): ` +
          `degraded ${degradedTcIds.size} tool result(s), dropped ${turnsDropped} turn(s).`,
      );
    }

    const finalMessages = ContextWindowBuilder.coalesceConsecutiveAssistants(
      ContextWindowBuilder.ensureUserQuery(
        [systemMessage, ...flatHistory, ...currentMessages],
        anchorUserMessage,
      ),
    );

    if (this.eventEmitter) {
      const allTcs = session.turns.flatMap((t) => t.toolCalls);
      const tcSummarizedCount = allTcs.filter((tc) =>
        ContextWindowBuilder.summaryText(tc),
      ).length;
      const tcTagsCount = allTcs.length - tcSummarizedCount;

      await this.eventEmitter.emit({
        eventType: NexusEventType.RCS_CONTEXT_BUILT,
        sessionId: session.sessionId,
        agentId: session.agentId,
        contextTokens: TokenCounter.countMessages(finalMessages, model),
        untrimmedTokens: this.lastUntrimmedTokens,
        turnsInContext: turnsInWindow.length,
        tcTagsCount,
        tcSummarizedCount,
        toolsDegradedCount: degradedTcIds.size,
        turnsDropped,
        systemPrompt: systemContent,
        toolContext: this.buildToolContext(turnsInWindow, {
          rcsEnabled,
          tcTagFormat,
          includeSignature,
          degradedTcIds,
        }),
      });
    }

    return finalMessages;
  }

  countRcsSavings(
    messages: Array<Record<string, unknown>>,
    session: AgentSession,
    agentConfig: AgentConfig,
  ): number {
    if (!agentConfig.rcs?.enabled) {
      return 0;
    }

    const model = agentConfig.llm?.model ?? "gpt-4o";
    const tcTagFormat = agentConfig.rcs?.tc_tag_format ?? "[TC{n}]";
    const includeSignature = agentConfig.rcs?.tc_tag_include_tool_signature ?? true;

    const tcByCallId = new Map<string, ToolCallRecord>();
    for (const turn of session.turns) {
      for (const tc of turn.toolCalls) {
        if (tc.callId) {
          tcByCallId.set(tc.callId, tc);
        }
      }
    }

    let totalSavings = 0;

    for (const msg of messages) {
      if (msg.role !== "tool") continue;
      const callId = msg.tool_call_id as string | undefined;
      const tc = callId ? tcByCallId.get(callId) : undefined;
      if (!tc || !ContextWindowBuilder.summaryText(tc)) continue;

      const actualContent = String(msg.content ?? "");
      const actualTokens = TokenCounter.countString(actualContent, model);

      const tag = tcTagFormat.replace("{n}", String(tc.tcIndex));
      const signature = ContextWindowBuilder.formatToolSignature(
        tc,
        includeSignature,
      );
      const counterfactualPrefix = signature ? `${tag} ${signature}\n` : `${tag}\n`;
      const counterfactualContent = `${counterfactualPrefix}${tc.rawResponse}`;
      const counterfactualTokens = TokenCounter.countString(
        counterfactualContent,
        model,
      );

      totalSavings += Math.max(0, counterfactualTokens - actualTokens);
    }

    return totalSavings;
  }
}
