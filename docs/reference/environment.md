# Environment variables

**Who this is for:** Developers configuring paths, test LLM endpoints, and YAML interpolation.

## Key terms

- **Framework vars** — Read inside Nexus (data paths, skills root).
- **App vars** — Your application reads these; Nexus config models do not auto-load LLM keys.
- **Live LLM** — A real provider call in Vitest, gated by `NEXUS_LIVE_LLM`.

Nexus builds `LLMProviderConfig` explicitly in code or via `${ENV:...}` in YAML manifests.

## Framework path defaults

| Variable | Default | What it does |
|----------|---------|--------------|
| `NEXUS_DATA_ROOT` | `./tenants` | Root folder for tenant/user session and memory files |
| `NEXUS_SKILLS_ROOT` | `./skills` | Root folder for agentskills.io `SKILL.md` folders |

Layout under `NEXUS_DATA_ROOT`:

```text
{NEXUS_DATA_ROOT}/{tenant_id}/users/{user_id}/
  sessions.db
  memory.db
  {session_id}/session.json
```

## LLM keys (app-level)

Nexus does **not** read these into a global settings object. Pass them into `LLMProviderConfig` or interpolate them in YAML.

| Variable | What it does |
|----------|--------------|
| `NEXUS_LLM_PROVIDER` | Provider hint for live tests (`openai`, `litellm`, `custom`, …) |
| `NEXUS_LLM_BASE_URL` | Custom / proxy API base URL (Vercel AI SDK OpenAI-compatible client) |
| `NEXUS_LLM_API_KEY` | Key for that endpoint |
| `NEXUS_LLM_MODEL` | Model string (e.g. `openai/qwen`, `gpt-4o`) |
| `OPENAI_API_KEY` | Typical YAML interpolation for OpenAI |
| `ANTHROPIC_API_KEY` | Typical YAML interpolation for Anthropic |
| `GROQ_API_KEY` | Typical YAML interpolation for Groq |
| `LITELLM_BASE_URL` / `LITELLM_API_KEY` | Aliases accepted by live tests if `NEXUS_LLM_*` is unset |

```yaml
llm:
  provider: openai
  model: ${ENV:NEXUS_LLM_MODEL|gpt-4o}
  api_key: ${ENV:NEXUS_LLM_API_KEY}
  base_url: ${ENV:NEXUS_LLM_BASE_URL}
```

Copy [.env.example](../../.env.example) to `.env`. Do not commit secrets.

## Live tests

| Variable | What it does |
|----------|--------------|
| `NEXUS_LIVE_LLM` | Set to `1` to run real-model Vitest cases (`npm run test:live`) |

Without `NEXUS_LIVE_LLM=1`, `npm test` stays on `MockLLMAdapter`. Live cases also need `NEXUS_LLM_API_KEY` (or `LITELLM_API_KEY`) and usually `NEXUS_LLM_BASE_URL`. See [eval.md](eval.md).

## Optional database peers

PostgreSQL and Redis adapters are optional peers (`postgres`, `ioredis`). They are not fully wired yet and fall back to memory. When they land, typical app-level vars are:

| Variable | What it does |
|----------|--------------|
| `NEXUS_PG_DSN` | PostgreSQL connection string |
| `NEXUS_REDIS_URL` | Redis connection URL |

SQLite uses `@libsql/client` and files under `NEXUS_DATA_ROOT` — no DSN required. See [storage.md](storage.md).

## Realtime / voice (client + sidecar)

GPU servers stay in the [Python package](https://github.com/gowrav-vishwakarma/nexus-enterprise-agent). These vars are useful when the TypeScript app points at that sidecar or at cloud STT/TTS:

| Variable | What it does |
|----------|--------------|
| `NEXUS_VOICE_STRICT_LANG` | `1` / `true` to fail startup on language validation errors |
| `NEXUS_STT_PROVIDER` / `NEXUS_TTS_PROVIDER` | Cloud or `mock` for manifests that interpolate them |
| `DEEPGRAM_API_KEY` | Deepgram STT (if your app uses it) |

Voice Lab, `nexus.server up`, and engine device flags (`STT_DEVICE`, `TTS_ENGINE`, …) belong to the Python repo.

## Messaging channels (app-level, optional)

| Variable | What it does |
|----------|--------------|
| `TELEGRAM_BOT_TOKEN` | Enables the Telegram channel adapter in your app |
| `WHATSAPP_TOKEN` | WhatsApp Cloud API access token |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp sender phone number id |
| `WHATSAPP_VERIFY_TOKEN` | Webhook verification token |

Your HTTP server reads these. Nexus does not start a webhook listener.

## YAML env interpolation

In orchestration manifests only:

```yaml
api_key: ${ENV:OPENAI_API_KEY}
model: ${ENV:OPENAI_MODEL|gpt-4o}
```

| Form | What it does |
|------|--------------|
| `${ENV:VAR_NAME}` | Substitute the environment variable |
| `${ENV:VAR_NAME|fallback}` | Use fallback if unset |

## Next steps

- [Storage](storage.md)
- [Eval](eval.md)
- [.env.example](../../.env.example)
