# Voice Lab and client-side realtime

**Who this is for:** Developers who want a browser voice loop, or who need to know where GPU Voice Lab lives.

## Key terms

- **Voice Lab** — The Python package’s full-duplex browser UI plus gRPC media servers. **Not shipped here.**
- **RealtimeRuntime** — TypeScript helper that builds a cascaded or speech-to-speech pipeline from a manifest.
- **Mock adapters** — `MockSTT`, `MockTTS`, and `EnergyVAD` in this package so you can test without GPUs.

## Voice Lab stays in Python

The one-command browser lab (`./scripts/run_voice_lab.sh`, http://localhost:8787, real Conformer/Parler/Silero processes) lives in:

[https://github.com/gowrav-vishwakarma/nexus-enterprise-agent](https://github.com/gowrav-vishwakarma/nexus-enterprise-agent)

There: `docs/guides/voice-lab.md`, `examples/voice_lab.py`, `examples/orchestration/voice_grpc.yaml`, `examples/servers.yaml`.

Use that repo when you need real GPU STT/TTS/LID. This TypeScript package is the **client-side runtime**.

## What TypeScript ships

| Piece | Role |
|-------|------|
| `RealtimeRuntime.fromManifest()` | Read `modality`, `stt`, `tts`, `vad` from YAML and build a pipeline |
| `CascadedVoicePipeline` | VAD → STT → the same `AgentRunner` → TTS |
| `SpeechToSpeechPipeline` | One duplex model path (`modality: voice_s2s`) with a mock S2S adapter |
| `RealtimeSession` | Bind a pipeline to a transport |
| `WebSocketTransport` / `InMemoryTransport` | Move PCM in tests or a browser socket you own |
| `MockSTT` / `MockTTS` / `EnergyVAD` / `MockVAD` | No GPU required |

```ts
import { OrchestrationManifest, createRunContext } from "nexus-enterprise-agent";
import {
  RealtimeRuntime,
  RealtimeSession,
  WebSocketTransport,
} from "nexus-enterprise-agent/realtime";

const manifest = await OrchestrationManifest.load("team.yaml");
const runContext = createRunContext({
  tenantId: "lab",
  userId: "tester",
  sessionId: "sess-1",
});
const runtime = RealtimeRuntime.fromManifest(manifest, { runContext });
const pipeline = runtime.buildPipeline("voice_local");
const session = new RealtimeSession(pipeline, new WebSocketTransport(socket), "sess-1");
await session.runAudio();
```

A typical YAML agent for **local mocks**:

```yaml
agents:
  voice_local:
    modality: voice_cascaded
    duplex: full
    stt: { provider: mock }
    tts: { provider: mock }
    vad: { provider: energy, silence_ms: 600 }
    agent:
      llm: *default_llm
      persona: { role: Voice Assistant, prompt: voice_system }
```

`provider: nexus_server` + `server_ref` is how the **Python** runtime talks to gRPC GPUs. TypeScript mock adapters ignore GPU hosts. See [model-servers.md](model-servers.md) for how you would point at those servers later.

## Connect greeting (`initial_response`)

When the manifest sets `initial_response.mode` to `proactive` or `ivr`, the session can speak a greeting at connect. On **full duplex**, listening starts immediately so the greeting is interruptible. On **half duplex** (IVR), the greeting finishes first.

## What you do not get in this package

- `./scripts/run_voice_lab.sh`
- FastAPI / uvicorn Voice Lab app
- gRPC engine processes (conformer, parler, silero, faster_whisper)
- Twilio / SIP production examples

Those stay in the Python repo. Wire your own HTTP or WebSocket in Elysia/Hono/Fastify/Express — [saas-example.md](saas-example.md).

## Next steps

- [Pipelines](pipelines.md)
- [Model servers (GPU stays Python)](model-servers.md)
- [LLM via Vercel AI SDK](llm-vercel-ai.md)
