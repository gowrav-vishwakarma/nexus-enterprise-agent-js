/** Session record/replay for regression testing. */

import { readFileSync } from "node:fs";

export class SessionReplayer {
  readonly data: Record<string, unknown>;

  constructor(path: string) {
    this.data = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  }

  get turns(): Array<Record<string, unknown>> {
    return (this.data.turns as Array<Record<string, unknown>>) ?? [];
  }

  toolNames(): string[] {
    const names: string[] = [];
    for (const turn of this.turns) {
      const calls =
        (turn.toolCalls as Array<Record<string, unknown>> | undefined) ??
        (turn.tool_calls as Array<Record<string, unknown>> | undefined) ??
        [];
      for (const tc of calls) {
        names.push(String(tc.toolName ?? tc.tool_name ?? ""));
      }
    }
    return names;
  }
}
