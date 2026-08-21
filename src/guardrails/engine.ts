/** Guard engine running registered guards on hooks. */

import {
  GuardDecision,
  allowResult,
  type GuardProtocol,
  type GuardResult,
} from "./protocol.js";
import type { RunContext } from "../tools/context.js";

export class GuardEngine {
  guards: GuardProtocol[];

  constructor(guards: GuardProtocol[] = []) {
    this.guards = [...guards];
  }

  add(guard: GuardProtocol): void {
    this.guards.push(guard);
  }

  async checkInput(content: string, ctx: RunContext): Promise<GuardResult> {
    return this.run(content, ctx, "input");
  }

  async checkOutput(content: string, ctx: RunContext): Promise<GuardResult> {
    return this.run(content, ctx, "output");
  }

  private async run(
    content: string,
    ctx: RunContext,
    phase: string,
  ): Promise<GuardResult> {
    let current = content;
    for (const guard of this.guards) {
      try {
        const result = await guard.check(current, { ctx, phase });
        if (result.decision === GuardDecision.Block) return result;
        if (
          result.decision === GuardDecision.Redact &&
          result.content != null
        ) {
          current = result.content;
        }
      } catch {
        continue;
      }
    }
    return allowResult(current);
  }
}
