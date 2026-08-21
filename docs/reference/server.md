# Media servers (Python sidecar)

**Who this is for:** Developers who need GPU speech-to-text, text-to-speech, VAD, or language-id processes. Those processes **do not ship in this TypeScript package**.

## Key terms

- **Media server** — A long-running gRPC process that loads one model (STT, TTS, VAD, LID) and listens on `host:port`.
- **Sidecar** — The Python process (or set of processes) your TypeScript app talks to.
- **`server_ref`** — A label in the agent YAML (`stt.server_ref: indic_stt`) that points at one entry under `servers:`.
- **LID** — Language identification: detects which language the user spoke before transcription.

GPU engines, proto files, `nexus.server up`, Voice Lab, and tenant GPU pools live in:

**[github.com/gowrav-vishwakarma/nexus-enterprise-agent](https://github.com/gowrav-vishwakarma/nexus-enterprise-agent)**

Read the full field tables there: [docs/reference/server.md](https://github.com/gowrav-vishwakarma/nexus-enterprise-agent/blob/main/docs/reference/server.md).

## What TypeScript does

This package is the **client-side runtime**. It:

1. Parses the same `servers:` and `stt` / `tts` / `vad` / `lid` YAML blocks (snake_case).
2. Resolves `server_ref` → `host:port` when you point at a running sidecar.
3. Ships **mock** STT/TTS and **energy** VAD so you can test without GPUs.

It does **not** start CUDA processes, regenerate protobuf, or run Voice Lab.

## Typical split

```text
TypeScript app (this package)
  AgentRunner / CascadedVoicePipeline / WebSocketTransport
        │  gRPC or HTTP
        ▼
Python sidecar (nexus-enterprise-agent)
  nexus.server up -c servers.yaml
  STT :50051   TTS :50052   VAD :50053   LID :50054
```

```yaml
# In your TS manifest — connection map only
servers:
  indic_stt: { kind: stt, engine: conformer, port: 50051 }
agents:
  voice:
    modality: voice_cascaded
    stt: { provider: nexus_server, server_ref: indic_stt, language: en }
```

Start the processes from the Python repo:

```bash
uv run python -m nexus.server up -c examples/servers.yaml
```

## Manifest fields (summary)

The TypeScript schema accepts the same top-level `servers:` map as Python. Full engine `extra` keys, replica counts, and proto RPCs are documented in the Python page linked above.

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `kind` | Yes | — | `stt`, `tts`, `vad`, or `lid` |
| `engine` | Yes | — | Engine id on the **Python** process (`mock`, `conformer`, `parler`, …) |
| `host` | No | `127.0.0.1` | Where the sidecar listens |
| `port` | Yes | — | gRPC port |
| `server_ref` (on `stt`/`tts`/…) | Yes* | — | Label matching a `servers:` key (`*` unless `base_url` is set) |

## Next steps

- [Realtime agents](realtime-agents.md) — client pipelines in this package
- [Manifest schema](manifest-schema.md) — `servers:` on the YAML document
- Python [server reference](https://github.com/gowrav-vishwakarma/nexus-enterprise-agent/blob/main/docs/reference/server.md)
