/** Guard protocol for input/output filtering. */

import type { RunContext } from "../tools/context.js";

export enum GuardDecision {
  Allow = "allow",
  Block = "block",
  Redact = "redact",
}

export interface GuardResult {
  decision: GuardDecision;
  content?: string | null;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface GuardProtocol {
  check(
    content: string,
    opts: { ctx: RunContext; phase?: string },
  ): Promise<GuardResult>;
}

export function allowResult(content: string): GuardResult {
  return { decision: GuardDecision.Allow, content, reason: "" };
}
