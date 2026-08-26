# LLM connection via the Vercel AI SDK

**Who this is for:** Anyone wiring `llm.provider`, `model`, `base_url`, and `api_key` on an agent.

Nexus TypeScript routes LLM calls through the **Vercel AI SDK** (`ai` plus provider packages). You host models however you like (vLLM, SGLang, Ollama, LiteLLM proxy, cloud APIs). Nexus only needs `provider`, `model`, `base_url`, and `api_key` on each agent's `llm` block.

The persona system prompt is passed as the AI SDK `system` option, not as a `{ role: "system" }` message. That matches the SDK’s recommended (and safer) call shape.

The Python package uses liteLLM for the same job. The config shape (`provider` + `base_url`) is the same idea; the transport here is Vercel AI.

## Key terms

- **Vercel AI SDK** — The TypeScript library (`ai`, `@ai-sdk/*`) that talks to model APIs.
- **Provider** — A string on `LLMProviderConfig` (`openai`, `anthropic`, `ollama`, `litellm`, `custom`, …).
- **Compatible endpoint** — Any OpenAI-shaped HTTP API. Use `provider: custom` or `litellm` and set `base_url`.

## Per-agent LLM selection

Each `AgentConfig` has its own `llm`. Text and voice agents in the same manifest can use different models, tools, and `default_params`.

```yaml
defaults:
  llm_fast: &llm_fast
    provider: ollama
    model: ${ENV:VOICE_LLM_MODEL|qwen3:4b}
    base_url: ${ENV:OLLAMA_BASE_URL|http://localhost:11434/v1}
    api_key: ${ENV:OLLAMA_API_KEY|ollama}
    default_params:
      max_tokens: 150
      temperature: 0.7

  llm_smart: &llm_smart
    provider: openai
    model: ${ENV:TEXT_LLM_MODEL|gpt-4o-mini}
    api_key: ${ENV:OPENAI_API_KEY}
    default_params:
      max_tokens: 4096

agents:
  erp_assistant:
    llm: *llm_smart
    toolset: erp_tools

  voice_local:
    modality: voice_cascaded
    agent:
      llm: *llm_fast
      toolset: voice_tools
```

## Provider + `base_url` map

| `provider` | Typical `model` | `base_url` | Optional peer |
|------------|-----------------|------------|---------------|
| `openai` | `gpt-4o-mini` | omit (official API) | `@ai-sdk/openai` |
| `anthropic` | `claude-sonnet-4-5` | omit | `@ai-sdk/anthropic` |
| `gemini` | `gemini-2.0-flash` | omit | `@ai-sdk/google` |
| `groq` | `llama-3.3-70b-versatile` | omit | `@ai-sdk/groq` |
| `azure_openai` | your deployment name | Azure resource URL | `@ai-sdk/azure` or `@ai-sdk/openai` |
| `bedrock` | Bedrock model id | omit (`AWS_REGION`) | `@ai-sdk/amazon-bedrock` |
| `ollama` | `qwen3:4b` | `http://localhost:11434/v1` | (uses `@ai-sdk/openai-compatible`) |
| `openrouter` | `openai/gpt-4o-mini` | `https://openrouter.ai/api/v1` | (OpenAI-compatible) |
| `litellm` | name registered on your proxy | **required** (e.g. `http://localhost:4000`) | (OpenAI-compatible) |
| `custom` | your model name | **required** | (OpenAI-compatible) |

`litellm` and `custom` always need `base_url`. That is how TypeScript points at a LiteLLM proxy, vLLM, or SGLang OpenAI-compatible server — the same `provider` + `base_url` idea as Python liteLLM.

## Optional peers

Install only the provider packages you use (`optionalDependencies` in `package.json`):

```bash
npm install @ai-sdk/openai
npm install @ai-sdk/anthropic
npm install @ai-sdk/google
npm install @ai-sdk/groq
npm install @ai-sdk/amazon-bedrock
```

`ai` and `@ai-sdk/openai-compatible` are already core dependencies (Ollama, OpenRouter, LiteLLM proxy, and `custom`).

## Reasoning models, `extra_body`, and headers

The Vercel AI SDK accepts a few **top-level** call settings (`temperature`, `max_tokens` as `maxOutputTokens`, `topP`, and so on) plus **`providerOptions`**. A **provider option** is an extra field the vendor API accepts that the SDK does not list as a shared setting.

Nexus copies known sampling keys from `default_params` onto the call. LiteLLM-style keys (`reasoning_effort`, `extra_body`, and any leftover object) go under `providerOptions.<providerName>`:

| `provider` | `providerOptions` key |
|------------|------------------------|
| `openai`, `azure_openai` | `openai` |
| `anthropic` | `anthropic` |
| `litellm` | `litellm` |
| `ollama` | `ollama` |
| `openrouter` | `openrouter` |
| `custom` | `custom` |

You can still write LiteLLM names. This:

```yaml
default_params:
  temperature: 0.3
  reasoning_effort: low
  extra_body:
    chat_template_kwargs:
      enable_thinking: true
```

becomes `temperature` at the top level and `providerOptions.litellm.reasoningEffort` plus the extra-body fields. You may also set `default_params.providerOptions` yourself; those keys win if both are present. Leave `reasoning_effort` unset or empty to omit it — many OpenAI-compatible models reject the field.

**Thinking follows your model's own setting by default.** Nexus does not turn it on or off behind your back. When a model does think, Nexus streams it as `reasoning` events, separate from the answer.

**Turn it off for voice.** Reasoning models otherwise spend the first few seconds emitting a `<think>…</think>` block before any speakable text. Set `enable_thinking: false` on the voice agent's LLM config. Nexus writes that into `providerOptions.<providerName>.chat_template_kwargs.enable_thinking`.

```yaml
defaults:
  llm_fast: &llm_fast
    provider: ollama
    model: ${ENV:VOICE_LLM_MODEL|qwen3:4b}
    base_url: ${ENV:OLLAMA_BASE_URL|http://localhost:11434/v1}
    api_key: ollama
    enable_thinking: false
    default_params:
      max_tokens: 400
      temperature: 0.4
      extra_body:
        chat_template_kwargs:
          enable_thinking: false
    extra_headers:
      x-my-route: voice
```

For a smart (non-voice) agent, leave `enable_thinking` unset to keep the model's own behaviour, or set it to `true` to ask for reasoning explicitly.

A self-hosted vLLM or SGLang deployment only reports reasoning separately when it was started with a matching `--reasoning-parser`. Without that flag the `<think>` block stays inside normal content.

## TypeScript config

```ts
import { parseAgentConfig } from "nexus-enterprise-agent";

const config = parseAgentConfig({
  name: "assistant",
  llm: {
    provider: "openai",
    model: "gpt-4o-mini",
    api_key: process.env.OPENAI_API_KEY ?? "",
    base_url: process.env.OPENAI_BASE_URL ?? null,
    extra_headers: {},
    default_params: { temperature: 0.3 },
    enable_thinking: null,
  },
});
```

Without a real key, inject `llmAdapter: new MockLLMAdapter()` on `AgentRunner`.

## Voice teams

Each team member has its own `llm` — the responder can use a fast model while `context_agent` uses a smarter one. GPU STT/TTS still stay in the [Python package](https://github.com/gowrav-vishwakarma/nexus-enterprise-agent). See [voice-lab.md](voice-lab.md).
