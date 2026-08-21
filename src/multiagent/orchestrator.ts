/** Agent orchestrator for executing multi-agent patterns. */

import type { AgentConfig, AgentGroupConfig } from "../config/agent.js";
import type { CrossSessionMemoryStore } from "../memory/cross-session-store.js";
import { isAgentGroupConfig } from "../orchestration/resolver.js";
import { AgentRunner } from "../runner/agent-runner.js";
import {
  createAgentStreamEvent,
  type AgentStreamEvent,
} from "../runner/result.js";
import type { SessionManager } from "../session/manager.js";
import { createRunContext, type RunContext } from "../tools/context.js";
import { defineTool } from "../tools/decorators.js";
import { ToolRegistry } from "../tools/registry.js";
import {
  agentGroupResultToDict,
  createAgentGroupResult,
  type AgentGroupResult,
} from "./results.js";

export type GroupMember = AgentRunner | AgentOrchestrator;

export interface OrchestratorRunOptions {
  userMessage: string;
  sessionId?: string | null;
  stream?: boolean | null;
  maxTurns?: number | null;
}

interface UsageTotals {
  turnsUsed: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalTokensSavedByRcs: number;
  cumulativeInputTokensSavedByRcs: number;
}

function emptyUsage(): UsageTotals {
  return {
    turnsUsed: 0,
    totalTokensIn: 0,
    totalTokensOut: 0,
    totalTokensSavedByRcs: 0,
    cumulativeInputTokensSavedByRcs: 0,
  };
}

function readUsage(res: unknown): UsageTotals & { finalResponse: string | null } {
  const r = (res ?? {}) as Record<string, unknown>;
  return {
    turnsUsed: Number(r.turnsUsed ?? r.turns_used ?? 0),
    totalTokensIn: Number(r.totalTokensIn ?? r.total_tokens_in ?? 0),
    totalTokensOut: Number(r.totalTokensOut ?? r.total_tokens_out ?? 0),
    totalTokensSavedByRcs: Number(r.totalTokensSavedByRcs ?? r.total_tokens_saved_by_rcs ?? 0),
    cumulativeInputTokensSavedByRcs: Number(
      r.cumulativeInputTokensSavedByRcs ??
        r.cumulativeTokensSavedByRcs ??
        r.cumulative_input_tokens_saved_by_rcs ??
        0,
    ),
    finalResponse: (r.finalResponse ?? r.final_response ?? null) as string | null,
  };
}

function addUsage(acc: UsageTotals, res: unknown): string | null {
  const usage = readUsage(res);
  acc.turnsUsed += usage.turnsUsed;
  acc.totalTokensIn += usage.totalTokensIn;
  acc.totalTokensOut += usage.totalTokensOut;
  acc.totalTokensSavedByRcs += usage.totalTokensSavedByRcs;
  acc.cumulativeInputTokensSavedByRcs += usage.cumulativeInputTokensSavedByRcs;
  return usage.finalResponse;
}

export class AgentOrchestrator {
  readonly config: AgentGroupConfig;
  readonly toolRegistry: ToolRegistry;
  readonly sessionManager: SessionManager | undefined;
  readonly runContext: RunContext;
  readonly crossSessionMemoryStore: CrossSessionMemoryStore | null | undefined;
  readonly eventEmitter: unknown;
  private readonly members = new Map<string, GroupMember>();

  constructor(options: {
    config: AgentGroupConfig;
    toolRegistry?: ToolRegistry | null;
    storageConfig?: SessionManager | null;
    sessionManager?: SessionManager | null;
    runContext?: RunContext | null;
    crossSessionMemoryStore?: CrossSessionMemoryStore | null;
    eventEmitter?: unknown;
  }) {
    this.config = options.config;
    this.toolRegistry = options.toolRegistry ?? new ToolRegistry();
    this.sessionManager = options.sessionManager ?? options.storageConfig ?? undefined;
    this.runContext = options.runContext ?? createRunContext();
    this.crossSessionMemoryStore = options.crossSessionMemoryStore;
    this.eventEmitter = options.eventEmitter;
    this.initMembers();
  }

  private resolveStream(stream?: boolean | null): boolean {
    return stream ?? this.config.stream_output ?? false;
  }

