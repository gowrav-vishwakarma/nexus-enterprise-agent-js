/**
 * Voice language config, startup validation, and language helpers.
 *
 * PYTHON sources:
 *   tests/test_realtime_language_validation.py
 *   tests/test_initial_response.py (validation + metadata only)
 *
 * Skipped (no TS port): nexus_server / Conformer language tables,
 * live gRPC metadata, MockLID clamp, stt_missing_server_ref.
 */

import { describe, expect, it } from "vitest";
import {
  createInitialResponseConfig,
  createLIDConfig,
  createRealtimeAgentConfig,
  createSTTConfig,
  type LanguageConfig,
  type LIDConfig,
  type RealtimeAgentConfig,
  type STTConfig,
} from "../src/realtime/config.js";
import {
  DEFAULT_LANGUAGE,
  detectLanguageRequest,
  LANGUAGES,
  resolve,
  ttsVoiceFor,
} from "../src/realtime/languages.js";
import {
  logValidationIssues,
  runStartupLanguageValidation,
  validateVoiceLanguages,
  validateVoiceLanguagesStatic,
} from "../src/realtime/validation.js";
import { testAgentConfig } from "./helpers.js";

function rtConfig(opts: {
  languages?: LanguageConfig | null;
  lid?: LIDConfig | null;
  stt?: STTConfig | null;
  duplex?: RealtimeAgentConfig["duplex"];
  initial_response?: RealtimeAgentConfig["initial_response"];
  tool_plugins?: string[];
} = {}): RealtimeAgentConfig {
  return createRealtimeAgentConfig({
    name: "voice_agent",
    modality: "voice_cascaded",
    duplex: opts.duplex ?? "full",
    agent: testAgentConfig({
      name: "voice_agent",
      tool_plugins: opts.tool_plugins ?? [],
    }),
    stt: opts.stt ?? createSTTConfig({ provider: "mock", language: "hi" }),
    lid: opts.lid ?? null,
    languages: opts.languages ?? null,
    initial_response: opts.initial_response ?? null,
  });
}

