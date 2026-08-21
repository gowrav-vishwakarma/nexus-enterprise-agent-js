/** Server compactor fallback for context window overflow. */

import { DEFAULT_COMPACTOR_PROMPT } from "../config/defaults.js";
import type { ServerCompactorConfig } from "../config/rcs.js";
import { createBaseEvent, NexusEventType } from "../events/models.js";
import { LLMProxy } from "../llm/proxy.js";
import { TokenCounter } from "../llm/token-counter.js";
import type { AgentSession, ToolCallRecord } from "../session/models.js";

export interface EventEmitterLike {
  emit(event: unknown): Promise<void>;
}

export interface CompactorStorage {
  updateTcSummary?(
    sessionId: string,
    tcId: string,
    summarizedResponse: string,
    summarizedByTurn: number,
    scope?: unknown,
  ): Promise<void>;
}

export interface CompactResult {
  tcsCompacted: string[];
  tokensSaved: number;
}

export class ServerCompactor {
  readonly config: ServerCompactorConfig;
  readonly llmProxy: LLMProxy;
  readonly storage: CompactorStorage;
  readonly eventEmitter: EventEmitterLike | null;

  constructor(
    config: ServerCompactorConfig,
    llmProxy: LLMProxy,
    storageAdapter: CompactorStorage,
    eventEmitter?: EventEmitterLike | null,
  ) {
    this.config = config;
    this.llmProxy = llmProxy;
    this.storage = storageAdapter;
    this.eventEmitter = eventEmitter ?? null;
  }

  async shouldTrigger(session: AgentSession, currentContextTokens: number): Promise<boolean> {
    if (!this.config.enabled) {
      return false;
    }
    if (currentContextTokens < this.config.trigger_token_threshold) {
      return false;
    }
    return session.turns.some((turn) =>
      turn.toolCalls.some((tc) => tc.summarizedResponse == null),
    );
  }

  async compact(session: AgentSession, currentTurnIndex: number): Promise<CompactResult> {
    if (this.eventEmitter) {
      await this.eventEmitter.emit(
        createBaseEvent(NexusEventType.RCS_COMPACTOR_TRIGGERED, {
          sessionId: session.sessionId,
          agentId: session.agentId,
          turnIndex: currentTurnIndex,
          data: { threshold: this.config.trigger_token_threshold },
        }),
      );
    }

    const unsummarized: Array<{ tc: ToolCallRecord; turnIndex: number }> = [];
    for (const turn of session.turns) {
      for (const tc of turn.toolCalls) {
        if (tc.summarizedResponse == null) {
          unsummarized.push({ tc, turnIndex: turn.turnIndex });
        }
      }
    }
    unsummarized.sort((a, b) => a.tc.tcIndex - b.tc.tcIndex);

    const target = unsummarized.slice(0, this.config.compact_oldest_n_tcs);
    if (!target.length) {
      return { tcsCompacted: [], tokensSaved: 0 };
    }

    let compactorLlm = this.llmProxy;
    if (this.config.compactor_llm) {
      compactorLlm = new LLMProxy(this.config.compactor_llm);
    }

    const tcsCompacted: string[] = [];
    let tokensSaved = 0;
    const promptTmpl = this.config.prompt_template || DEFAULT_COMPACTOR_PROMPT;

    for (const { tc } of target) {
      const prompt = promptTmpl
        .replace("{tool_name}", tc.toolName)
        .replace("{tool_input}", String(tc.toolInput))
        .replace("{raw_response}", tc.rawResponse);

      let summary = "";
      try {
        const response = await compactorLlm.chat([{ role: "user", content: prompt }], {
          maxTokens: this.config.max_tokens_per_summary || 150,
        });
        summary = (response.content ?? "").trim();
      } catch (err) {
        console.error(`ServerCompactor: LLM summarization failed for ${tc.tcId}:`, err);
        continue;
      }

      if (!summary || summary === "[]") {
        console.warn(`ServerCompactor: empty summary for ${tc.tcId}, keeping raw result`);
        continue;
      }

      tc.summarizedResponse = summary;
      tc.summarizedByTurn = currentTurnIndex;

      try {
        if (typeof this.storage.updateTcSummary === "function") {
          await this.storage.updateTcSummary(
            session.sessionId,
            tc.tcId,
            summary,
            currentTurnIndex,
            session.toScope(),
          );
        }
      } catch (err) {
        console.error("ServerCompactor: Failed to save summary to storage:", err);
      }

      const summaryTokens = TokenCounter.countString(summary);
      const saved = Math.max(0, tc.tokensRaw - summaryTokens);
      tc.tokensSummarized = summaryTokens;
      session.totalTokensSavedByRcs += saved;
      tokensSaved += saved;
      tcsCompacted.push(tc.tcId);
    }

    if (this.eventEmitter) {
      await this.eventEmitter.emit(
        createBaseEvent(NexusEventType.RCS_COMPACTOR_COMPLETED, {
          sessionId: session.sessionId,
          agentId: session.agentId,
          turnIndex: currentTurnIndex,
          data: { tcsCompacted, tokensSaved },
        }),
      );
    }

    return { tcsCompacted, tokensSaved };
  }
}
