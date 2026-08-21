# Model servers (GPU stays in Python)

**Who this is for:** Developers who need STT, TTS, VAD, or LID on a GPU, or who want TypeScript to talk to those processes.

## Key terms

- **Media server** — A gRPC process that hosts an STT, TTS, VAD, or LID engine.
- **`server_ref`** — Label on the agent (`stt.server_ref: indic_stt`) that points at one entry in `servers:`.
- **`servers:`** — YAML map of host, port, engine, and model options.

**LLM is not hosted here.** Use [llm-vercel-ai.md](llm-vercel-ai.md) for text and voice agents (`provider` + `base_url`).

## GPU servers stay in the Python package

Start and health-check media processes with the Python CLI:

```bash
# In the Python checkout: https://github.com/gowrav-vishwakarma/nexus-enterprise-agent
uv sync --extra server --extra grpc
uv run python -m nexus.server up -c examples/servers.yaml
uv run python -m nexus.server health -c examples/servers.yaml
```

Default ports: STT `50051`, TTS `50052`, VAD `50053`, LID `50054`.

Full Python reference: that repo’s `docs/guides/model-servers.md` and `docs/reference/server.md`.

This TypeScript package does **not** start gRPC engines. It ships mock STT/TTS and an energy VAD for client-side tests.

## How TypeScript would point at them

Use the same YAML labels the Python runtime understands. A TypeScript app that later grows a gRPC client would resolve `server_ref` → `host:port` the same way:

```yaml
servers:
  indic_stt:
    kind: stt
    engine: conformer
    host: 127.0.0.1
    port: 50051
  indic_tts:
    kind: tts
    engine: parler
    host: 127.0.0.1
    port: 50052
    sample_rate: 44100

agents:
  voice_grpc:
    modality: voice_cascaded
    stt: { provider: nexus_server, server_ref: indic_stt, language: hi }
    tts: { provider: nexus_server, server_ref: indic_tts, sample_rate: 44100 }
    vad: { provider: energy }
    lid: { provider: nexus_server, server_ref: whisper_lid, fallback_language: hi }
    agent:
      llm:
        provider: openai
        model: gpt-4o-mini
        api_key: ${ENV:OPENAI_API_KEY}
```

Today, `RealtimeRuntime` in TypeScript builds **mock / energy** adapters. Treat `provider: nexus_server` as the contract for a future gRPC client (or call the Python Voice Lab and keep TypeScript on text). Until then, use:

```yaml
stt: { provider: mock }
tts: { provider: mock }
vad: { provider: energy }
```

Or point **only the LLM** at a remote OpenAI-compatible server (`provider: custom` / `litellm` + `base_url`) while media stays mock.

## `servers:` entry (for when you copy Python YAML)

| Field | Required? | Default | What it does |
|-------|-----------|---------|--------------|
| `kind` | Yes | — | `stt`, `tts`, `vad`, `lid` |
| `engine` | Yes | — | `mock`, `conformer`, `parler`, `silero`, `faster_whisper`, … |
| `host` | No | `127.0.0.1` | Bind / connect address |
| `port` | Yes | — | gRPC port |
| `device` | No | — | `cpu`, `cuda`, `cuda:0`, … |
| `sample_rate` | No | — | Native Hz (TTS — match agent `tts.sample_rate`) |
| `extra` | No | `{}` | Engine options (`model_id`, …) |

Labels are arbitrary. Only the string in `server_ref` must match the key under `servers:`.

## Transport split

| Leg | Protocol | Who runs it |
|-----|----------|-------------|
| Browser → your Node/Bun app | WebSocket PCM16 you own | TypeScript (`WebSocketTransport`) |
| Agent → GPU media servers | gRPC | **Python** media processes |
| Agent → LLM | HTTP | TypeScript via Vercel AI SDK |

## Tenant context

`RunContext` (`tenantId`, `userId`, `sessionId`) is the identity you would send as gRPC metadata on every media call. Optional per-tenant server pools are a Python `ServerRegistry` feature.

## Browser testing with real GPUs

Use Python Voice Lab: [voice-lab.md](voice-lab.md) links the other repo. For TypeScript-only smoke tests, keep mock STT/TTS.

## Next steps

- [Voice Lab](voice-lab.md)
- [Pipelines](pipelines.md)
- [LLM via Vercel AI SDK](llm-vercel-ai.md)