describe("validateVoiceLanguagesStatic", () => {
  // PYTHON test_en_allowed_without_lid_warns
  it("warns when English is allowed without LID", () => {
    const issues = validateVoiceLanguagesStatic(
      rtConfig({ languages: { allowed: ["hi", "en"], default: "hi" }, lid: null }),
    );
    expect(new Set(issues.map((i) => i.code)).has("en_requires_lid")).toBe(true);
  });

  it("does not warn about English when LID is configured", () => {
    const issues = validateVoiceLanguagesStatic(
      rtConfig({
        languages: { allowed: ["hi", "en"], default: "hi" },
        lid: createLIDConfig({ provider: "mock", fallback_language: "hi" }),
      }),
    );
    expect(issues.some((i) => i.code === "en_requires_lid")).toBe(false);
  });

  // PYTHON test_unknown_language_is_error
  it("errors on an unknown language code", () => {
    const issues = validateVoiceLanguagesStatic(
      rtConfig({ languages: { allowed: ["xx"], default: "xx" } }),
    );
    expect(issues.some((i) => i.severity === "error" && i.code === "unknown_language")).toBe(true);
  });

  it("warns when the default language is not in the allow-list", () => {
    const issues = validateVoiceLanguagesStatic(
      rtConfig({
        languages: { allowed: ["hi"], default: "en" },
        stt: createSTTConfig({ provider: "mock", language: "hi" }),
      }),
    );
    expect(issues.some((i) => i.code === "fallback_not_allowed")).toBe(true);
  });

  it("warns when LID fallback is not allowed", () => {
    const issues = validateVoiceLanguagesStatic(
      rtConfig({
        languages: { allowed: ["hi"], default: "hi" },
        lid: createLIDConfig({ provider: "mock", fallback_language: "en" }),
      }),
    );
    expect(issues.some((i) => i.code === "lid_fallback_not_allowed")).toBe(true);
  });

  it("accepts the known Indic allow-list", () => {
    const issues = validateVoiceLanguagesStatic(
      rtConfig({
        languages: { allowed: ["hi", "gu", "ta"], default: "hi" },
        lid: createLIDConfig({ provider: "mock", fallback_language: "hi" }),
      }),
    );
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  // PYTHON test_validation_proactive_missing_text
  it("errors when proactive greeting has no text and via_llm is false", () => {
    const issues = validateVoiceLanguagesStatic(
      rtConfig({
        languages: { allowed: ["hi", "en"], default: "hi" },
        initial_response: createInitialResponseConfig({ mode: "proactive", via_llm: false }),
      }),
    );
    expect(issues.some((i) => i.code === "initial_response_missing_text")).toBe(true);
  });

  it("accepts a proactive greeting with text", () => {
    const issues = validateVoiceLanguagesStatic(
      rtConfig({
        languages: { allowed: ["hi"], default: "hi" },
        initial_response: createInitialResponseConfig({
          mode: "proactive",
          text: "Namaste!",
          via_llm: false,
        }),
      }),
    );
    expect(issues.some((i) => i.code.startsWith("initial_response_"))).toBe(false);
  });

  // PYTHON test_validation_ivr_warnings
  it("warns when IVR is not half duplex and has no ivr_menu plugin", () => {
    const issues = validateVoiceLanguagesStatic(
      rtConfig({
        languages: { allowed: ["hi", "en"], default: "hi" },
        initial_response: createInitialResponseConfig({ mode: "ivr", via_llm: true }),
        duplex: "full",
      }),
    );
    const codes = new Set(issues.map((i) => i.code));
    expect(codes.has("initial_response_ivr_not_half_duplex")).toBe(true);
    expect(codes.has("initial_response_ivr_no_plugin")).toBe(true);
  });

  it("errors when IVR has no script or text", () => {
    const issues = validateVoiceLanguagesStatic(
      rtConfig({
        languages: { allowed: ["hi"], default: "hi" },
        initial_response: createInitialResponseConfig({ mode: "ivr", via_llm: false }),
        duplex: "half",
      }),
    );
    expect(issues.some((i) => i.code === "initial_response_missing_script")).toBe(true);
  });

  it("accepts IVR with a script on half duplex", () => {
    const issues = validateVoiceLanguagesStatic(
      rtConfig({
        languages: { allowed: ["hi"], default: "hi" },
        duplex: "half",
        initial_response: createInitialResponseConfig({
          mode: "ivr",
          via_llm: false,
          ivr_script: ["Welcome.", "Press 1 for sales."],
        }),
      }),
    );
    expect(issues.some((i) => i.code.startsWith("initial_response_"))).toBe(false);
  });

  it("skips initial-response checks when mode is none", () => {
    const issues = validateVoiceLanguagesStatic(
      rtConfig({
        languages: { allowed: ["hi"], default: "hi" },
        initial_response: createInitialResponseConfig({ mode: "none" }),
      }),
    );
    expect(issues.some((i) => i.code.startsWith("initial_response_"))).toBe(false);
  });
});

describe("logValidationIssues / async wrappers", () => {
  // PYTHON test_strict_mode_raises
  it("throws in strict mode when there are errors", () => {
    const prev = process.env.NEXUS_VOICE_STRICT_LANG;
    process.env.NEXUS_VOICE_STRICT_LANG = "1";
    try {
      expect(() =>
        logValidationIssues([{ severity: "error", code: "unknown_language", message: "bad code" }]),
      ).toThrow(/Voice language validation failed/);
    } finally {
      if (prev == null) delete process.env.NEXUS_VOICE_STRICT_LANG;
      else process.env.NEXUS_VOICE_STRICT_LANG = prev;
    }
  });

  it("does not throw for warnings even in strict mode", () => {
    expect(() =>
      logValidationIssues(
        [{ severity: "warning", code: "en_requires_lid", message: "need lid" }],
        { strict: true },
      ),
    ).not.toThrow();
  });

  it("validateVoiceLanguages matches the static helper", async () => {
    const cfg = rtConfig({ languages: { allowed: ["xx"], default: "xx" } });
    const asyncIssues = await validateVoiceLanguages(cfg);
    const staticIssues = validateVoiceLanguagesStatic(cfg);
    expect(asyncIssues).toEqual(staticIssues);
  });

  it("runStartupLanguageValidation returns issues", async () => {
    const issues = await runStartupLanguageValidation(
      rtConfig({ languages: { allowed: ["hi"], default: "hi" } }),
    );
    expect(Array.isArray(issues)).toBe(true);
  });
});

describe("language helpers", () => {
  it("resolve falls back to Hindi", () => {
    expect(resolve("ta").name).toBe("Tamil");
    expect(resolve("xx").code).toBe(DEFAULT_LANGUAGE);
    expect(resolve(null).code).toBe("hi");
    expect(Object.keys(LANGUAGES).sort()).toEqual(["bn", "en", "gu", "hi", "mr", "ta", "te"]);
  });

  it("ttsVoiceFor uses the language description", () => {
    expect(ttsVoiceFor("gu")).toContain("Neha");
    expect(ttsVoiceFor(null, "custom-voice")).toBe("custom-voice");
  });

  it("detectLanguageRequest finds a switch intent", () => {
    expect(detectLanguageRequest("please talk in hindi")).toBe("hi");
    expect(detectLanguageRequest("speak English")).toBe("en");
    expect(detectLanguageRequest("change to Gujarati")).toBe("gu");
    expect(detectLanguageRequest("just hello")).toBeNull();
    expect(detectLanguageRequest("")).toBeNull();
    expect(detectLanguageRequest("talk tamil", { allowed: new Set(["hi"]) })).toBeNull();
    expect(detectLanguageRequest("talk tamil", { allowed: new Set(["ta"]) })).toBe("ta");
  });
});
