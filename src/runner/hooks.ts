import type { AgentSession } from "../session/models.js";
import type { RunContext } from "../tools/context.js";

export type TurnAction = "continue" | "stop" | "inject";

export interface TurnDecision {
  action: TurnAction;
  message?: string | null;
}

export interface TurnContext {
  session: AgentSession;
  turnIndex: number;
  runTurnIndex: number;
  toolResults: Array<Record<string, unknown>>;
  state: Record<string, unknown>;
  finalResponse?: string | null;
}

export interface ToolCallContext {
  session: AgentSession;
  turnIndex: number;
  toolName: string;
  toolArgs: Record<string, unknown>;
  runContext: RunContext;
  tcId?: string;
}

export interface LLMCallContext {
  session: AgentSession;
  turnIndex: number;
  messages: Array<Record<string, unknown>>;
  runContext: RunContext;
}

export type OnTurnStart = (ctx: TurnContext, runContext: RunContext) => Promise<void>;
export type OnTurnEnd = (ctx: TurnContext) => Promise<TurnDecision | null | undefined>;
export type BeforeToolCall = (ctx: ToolCallContext) => Promise<Record<string, unknown> | null | undefined>;
export type AfterToolCall = (ctx: ToolCallContext, result: unknown) => Promise<void>;
export type BeforeLLMCall = (
  ctx: LLMCallContext,
) => Promise<Array<Record<string, unknown>> | null | undefined>;

export interface RunnerHooks {
  onTurnStart?: OnTurnStart | null;
  onTurnEnd?: OnTurnEnd | null;
  beforeToolCall?: BeforeToolCall | null;
  afterToolCall?: AfterToolCall | null;
  beforeLLMCall?: BeforeLLMCall | null;
}
