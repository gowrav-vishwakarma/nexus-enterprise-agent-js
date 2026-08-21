/** Reference in-memory job scheduler. */

import { randomUUID } from "node:crypto";
import type { JobStore } from "./protocol.js";
import { RunContext } from "../tools/context.js";

export interface ScheduledJob {
  id: string;
  cron: string;
  prompt: string;
  enabled: boolean;
  metadata: Record<string, unknown>;
}

function jobToDict(job: ScheduledJob): Record<string, unknown> {
  return {
    id: job.id,
    cron: job.cron,
    prompt: job.prompt,
    enabled: job.enabled,
    metadata: job.metadata,
  };
}

function jobFromDict(raw: Record<string, unknown>): ScheduledJob {
  return {
    id: String(raw.id),
    cron: String(raw.cron),
    prompt: String(raw.prompt),
    enabled: raw.enabled !== false,
    metadata: (raw.metadata as Record<string, unknown>) ?? {},
  };
}

export class InMemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, Record<string, unknown>>();

  async listJobs(): Promise<Array<Record<string, unknown>>> {
    return [...this.jobs.values()];
  }

  async saveJob(job: Record<string, unknown>): Promise<void> {
    this.jobs.set(String(job.id), job);
  }

  async deleteJob(jobId: string): Promise<void> {
    this.jobs.delete(jobId);
  }
}

export class JobScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly store: JobStore,
    private readonly runFactory: (job: ScheduledJob) => Promise<void>,
    private readonly isDue: (
      job: ScheduledJob,
      now: Date,
    ) => boolean = () => true,
  ) {}

  async addJob(
    cron: string,
    prompt: string,
    metadata: Record<string, unknown> = {},
  ): Promise<ScheduledJob> {
    const job: ScheduledJob = {
      id: randomUUID(),
      cron,
      prompt,
      enabled: true,
      metadata,
    };
    await this.store.saveJob(jobToDict(job));
    return job;
  }

  async runDueJobs(now = new Date()): Promise<ScheduledJob[]> {
    const fired: ScheduledJob[] = [];
    for (const raw of await this.store.listJobs()) {
      const job = jobFromDict(raw);
      if (!job.enabled || !this.isDue(job, now)) continue;
      await this.runFactory(job);
      fired.push(job);
    }
    return fired;
  }

  startBackground(intervalSeconds = 60): void {
    this.timer = setInterval(() => {
      void this.runDueJobs().catch((err) => {
        console.warn("JobScheduler tick failed:", err);
      });
    }, intervalSeconds * 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export function buildCronRunContext(
  base: RunContext,
  job: ScheduledJob,
): RunContext {
  return new RunContext({
    ...base,
    sessionId: `cron_${job.id}`,
    isCron: true,
    metadata: { ...base.metadata, jobId: job.id, prompt: job.prompt },
  });
}
