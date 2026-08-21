/** Context summarizer: folds oldest chat turns into rolling summaryText. */

import { getSummaryPrompt, type ContextSummaryConfig } from "../config/context-summary.js";
import { LLMProxy } from "../llm/proxy.js";
import type { AgentSession, TurnRecord } from "../session/models.js";
import { NexusEventType } from "../events/models.js";

export interface SessionManagerLike {
  saveSession(session: AgentSession): Promise<void>;
}

export interface EventEmitterLike {
  emit(event: unknown): Promise<void>;
}

export class ContextSummarizer {
  readonly config: ContextSummaryConfig;
  private readonly llmProxy: LLMProxy;
  private readonly sessionManager: SessionManagerLike;
  private readonly eventEmitter: EventEmitterLike | null;

  constructor(
    config: ContextSummaryConfig,
    llmProxy: LLMProxy,
    sessionManager: SessionManagerLike,
    eventEmitter: EventEmitterLike | null = null,
  ) {
    this.config = config;
    this.llmProxy = llmProxy;
    this.sessionManager = sessionManager;
    this.eventEmitter = eventEmitter;
  }

  get active(): boolean {
    return this.config.summarize_on != null;
  }

  private foldableTurns(session: AgentSession): TurnRecord[] {
    const cutoff = session.summaryThroughTurn;
    return session.turns
      .filter((t) => t.turnIndex > cutoff)
      .sort((a, b) => a.turnIndex - b.turnIndex);
  }

  shouldTrigger(
    session: AgentSession,
    currentTokens: number,
    contextWindowTokens: number,
  ): boolean {
    if (!this.active || contextWindowTokens <= 0) {
      return false;
    }
    const ratio = currentTokens / contextWindowTokens;
    if (ratio < (this.config.summarize_on ?? 1)) {
      return false;
    }
    return this.foldableTurns(session).length >= 1;
  }

  private buildTurnsDigest(turns: TurnRecord[]): string {
    const lines: string[] = [];
    for (const turn of turns) {
      if (turn.userMessage) {
        lines.push(`User: ${turn.userMessage}`);
      }
      for (const msg of turn.llmMessages) {
        if (msg.role === "assistant" && msg.content) {
          lines.push(`Assistant: ${String(msg.content)}`);
        }
      }
    }
    return lines.join("\n");
  }

  async summarize(session: AgentSession, turnIndex: number): Promise<string> {
    if (!this.active) {
      return session.summaryText;
    }

    const foldable = this.foldableTurns(session);
    if (!foldable.length) {
      return session.summaryText;
    }

    const toFold = foldable.slice(0, this.config.turns_to_fold ?? 2);
    const digest = this.buildTurnsDigest(toFold);
    if (!digest.trim()) {
      return session.summaryText;
    }

    let proxy = this.llmProxy;
    if (this.config.summary_llm) {
      proxy = new LLMProxy(this.config.summary_llm);
    }

    const prompt = getSummaryPrompt(this.config)
      .replace("{existing_summary}", session.summaryText ?? "")
      .replace("{turns_to_summarize}", digest);

    let newPart = "";
    try {
      const response = await proxy.chat([{ role: "user", content: prompt }]);
      newPart = (response.content ?? "").trim();
    } catch (err) {
      console.warn("ContextSummarizer: summarization failed, skipping:", err);
      return session.summaryText;
    }

    if (!newPart) {
      return session.summaryText;
    }

    const merged = session.summaryText
      ? `${session.summaryText.trimEnd()}\n\n${newPart}`
      : newPart;
    session.summaryText = merged.slice(0, this.config.max_summary_chars ?? 4000);

    const foldedIndices = new Set(toFold.map((t) => t.turnIndex));
    session.turns = session.turns.filter((t) => !foldedIndices.has(t.turnIndex));
    session.summaryThroughTurn = Math.max(
      session.summaryThroughTurn,
      ...foldedIndices,
    );

    await this.sessionManager.saveSession(session);
    await this.emitEvent(session, turnIndex, toFold, foldedIndices);

    return session.summaryText;
  }

  private async emitEvent(
    session: AgentSession,
    turnIndex: number,
    foldedTurns: TurnRecord[],
    foldedIndices: Set<number>,
  ): Promise<void> {
    if (!this.eventEmitter) return;

    await this.eventEmitter.emit({
      eventType: NexusEventType.CONTEXT_SUMMARIZED,
      sessionId: session.sessionId,
      agentId: session.agentId,
      turnIndex,
      data: {
        folded_turn_indices: [...foldedIndices].sort((a, b) => a - b),
        summary_length: session.summaryText.length,
        turns_folded: foldedTurns.length,
      },
    });
  }
}
