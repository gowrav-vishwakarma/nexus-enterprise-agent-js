/** Cost tracking, budgets, and rate limiting. */

import { ScopeLevel, scopeKey } from "../scope.js";
import type { RunContext } from "../tools/context.js";

export const DEFAULT_PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  default: { input: 1.0, output: 3.0 },
};

export interface BudgetConfig {
  maxTokensPerRun?: number | null;
  maxCostUsdPerRun?: number | null;
  maxRequestsPerMinute?: number | null;
}

export class CostTracker {
  tokensIn = 0;
  tokensOut = 0;

  constructor(
    private readonly model: string,
    private readonly pricing: Record<
      string,
      { input: number; output: number }
    > = DEFAULT_PRICING,
  ) {}

  addUsage(tokensIn: number, tokensOut: number): void {
    this.tokensIn += tokensIn;
    this.tokensOut += tokensOut;
  }

  estimatedCostUsd(): number {
    const rates = this.pricing[this.model] ?? this.pricing.default!;
    return (
      (this.tokensIn * rates.input) / 1_000_000 +
      (this.tokensOut * rates.output) / 1_000_000
    );
  }

  checkBudget(config: BudgetConfig): string | null {
    if (config.maxTokensPerRun != null) {
      const total = this.tokensIn + this.tokensOut;
      if (total > config.maxTokensPerRun) {
        return `Token budget exceeded (${total} > ${config.maxTokensPerRun})`;
      }
    }
    if (config.maxCostUsdPerRun != null) {
      const cost = this.estimatedCostUsd();
      if (cost > config.maxCostUsdPerRun) {
        return `Cost budget exceeded ($${cost.toFixed(4)} > $${config.maxCostUsdPerRun})`;
      }
    }
    return null;
  }
}

export class RateLimiter {
  private readonly windows = new Map<string, number[]>();

  check(ctx: RunContext, maxPerMinute: number): boolean {
    const key = scopeKey(ctx, ScopeLevel.Tenant, "rate");
    const now = Date.now() / 1000;
    const window = (this.windows.get(key) ?? []).filter((t) => now - t < 60);
    if (window.length >= maxPerMinute) return false;
    window.push(now);
    this.windows.set(key, window);
    return true;
  }
}
