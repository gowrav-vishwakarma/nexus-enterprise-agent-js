/** Ports of Python tests/test_config.py — configuration parsing and defaults. */

import { describe, expect, it } from "vitest";
import { parseAgentConfig } from "../src/config/agent.js";
import { getApiKey, parseLLMProviderConfig } from "../src/config/llm.js";
import { parseRuntimeContextSummarizerConfig } from "../src/config/rcs.js";

describe("config", () => {
  // PYTHON: test_llm_provider_config_validation
  it("validates LLMProviderConfig required fields and types", () => {
    const config = parseLLMProviderConfig({
      provider: "openai",
      model: "gpt-4o",
      api_key: "sk-test-key",
    });
    expect(config.provider).toBe("openai");
    expect(config.model).toBe("gpt-4o");
    expect(config.api_key).toBe("sk-test-key");
    expect(getApiKey(config)).toBe("sk-test-key");

    const configNoKey = parseLLMProviderConfig({ provider: "openai", model: "gpt-4o" });
    expect(getApiKey(configNoKey)).toBe("");
    expect(configNoKey.context_window_tokens).toBe(128000);
    expect(configNoKey.contextWindowTokens).toBe(128000);

    const configBudget = parseLLMProviderConfig({
      provider: "openai",
      model: "gpt-4o",
      api_key: "sk-test-key",
      context_window_tokens: 8000,
    });
    expect(configBudget.context_window_tokens).toBe(8000);
  });

  // PYTHON: test_agent_config_defaults
  it("initializes AgentConfig defaults", () => {
    const agent = parseAgentConfig({
      name: "test-agent",
      llm: { provider: "openai", model: "gpt-4o", api_key: "sk-test-key" },
    });
    expect(agent.name).toBe("test-agent");
    expect(agent.persona.role).toBe("Assistant");
    expect(agent.turns.max_turns).toBe(10);
    expect(agent.rcs.enabled).toBe(false);
    expect(agent.storage ?? null).toBeNull();
    expect(agent.trace_enabled).toBe(false);
    expect(agent.trace_sink).toBe("stdout");
  });

  // PYTHON: test_rcs_config_validation
  it("validates RCS configuration values and defaults", () => {
    const rcs = parseRuntimeContextSummarizerConfig({ enabled: true });
    expect(rcs.enabled).toBe(true);
    expect(rcs.tc_tag_format).toBe("[TC{n}]");
    expect(rcs.fallback_compactor.enabled).toBe(false);

    const rcsCustom = parseRuntimeContextSummarizerConfig({
      enabled: true,
      tc_tag_format: "<TC_TAG_{n}>",
    });
    expect(rcsCustom.tc_tag_format).toBe("<TC_TAG_{n}>");
  });

  it("keeps litellm baseUrl when nested in AgentConfig", () => {
    const agent = parseAgentConfig({
      name: "proxy-agent",
      llm: {
        provider: "litellm",
        model: "openai/qwen",
        api_key: "sk-test",
        base_url: "http://127.0.0.1:4000/",
      },
    });
    expect(agent.llm.base_url).toBe("http://127.0.0.1:4000/");
    expect(agent.llm.baseUrl).toBe("http://127.0.0.1:4000/");
  });
});
