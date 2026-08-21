/** Job scheduling protocol. */

import type { RunContext } from "../tools/context.js";

export type JobDeliveryCallback = (
  ctx: RunContext,
  payload: Record<string, unknown>,
) => Promise<void>;

export interface JobStore {
  listJobs(): Promise<Array<Record<string, unknown>>>;
  saveJob(job: Record<string, unknown>): Promise<void>;
  deleteJob(jobId: string): Promise<void>;
}
