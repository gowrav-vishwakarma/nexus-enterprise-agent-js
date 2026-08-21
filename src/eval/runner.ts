/** Dataset-driven eval runner. */

import { readFileSync } from "node:fs";

export interface EvalCase {
  id: string;
  input: string;
  expectContains?: string | null;
  expectTools?: string[];
}

export class EvalRunner {
  constructor(readonly cases: EvalCase[]) {}

  async runAll(
    runnerFn: (
      input: string,
    ) => Promise<{ finalResponse?: string | null } | string>,
  ): Promise<{
    passed: number;
    total: number;
    results: Array<Record<string, unknown>>;
  }> {
    let passed = 0;
    const results: Array<Record<string, unknown>> = [];
    for (const testCase of this.cases) {
      const out = await runnerFn(testCase.input);
      const text =
        typeof out === "string" ? out : (out.finalResponse ?? String(out));
      let ok = true;
      if (testCase.expectContains && !text.includes(testCase.expectContains)) {
        ok = false;
      }
      if (ok) passed += 1;
      results.push({ id: testCase.id, ok, output: text });
    }
    return { passed, total: this.cases.length, results };
  }
}

export async function runEvalCli(
  dataset?: string | null,
): Promise<Record<string, unknown>> {
  let cases: EvalCase[] = [{ id: "smoke", input: "Hello" }];
  if (dataset) {
    const raw = JSON.parse(readFileSync(dataset, "utf8")) as {
      cases?: EvalCase[];
    };
    if (raw.cases?.length) cases = raw.cases;
  }
  const report = await new EvalRunner(cases).runAll(async () => ({
    finalResponse: "ok",
  }));
  console.log(JSON.stringify(report, null, 2));
  return report;
}
