import { describe, expect, it } from "vitest";
import { buildCallSettings, sdkProviderName } from "../src/llm/adapters/vercel.js";
import type { LLMProviderConfig } from "../src/config/llm.js";

function config(partial: Partial<LLMProviderConfig> & { provider?: LLMProviderConfig["provider"] }): LLMProviderConfig {
  return {
    provider: partial.provider ?? "litellm",
    model: "gpt-4o",
    api_key: "",
    default_params: {},
    extra_headers: {},
    context_window_tokens: 128000,
    timeout: 60,
    max_retries: 3,
    retry_delay: 1,
    defaultParams: partial.defaultParams ?? partial.default_params ?? {},
    enableThinking: partial.enableThinking ?? partial.enable_thinking ?? null,
    ...partial,
  } as LLMProviderConfig;
}

describe("buildCallSettings", () => {
  it("maps reasoning_effort and extra_body onto providerOptions.litellm", () => {
    const settings = buildCallSettings(
      config({
        provider: "litellm",
        defaultParams: {
          reasoning_effort: "low",
          extra_body: { chat_template_kwargs: { enable_thinking: true } },
        },
      }),
    );
    expect(settings.reasoning_effort).toBeUndefined();
    expect(settings.extra_body).toBeUndefined();
    expect(settings.providerOptions).toEqual({
      litellm: {
        chat_template_kwargs: { enable_thinking: true },
        reasoningEffort: "low",
      },
    });
  });

  it("restores temperature from default_params", () => {
    const settings = buildCallSettings(
      config({
        provider: "openai",
        defaultParams: { temperature: 0.3 },
      }),
    );
    expect(settings.temperature).toBe(0.3);
    expect(settings.providerOptions).toBeUndefined();
  });

  it("lets a turn temperature override default_params", () => {
    const settings = buildCallSettings(
      config({ provider: "openai", defaultParams: { temperature: 0.3 } }),
      { temperature: 0.9 },
    );
    expect(settings.temperature).toBe(0.9);
  });

  it("writes enable_thinking into the matching sdk name, not openaiCompatible", () => {
    const settings = buildCallSettings(
      config({
        provider: "ollama",
        enableThinking: false,
        defaultParams: { extra_body: { chat_template_kwargs: { foo: 1 } } },
      }),
    );
    expect(settings.providerOptions).toEqual({
      ollama: {
        chat_template_kwargs: { foo: 1, enable_thinking: false },
      },
    });
  });

  it("lets explicit providerOptions win over folded extras", () => {
    const settings = buildCallSettings(
      config({
        provider: "litellm",
        defaultParams: {
          reasoning_effort: "low",
          providerOptions: { litellm: { reasoningEffort: "high" } },
        },
      }),
    );
    expect(settings.providerOptions).toEqual({
      litellm: { reasoningEffort: "high" },
    });
  });

  it("maps leftover unknown keys into the provider bag", () => {
    const settings = buildCallSettings(
      config({
        provider: "custom",
        defaultParams: { thinking: { type: "enabled" } },
      }),
    );
    expect(settings.thinking).toBeUndefined();
    expect(settings.providerOptions).toEqual({
      custom: { thinking: { type: "enabled" } },
    });
  });
});

describe("sdkProviderName", () => {
  it("uses the OpenAI-compatible constructor name", () => {
    expect(sdkProviderName("litellm")).toBe("litellm");
    expect(sdkProviderName("azure_openai")).toBe("openai");
    expect(sdkProviderName("gemini")).toBe("google");
  });
});
