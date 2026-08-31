# Jobs, artifacts, caching, and checkpoints

**Who this is for:** Developers who need work that outlives a single chat turn — scheduled runs, files, and repeated results.

These are **host-wired primitives, not a finished scheduler or object store.** Before you build on them, read the limits in each section: `JobScheduler` does not parse cron expressions and has no locking, retries, or dead-letter queue; `ArtifactStore` has no listing; and a checkpoint is a snapshot you store yourself, not automatic crash recovery. A production host usually keeps its own queue table and uses these as adapters.

## Key terms

- **Job** — A prompt Nexus runs on a schedule instead of in response to a user message.
- **Artifact** — A file a run produces or consumes (upload, attachment, generated report).
- **Scoped cache** — A cache whose keys include [scope](scope.md), so one tenant never reads another's hit.
- **Checkpoint** — A snapshot of where a run had got to, including the last stream `seq`.

All four pieces are **scope-aware**. They partition data with the same rules as [scope.md](scope.md).

These modules ship in the core package. You do not install a jobs extra.

## Scheduled jobs

`JobScheduler` keeps jobs in a `JobStore` and hands each due job to a `runFactory` you supply.

Nexus does **not** ship a cron parser. Pass `isDue` to plug in your own (`cron-parser`, `croner`, or a `next_run_at` column). The default fires every enabled job on every tick, which is only useful in development.

```ts
import { AgentRunner, createRunContext, InMemoryJobStore, JobScheduler } from "nexus-enterprise-agent";

const store = new InMemoryJobStore();

async function runJob(job: { id: string; prompt: string }) {
  // isCron: true turns off chat persistence via shouldPersist
  const ctx = createRunContext({
    tenantId: baseCtx.tenantId,
    userId: baseCtx.userId,
    sessionId: `cron_${job.id}`,
    isCron: true,
    metadata: { jobId: job.id, prompt: job.prompt },
  });
  const runner = new AgentRunner({ config, toolRegistry: registry, runContext: ctx });
  await runner.run({ userMessage: job.prompt });
}

const scheduler = new JobScheduler(store, runJob, (job, now) =>
  new Cron(job.cron).nextRun(now) != null && /* your match */ true,
);

await scheduler.addJob("0 9 * * *", "Send the daily sales summary", { owner: "u1" });
scheduler.startBackground(60);
```

| Piece | What it does |
|-------|--------------|
| `ScheduledJob` | `id`, `cron`, `prompt`, `enabled`, `metadata` |
| `JobStore` | Protocol: `listJobs`, `saveJob`, `deleteJob` |
| `InMemoryJobStore` | Reference store for development; replace it in production |
| `JobScheduler.runDueJobs()` | Runs every enabled, due job once and returns the jobs it fired |
| `JobScheduler.startBackground(intervalSeconds)` | Tick loop (default 60 seconds) |
| `createRunContext({ isCron: true })` | Builds a `RunContext` that skips durable chat writes |

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `store` | Yes | — | Where job rows live |
| `runFactory` | Yes | — | Async function that runs one due job |
| `isDue` | No | always true | Return `true` when this job should fire now |
| `cron` | Yes (`addJob`) | — | Schedule string you interpret in `isDue` |
| `prompt` | Yes (`addJob`) | — | User message the agent will run |
| `metadata` | No | `{}` | Extra fields (owner, tenant, …) |

Disabled jobs (`enabled: false`) are always skipped.

### What the scheduler does not do

- **No locking or lease.** Two processes pointed at the same store will both list and both run the same job. Add a claim column if you run more than one worker.
- **No retries or dead-letter queue.** If `runFactory` throws, the job is not rescheduled and nothing records the failure. Track attempts yourself.
- **No overlap guard.** `startBackground` uses a plain interval; a job slower than the tick can start again before the previous run finishes. Calling `startBackground` twice leaks the first timer, and `stop()` does not wait for in-flight runs.
- **No `last_run_at` or status.** Bookkeeping belongs in your store and your `isDue`.

If you already have a durable queue table with claims and retries, keep it and call `AgentRunner` directly. This scheduler is a convenience for simple hosts.

## Artifacts

An **artifact** is a file a run produces or consumes. `LocalArtifactStore` writes them under a user-scoped directory, so `get()` with another tenant's context returns `null`.

```ts
import { LocalArtifactStore } from "nexus-enterprise-agent";

const store = new LocalArtifactStore("./artifacts");
const meta = await store.put(ctx, pdfBytes, {
  filename: "invoice.pdf",
  contentType: "application/pdf",
});
const data = await store.get(ctx, meta.id);
```

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `root` | No | `"./artifacts"` | Folder on disk |
| `put(ctx, data, { filename, contentType })` | Yes | — | Write bytes; returns `id`, `filename`, `contentType`, `sizeBytes` |
| `get(ctx, artifactId)` | Yes | — | Read bytes, or `null` if missing / wrong scope |

Implement the `ArtifactStore` protocol (`put`, `get`) to back this with S3 or any other object store. Paths are sanitized so a tenant id cannot escape the root.

## Caching

`ScopedCache` caches LLM responses or tool results. Keys include the scope, so a cached answer never crosses tenants. It is **off by default** — construct one and wire it into your hooks only where repeated identical calls are genuinely safe.

```ts
import { ScopedCache } from "nexus-enterprise-agent";

const cache = new ScopedCache(300);
let hit = cache.get(ctx, "llm", payload);
if (hit == null) {
  hit = await expensiveCall();
  cache.set(ctx, "llm", payload, hit);
}
```

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `ttlSeconds` | No | `300` | How long a hit lives |
| `get(ctx, namespace, payload)` | — | — | Return the cached value or `null` |
| `set(ctx, namespace, payload, value)` | — | — | Store a value under a scope + hash of `payload` |

## Run checkpoints

A **checkpoint** is a snapshot of where a run had got to, for **you** to store. It is a plain data object, not an automatic recovery mechanism.

Be precise about what this does and does not give you:

- `checkpointFromSession()` builds the snapshot. Persist it wherever you like.
- `AgentRunner` never reads a checkpoint. There is no "resume this run from its checkpoint" call.
- Continuity across process restarts comes from the **session** instead: run again with the same `sessionId` and the runner loads the stored turns.
- To continue a run that paused for a human or a client tool, use `AgentRunner.resume(sessionId, results)` — that path uses `pendingInteractions` on the session, not this snapshot.
- `pendingToolCalls` is always empty in the snapshot today.

```ts
import { checkpointFromSession } from "nexus-enterprise-agent";

const cp = checkpointFromSession(session, { turnIndex: 3, streamSeq: 42 });
```

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `sessionId` | Yes | — | Chat thread this snapshot belongs to |
| `turnIndex` | Yes | — | Last completed turn |
| `pendingInteractions` | No | from session | Client tools / elicitations waiting for `resume()` |
| `state` | No | from session | Durable checkpoint bag |
| `streamSeq` | No | `session.streamSeq` | Sequence number of the last emitted stream event |

`streamSeq` is also stored on `AgentSession.streamSeq` when the session is saved, so numbering survives a process restart. A client that reconnects can send the last `seq` it saw so you skip events it already received — see [streaming.md](streaming.md).

This package does **not** ship an HTTP replay endpoint. Buffer and replay events in the consuming app if you need reconnect without a second run.

## Next steps

- [Streaming](streaming.md)
- [Scope](scope.md)
- [Run context](run-context.md)