  private initMembers(): void {
    for (const member of this.config.members) {
      const child = this.runContext.deriveChild({
        sessionId: this.runContext.sessionId
          ? `${this.config.session_id_prefix}${this.runContext.sessionId}_${member.name}`
          : null,
        isSubagent: !this.config.persist_members,
        includeContext: this.config.context_sharing !== "isolated",
      });
      if (this.crossSessionMemoryStore) {
        child.withService("crossSessionMemoryStore", this.crossSessionMemoryStore);
      }
      if (isAgentGroupConfig(member)) {
        this.members.set(
          member.name,
          new AgentOrchestrator({
            config: member,
            toolRegistry: this.toolRegistry,
            sessionManager: this.sessionManager,
            runContext: child,
            crossSessionMemoryStore: this.crossSessionMemoryStore,
            eventEmitter: this.eventEmitter,
          }),
        );
      } else {
        this.members.set(
          member.name,
          new AgentRunner({
            config: member as AgentConfig,
            toolRegistry: this.toolRegistry,
            sessionManager: this.sessionManager,
            runContext: child,
            eventEmitter: this.eventEmitter as ConstructorParameters<
              typeof AgentRunner
            >[0]["eventEmitter"],
          }),
        );
      }
    }
  }

  async run(options: OrchestratorRunOptions): Promise<AgentGroupResult> {
    if (this.resolveStream(options.stream)) {
      throw new Error("Streaming mode enabled; use runStream() or pass stream=false.");
    }
    const startTime = Date.now();
    if (options.sessionId) this.runContext.sessionId = options.sessionId;
    const budget = this.effectiveTurnBudget(options.maxTurns);
    if (this.config.pattern === "parallel") {
      return this.runParallel(options.userMessage, startTime, budget);
    }
    if (this.config.pattern === "supervisor") {
      return this.runSupervisor(options.userMessage, startTime, budget);
    }
    return this.runPipeline(options.userMessage, startTime, budget);
  }

  async *runStream(options: OrchestratorRunOptions): AsyncGenerator<AgentStreamEvent> {
    if (!this.resolveStream(options.stream ?? true)) {
      throw new Error("Non-streaming mode; use run() or pass stream=true.");
    }
    if (options.sessionId) this.runContext.sessionId = options.sessionId;
    yield createAgentStreamEvent("event", {
      content: `Agent group '${this.config.name}' started.`,
      data: { group: this.config.name, pattern: this.config.pattern },
    });
    if (this.config.pattern === "supervisor") {
      yield* this.runSupervisorStream(options.userMessage);
      return;
    }
    if (this.config.pattern === "parallel") {
      yield* this.runParallelStream(options.userMessage);
      return;
    }
    yield* this.runPipelineStream(options.userMessage);
  }

  private tagMemberEvent(memberName: string, event: AgentStreamEvent): AgentStreamEvent {
    return createAgentStreamEvent(event.eventType, {
      content: event.content,
      data: { ...(event.data ?? {}), member: memberName, group: this.config.name },
    });
  }

  private rootSessionId(): string {
    return this.runContext.sessionId ?? "";
  }

  private effectiveTurnBudget(maxTurns?: number | null): number {
    if (maxTurns == null) return this.config.max_turns;
    return Math.min(this.config.max_turns, maxTurns);
  }

  private selectSupervisor(): { name: string | null; error: string | null } {
    if (this.config.supervisor) {
      if (!this.members.has(this.config.supervisor)) {
        return { name: null, error: `Supervisor '${this.config.supervisor}' is not a group member` };
      }
      return { name: this.config.supervisor, error: null };
    }
    for (const name of this.members.keys()) {
      if (name === "supervisor" || name.toLowerCase().includes("supervisor")) {
        return { name, error: null };
      }
    }
    const first = this.members.keys().next().value;
    if (first) return { name: first, error: null };
    return { name: null, error: "No members available in supervisor group" };
  }

  private syncDown(member: GroupMember, delegatedBy?: string | null): void {
    if (this.config.context_sharing === "isolated") return;
    const ctx = member.runContext;
    ctx.metadata = { ...(ctx.metadata ?? {}), ...(this.runContext.metadata ?? {}) };
    ctx.state = { ...(ctx.state ?? {}), ...(this.runContext.state ?? {}) };
    ctx.metadata.nexus_delegation = {
      group: this.config.name,
      member: member.config.name,
      delegatedBy,
      pattern: this.config.pattern,
    };
  }

  private syncUp(member: GroupMember): void {
    if (this.config.context_sharing !== "shared") return;
    const ctx = member.runContext;
    const memberMeta = { ...(ctx.metadata ?? {}) };
    delete memberMeta.nexus_delegation;
    this.runContext.metadata = { ...(this.runContext.metadata ?? {}), ...memberMeta };
    this.runContext.state = { ...(this.runContext.state ?? {}), ...(ctx.state ?? {}) };
  }

