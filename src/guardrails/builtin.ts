/** Built-in guard implementations. */

import {
  GuardDecision,
  allowResult,
  type GuardProtocol,
  type GuardResult,
} from "./protocol.js";
import { redactText } from "./redaction.js";
import type { RunContext } from "../tools/context.js";

const INJECTION_PATTERNS = [
  "ignore previous instructions",
  "disregard your instructions",
  "system prompt",
  "you are now",
];

export class PIIRedactionGuard implements GuardProtocol {
  async check(
    content: string,
    _opts: { ctx: RunContext; phase?: string },
  ): Promise<GuardResult> {
    const redacted = redactText(content);
    if (redacted !== content) {
      return {
        decision: GuardDecision.Redact,
        content: redacted,
        reason: "PII redacted",
      };
    }
    return allowResult(content);
  }
}

export class PromptInjectionGuard implements GuardProtocol {
  async check(
    content: string,
    opts: { ctx: RunContext; phase?: string },
  ): Promise<GuardResult> {
    if (opts.phase !== "input") return allowResult(content);
    const lower = content.toLowerCase();
    for (const pattern of INJECTION_PATTERNS) {
      if (lower.includes(pattern)) {
        return {
          decision: GuardDecision.Block,
          reason: `Prompt injection pattern detected: ${pattern}`,
        };
      }
    }
    return allowResult(content);
  }
}
