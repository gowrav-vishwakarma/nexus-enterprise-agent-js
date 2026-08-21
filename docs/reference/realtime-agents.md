# Realtime, voice, vision, and channels

**Who this is for:** Developers adding voice (browser), images, or messaging channels (Telegram/WhatsApp) to Nexus agents **in TypeScript**.

## Key terms

- **Modality** — How an agent handles media: `text`, `vision_text`, `voice_cascaded`, `voice_s2s`.
- **Cascaded voice** — A pipeline of separate stages: VAD → STT → LLM → TTS.
- **Speech-to-speech (S2S)** — One realtime model that takes audio and returns audio.
- **VAD** — Voice Activity Detection: decides when the caller started/stopped talking.
- **STT / TTS** — Speech-to-text / text-to-speech.
- **Duplex** — `half` = strict turn-taking (IVR); `full` = the user can interrupt (barge-in).
- **Channel** — An I/O edge (browser, Telegram, WhatsApp) normalized to agent input.

This package is **client-side**. It ships mock STT/TTS, an energy VAD, WebSocket / in-memory transports, and channel adapters. **GPU media servers** (Conformer, Parler, Silero, Whisper LID, gRPC process launcher) stay in the [Python package](https://github.com/gowrav-vishwakarma/nexus-enterprise-agent). Talk to those servers as a sidecar — see [server.md](server.md).

Import realtime symbols from `nexus-enterprise-agent/realtime`.

Everything here sits **on top of the unchanged text `AgentRunner`**. Personas, tools, memory, and RCS work the same.

## Multimodal input

`UserInput` carries text plus optional images and audio.

```ts
import { UserInput } from "nexus-enterprise-agent/realtime";

UserInput.from_text("hello");
UserInput.from_image_url("https://example.com/cat.png", "what is this?");
UserInput.from_image_bytes(pngBytes, "describe", "image/png");
```

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `from_text(text)` | Yes | — | Plain text turn |
| `from_image_url(url, text?)` | Yes | `text=""` | Image by URL plus optional caption |
| `from_image_bytes(bytes, text?, mime?)` | Yes | `image/png` | Image from bytes |

## Cascaded voice (VAD → STT → LLM → TTS)

`CascadedVoicePipeline` is modular: each stage is swappable. The agent's streamed text reply is synthesized sentence-by-sentence, so audio can start before the full reply is ready.

### Client-side providers in this package

| Stage | Providers | Notes |
|-------|-----------|-------|
| STT | `mock` | Decodes bytes as UTF-8 text (tests/demos) |
| TTS | `mock` | Returns `AUDIO:` + text bytes |
| VAD | `energy` (built-in), `mock` | `energy` needs no extra deps |

Cloud or GPU engines (`openai`, `deepgram`, `nexus_server`) are configured in YAML the same way as Python. The TypeScript runtime talks to a **Python sidecar** when `provider: nexus_server` and `server_ref` point at a running gRPC process. Start those processes with the Python CLI (`python -m nexus.server up`). See [server.md](server.md).

```yaml
agents:
  voice_demo:
    modality: voice_cascaded
    duplex: full
    stt: { provider: mock, language: en }
    tts: { provider: mock }
    vad: { provider: energy, silence_ms: 600 }
    agent:
      llm: { provider: openai, model: gpt-4o, api_key: ${ENV:OPENAI_API_KEY} }
      persona: { prompt: voice_system }
```

### Language config

| Field | Required? | Default | What it does |
|-------|-----------|---------|--------------|
| `allowed` | Yes (if block present) | — | ISO codes supported for STT, reply, and TTS |
| `default` | No | `stt.language` or `en` | Fallback when LID is off or detection is out-of-allowed |

Set `NEXUS_VOICE_STRICT_LANG=1` to fail startup when language codes do not match engine metadata.

### Voice metadata (prompts and tools)

`RunContext.metadata` is rendered in Nunjucks system prompts as `metadata.*` on **every LLM turn**. The cascaded voice pipeline sets these keys:

| Key | When set | Prompt use | Tool use |
|-----|----------|------------|----------|
| `reply_language` | Connect (seed) + each turn | `{{ metadata.reply_language }}` | — |
| `reply_language_name` | Connect (seed) + each turn | `{{ metadata.reply_language_name }}` | — |
| `detected_language` | Each turn after LID | `{{ metadata.detected_language }}` | — |
| `allowed_languages` | Connect + each turn | `{{ metadata.allowed_languages }}` | — |
| `ivr_actions` | IVR tool calls | — | Read after LLM turn |
| `dtmf_buffer` | Transport | — | `collect_dtmf` reads caller digits |
| `dtmf_expected` | `collect_dtmf` tool | — | Transport hint for digit count |
| `ivr_terminal` | `transfer_call` / `hang_up` | — | Pipeline stops after terminal turn |

### Connect-time initial response

| Field | Required? | Default | What it does |
|-------|-----------|---------|--------------|
| `mode` | No | `none` | `none`, `proactive` (greeting), or `ivr` |
| `text` | No | — | Fixed text for direct TTS (`via_llm: false`) |
| `via_llm` | No | `false` | `true` → LLM turn with `llm_trigger`; `false` → direct TTS |
| `llm_trigger` | No | mode default | Hidden user message for the connect LLM turn |
| `ivr_script` | No | — | Ordered lines for IVR mode without LLM |
| `emit_transcript` | No | `false` | Show connect trigger as a user transcript event |
| `reply_language` | No | `languages.default` | TTS language for the greeting |

### TypeScript API

```ts
import {
  RealtimeRuntime,
  RealtimeSession,
  WebSocketTransport,
} from "nexus-enterprise-agent/realtime";

const runtime = RealtimeRuntime.fromManifest(manifest, { runContext: ctx });
const pipeline = runtime.buildPipeline("voice_demo");

for await (const ev of pipeline.processText("book a flight", "s1")) {
  // transcript_final, content, audio_out, tool_call, barge_in, final_response
}

const session = new RealtimeSession(pipeline, new WebSocketTransport(ws), "call-1");
await session.runAudio();
```

Each step yields a `RealtimeStreamEvent` (`transcript_final`, `content`, `audio_out`, `tool_call`, `barge_in`, `final_response`, …).

## Speech-to-speech (S2S)

`SpeechToSpeechPipeline` drives a single realtime model. It still uses your agent's persona (as instructions) and **bridges your tools** to the model's function calling.

```ts
import { SpeechToSpeechPipeline } from "nexus-enterprise-agent/realtime";

const pipeline = new SpeechToSpeechPipeline(rtConfig, {
  toolRegistry: registry,
  runContext: ctx,
});
for await (const ev of pipeline.processAudioStream(audioFrames, "s1")) {
  // ...
}
```

This package ships a **mock** S2S adapter for tests. Live duplex models (OpenAI Realtime, Moshi, Human-1) and GPU serving stay in the Python stack or your own adapter.

## Half-duplex IVR and full-duplex barge-in

For phone menus, set `duplex: half`. DTMF the caller presses is read from `RunContext.metadata.dtmf_buffer`.

With `duplex: full`, `processAudioStream` listens while it speaks. A new speech start while the agent is talking emits a `barge_in` event and cancels the in-flight response.

## Voice teams

```yaml
groups:
  support_team:
    pattern: voice_team
    context_injection_var: live_context
    members:
      - { name: responder, role: responder }
      - { name: context_agent, role: context_agent }
```

`buildVoiceTeam(name)` returns a `VoiceTeamConfig` (responder + optional context agent). Wire the responder pipeline yourself with `pipelineFor(team.responder)`.

## Transports

| Transport | Use case |
|-----------|----------|
| `InMemoryTransport` | tests, local simulation |
| `WebSocketTransport` | browser / generic WS (PCM16) |

Twilio / SIP transports and the Voice Lab UI live in the Python package.

When given an `eventEmitter`, `RealtimeSession` emits `realtime.session_started`, `realtime.transcribed`, `realtime.barge_in`, `realtime.response_completed`, `realtime.session_ended`.

## Messaging channels

A **channel** normalizes any provider into `UserInput` + `RunContext`, runs your agent, and renders the reply back.

`ChannelRouter`, `TelegramAdapter`, and `WhatsAppAdapter` live in this package's channels module. Construct a router with an adapter, an `executorFactory` that returns an `AgentRunner`, and an identity resolver:

```ts
const router = new ChannelRouter(
  telegramAdapter,
  (ctx) => new AgentRunner({ config, toolRegistry: registry, runContext: ctx }),
  { identityResolver: new StaticIdentityResolver("acme") },
);
const output = await router.handle(updatePayload);
```

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `adapter` | Yes | — | `TelegramAdapter` or `WhatsAppAdapter` |
| `executorFactory` | Yes | — | `(ctx) => AgentRunner` (or vision runner) |
| `identityResolver` | No | empty | Maps inbound user → `RunContext` |
| `stt` | No | — | Transcribe voice notes |
| `visionExecutorFactory` | No | — | Route images to a vision-capable runner |

This package does **not** ship FastAPI webhooks. Mount `router.handle()` on your own HTTP route.

## Next steps

- [Server sidecar](server.md)
- [Manifest schema](manifest-schema.md)
- [Streaming](streaming.md)
- [Architecture](../architecture.md)