  private async runPipeline(
    userMessage: string,
    startTime: number,
    turnBudget: number,
  ): Promise<AgentGroupResult> {
    let currentInput = userMessage;
    const memberResults: Record<string, unknown> = {};
    const usage = emptyUsage();
    for (const [name, member] of this.members) {
      const remaining = turnBudget - usage.turnsUsed;
      if (remaining <= 0) {
        console.warn(`Group '${this.config.name}' hit max_turns=${turnBudget}; stopping pipeline`);
        break;
      }
      try {
        this.syncDown(member);
        const res = await member.run({
          userMessage: currentInput,
          stream: false,
          maxTurns: remaining,
        });
        this.syncUp(member);
        memberResults[name] = res;
        currentInput = addUsage(usage, res) ?? "";
      } catch (err) {
        console.error(`Pipeline member '${name}' failed:`, err);
        return createAgentGroupResult({
          sessionId: this.rootSessionId(),
          groupName: this.config.name,
          memberResults,
          status: "failed",
          error: String(err),
          durationMs: Date.now() - startTime,
        });
      }
    }
    return createAgentGroupResult({
      sessionId: this.rootSessionId(),
      groupName: this.config.name,
      finalResponse: currentInput,
      memberResults,
      ...usage,
      durationMs: Date.now() - startTime,
      status: "completed",
    });
  }

  private async *runPipelineStream(userMessage: string): AsyncGenerator<AgentStreamEvent> {
    const startTime = Date.now();
    let currentInput = userMessage;
    const memberResults: Record<string, unknown> = {};
    const usage = emptyUsage();
    let finalResponse: string | null = null;
    let status: AgentGroupResult["status"] = "completed";
    let errorMsg: string | null = null;
    for (const [name, member] of this.members) {
      yield createAgentStreamEvent("event", {
        content: `Pipeline member '${name}' started.`,
        data: { group: this.config.name, member: name },
      });
      try {
        this.syncDown(member);
        for await (const event of member.runStream({
          userMessage: currentInput,
          stream: true,
        })) {
          yield this.tagMemberEvent(name, event);
          if (event.eventType === "final_response" && event.data) {
            memberResults[name] = event.data;
            this.syncUp(member);
            currentInput = event.content ?? "";
            finalResponse = event.content ?? null;
            addUsage(usage, event.data);
          }
        }
      } catch (err) {
        status = "failed";
        errorMsg = String(err);
        yield createAgentStreamEvent("error", {
          content: errorMsg,
          data: { group: this.config.name, member: name, status: "failed" },
        });
        break;
      }
    }
    const groupResult = createAgentGroupResult({
      sessionId: this.rootSessionId(),
      groupName: this.config.name,
      finalResponse,
      memberResults,
      ...usage,
      durationMs: Date.now() - startTime,
      status,
      error: errorMsg,
    });
    yield createAgentStreamEvent("final_response", {
      content: finalResponse,
      data: agentGroupResultToDict(groupResult),
    });
  }

  private aggregateParallel(
    memberResults: Record<string, unknown>,
    orderedNames: string[],
  ): string | null {
    const responses = orderedNames
      .map((name) => [name, readUsage(memberResults[name]).finalResponse] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1]));
    if (!responses.length) return null;
    if (this.config.aggregation_strategy === "first_complete") return responses[0]![1];
    if (this.config.aggregation_strategy === "vote") {
      const counts = new Map<string, number>();
      for (const [, resp] of responses) counts.set(resp, (counts.get(resp) ?? 0) + 1);
      let winner = responses[0]![1];
      let best = 0;
      for (const [resp, count] of counts) {
        if (count > best) {
          winner = resp;
          best = count;
        }
      }
      return winner;
    }
    return responses.map(([name, resp]) => `[${name}]\n${resp}`).join("\n\n");
  }

  private async runParallel(
    userMessage: string,
    startTime: number,
    turnBudget: number,
  ): Promise<AgentGroupResult> {
    const names = [...this.members.keys()];
    if (turnBudget < 1) {
      return createAgentGroupResult({
        sessionId: this.rootSessionId(),
        groupName: this.config.name,
        status: "failed",
        error: "Group max_turns budget exhausted",
        durationMs: Date.now() - startTime,
      });
    }
    if (this.config.context_sharing === "shared") {
      console.warn(
        `Group '${this.config.name}': context_sharing=shared does not write back from parallel members`,
      );
    }
    const gathered = await Promise.allSettled(
      [...this.members.entries()].map(async ([name, member]) => {
        this.syncDown(member);
        const res = await member.run({ userMessage, stream: false, maxTurns: turnBudget });
        return { name, res };
      }),
    );
    const memberResults: Record<string, unknown> = {};
    const usage = emptyUsage();
    for (const item of gathered) {
      if (item.status === "rejected") {
        return createAgentGroupResult({
          sessionId: this.rootSessionId(),
          groupName: this.config.name,
          memberResults,
          status: "failed",
          error: String(item.reason),
          durationMs: Date.now() - startTime,
        });
      }
      memberResults[item.value.name] = item.value.res;
      addUsage(usage, item.value.res);
    }
    return createAgentGroupResult({
      sessionId: this.rootSessionId(),
      groupName: this.config.name,
      finalResponse: this.aggregateParallel(memberResults, names),
      memberResults,
      ...usage,
      durationMs: Date.now() - startTime,
      status: "completed",
    });
  }

  private async *runParallelStream(userMessage: string): AsyncGenerator<AgentStreamEvent> {
    const startTime = Date.now();
    const names = [...this.members.keys()];
    type QueueItem = { name: string; event: AgentStreamEvent | symbol };
    const done = Symbol("done");
    const queue: QueueItem[] = [];
    const waiters: Array<(item: QueueItem) => void> = [];
    const push = (item: QueueItem) => {
      const waiter = waiters.shift();
      if (waiter) waiter(item);
      else queue.push(item);
    };
    const take = () =>
      queue.length
        ? Promise.resolve(queue.shift()!)
        : new Promise<QueueItem>((resolve) => waiters.push(resolve));

    const pumps = [...this.members.entries()].map(async ([name, member]) => {
      try {
        this.syncDown(member);
        for await (const event of member.runStream({ userMessage, stream: true })) {
          push({ name, event });
        }
      } catch (err) {
        push({
          name,
          event: createAgentStreamEvent("error", {
            content: String(err),
            data: { member: name, status: "failed" },
          }),
        });
      } finally {
        push({ name, event: done });
      }
    });

    const memberResults: Record<string, unknown> = {};
    const usage = emptyUsage();
    let remaining = pumps.length;
    while (remaining > 0) {
      const { name, event } = await take();
      if (event === done) {
        remaining -= 1;
        continue;
      }
      const streamEvent = event as AgentStreamEvent;
      yield this.tagMemberEvent(name, streamEvent);
      if (streamEvent.eventType === "final_response" && streamEvent.data) {
        memberResults[name] = streamEvent.data;
        addUsage(usage, streamEvent.data);
      }
    }
    await Promise.all(pumps);
    const groupResult = createAgentGroupResult({
      sessionId: this.rootSessionId(),
      groupName: this.config.name,
      finalResponse: this.aggregateParallel(memberResults, names),
      memberResults,
      ...usage,
      durationMs: Date.now() - startTime,
      status: "completed",
    });
    yield createAgentStreamEvent("final_response", {
      content: groupResult.finalResponse,
      data: agentGroupResultToDict(groupResult),
    });
  }

  private grantDelegateTools(
    supervisor: AgentRunner,
    supervisorName: string,
    budget: number,
    usage: UsageTotals,
    memberResults: Record<string, unknown>,
  ): void {
    const names: string[] = [];
    for (const [name, member] of this.members) {
      if (name === supervisorName) continue;
      const callMemberTool = async (taskInput: string): Promise<string> => {
        const remaining = budget - usage.turnsUsed;
        if (remaining <= 0) return "Group max_turns budget exhausted.";
        this.syncUp(supervisor);
        this.syncDown(member, supervisorName);
        const subRes = await member.run({
          userMessage: taskInput,
          stream: false,
          maxTurns: remaining,
        });
        memberResults[name] = subRes;
        addUsage(usage, subRes);
        this.syncUp(member);
        return readUsage(subRes).finalResponse || "Completed with no output.";
      };
      this.toolRegistry.registerTool(
        defineTool(callMemberTool, {
          name: `delegate_to_${name}`,
          description: `Delegate a sub-task to the specialized helper agent named ${name}.`,
          tags: ["multiagent", "delegate"],
          timeoutSeconds: 60,
          parameters: {
            type: "object",
            properties: { taskInput: { type: "string" } },
            required: ["taskInput"],
          },
        }),
        "supervisor",
      );
      names.push(`supervisor.delegate_to_${name}`);
    }
    supervisor.grantTools(names);
  }

  private async runSupervisor(
    userMessage: string,
    startTime: number,
    turnBudget: number,
  ): Promise<AgentGroupResult> {
    const { name: supervisorName, error: selectError } = this.selectSupervisor();
    if (selectError || !supervisorName) {
      return createAgentGroupResult({
        sessionId: this.rootSessionId(),
        groupName: this.config.name,
        status: "failed",
        error: selectError ?? "No supervisor available",
        durationMs: Date.now() - startTime,
      });
    }
    const supervisor = this.members.get(supervisorName)!;
    if (!(supervisor instanceof AgentRunner)) {
      return createAgentGroupResult({
        sessionId: this.rootSessionId(),
        groupName: this.config.name,
        status: "failed",
        error: "Supervisor member must be a single AgentRunner",
        durationMs: Date.now() - startTime,
      });
    }
    const memberResults: Record<string, unknown> = {};
    const usage = emptyUsage();
    this.grantDelegateTools(supervisor, supervisorName, turnBudget, usage, memberResults);
    try {
      const remaining = turnBudget - usage.turnsUsed;
      if (remaining <= 0) {
        return createAgentGroupResult({
          sessionId: this.rootSessionId(),
          groupName: this.config.name,
          status: "failed",
          error: "Group max_turns budget exhausted",
          durationMs: Date.now() - startTime,
        });
      }
      this.syncDown(supervisor);
      const supervisorRes = await supervisor.run({
        userMessage,
        stream: false,
        maxTurns: remaining,
      });
      this.syncUp(supervisor);
      memberResults[supervisorName] = supervisorRes;
      const finalResponse = addUsage(usage, supervisorRes);
      return createAgentGroupResult({
        sessionId: this.rootSessionId(),
        groupName: this.config.name,
        finalResponse,
        memberResults,
        ...usage,
        durationMs: Date.now() - startTime,
        status: "completed",
      });
    } catch (err) {
      return createAgentGroupResult({
        sessionId: this.rootSessionId(),
        groupName: this.config.name,
        memberResults,
        status: "failed",
        error: String(err),
        durationMs: Date.now() - startTime,
      });
    }
  }

  private async *runSupervisorStream(userMessage: string): AsyncGenerator<AgentStreamEvent> {
    const startTime = Date.now();
    const { name: supervisorName, error: selectError } = this.selectSupervisor();
    if (selectError || !supervisorName) {
      yield createAgentStreamEvent("error", {
        content: selectError ?? "No supervisor available",
        data: { group: this.config.name, status: "failed" },
      });
      return;
    }
    const supervisor = this.members.get(supervisorName)!;
    if (!(supervisor instanceof AgentRunner)) {
      yield createAgentStreamEvent("error", {
        content: "Supervisor member must be a single AgentRunner",
        data: { group: this.config.name, status: "failed" },
      });
      return;
    }
    const memberResults: Record<string, unknown> = {};
    const usage = emptyUsage();
    let finalResponse: string | null = null;
    let status: AgentGroupResult["status"] = "completed";
    let errorMsg: string | null = null;
    this.grantDelegateTools(supervisor, supervisorName, this.config.max_turns, usage, memberResults);
    try {
      const remaining = this.config.max_turns - usage.turnsUsed;
      this.syncDown(supervisor);
      for await (const event of supervisor.runStream({
        userMessage,
        stream: true,
        maxTurns: remaining > 0 ? remaining : 1,
      })) {
        yield this.tagMemberEvent(supervisorName, event);
        if (event.eventType === "final_response" && event.data) {
          memberResults[supervisorName] = event.data;
          this.syncUp(supervisor);
          finalResponse = event.content ?? null;
          addUsage(usage, event.data);
        }
      }
    } catch (err) {
      status = "failed";
      errorMsg = String(err);
      yield createAgentStreamEvent("error", {
        content: errorMsg,
        data: { group: this.config.name, member: supervisorName, status: "failed" },
      });
    }
    const groupResult = createAgentGroupResult({
      sessionId: this.rootSessionId(),
      groupName: this.config.name,
      finalResponse,
      memberResults,
      ...usage,
      durationMs: Date.now() - startTime,
      status,
      error: errorMsg,
    });
    yield createAgentStreamEvent("final_response", {
      content: finalResponse,
      data: agentGroupResultToDict(groupResult),
    });
  }
}
