/**
 * Multimodal input models and realtime config defaults.
 *
 * PYTHON source: tests/test_realtime_input.py
 *
 * Skipped (no TS port): VisionContextBuilder, content_parts_to_openai.
 */

import { describe, expect, it } from "vitest";
import {
  AudioPart,
  ImageBase64Part,
  ImageUrlPart,
  TextPart,
  UserInput,
} from "../src/realtime/input.js";
import {
  createInitialResponseConfig,
  createLIDConfig,
  createRealtimeAgentConfig,
  createS2SConfig,
  createSTTConfig,
  createTTSConfig,
  createVADConfig,
  createVoiceTeamConfig,
  effectiveInitialResponse,
  effectiveLanguages,
  effectiveLid,
  effectiveS2s,
  effectiveStt,
  effectiveTts,
  effectiveVad,
  effectiveTtsParams,
  isVoice,
} from "../src/realtime/config.js";
import { testAgentConfig } from "./helpers.js";

describe("UserInput", () => {
  // PYTHON test_user_input_text_roundtrip
  it("round-trips text", () => {
    const ui = UserInput.from_text("hello world");
    expect(ui.to_text()).toBe("hello world");
    expect(ui.has_images()).toBe(false);
    expect(ui.has_audio()).toBe(false);
    expect(ui.text_parts()).toHaveLength(1);
    expect(ui.text_parts()[0]).toBeInstanceOf(TextPart);
  });

  // PYTHON test_user_input_image_url
  it("attaches an image URL and optional caption", () => {
    const ui = UserInput.from_image_url("https://x/y.png", "what is this?");
    expect(ui.to_text()).toBe("what is this?");
    expect(ui.has_images()).toBe(true);
    expect(ui.image_parts()).toHaveLength(1);
    expect(ui.image_parts()[0]).toBeInstanceOf(ImageUrlPart);
    expect((ui.image_parts()[0] as ImageUrlPart).url).toBe("https://x/y.png");
    expect((ui.image_parts()[0] as ImageUrlPart).detail).toBe("auto");
  });

  it("from_image_bytes adds a base64 part", () => {
    const ui = UserInput.from_image_bytes(Buffer.from("\x89PNG"), "look", "image/png");
    expect(ui.to_text()).toBe("look");
    expect(ui.has_images()).toBe(true);
    expect(ui.image_parts()[0]).toBeInstanceOf(ImageBase64Part);
  });

  it("joins multiple text parts", () => {
    const ui = new UserInput([new TextPart("hello"), new TextPart("world")]);
    expect(ui.to_text()).toBe("hello world");
  });

  it("stores metadata", () => {
    const ui = UserInput.from_text("hi", { channel: "telegram" });
    expect(ui.metadata.channel).toBe("telegram");
  });
});

describe("ImageBase64Part / AudioPart", () => {
  // PYTHON test_image_base64_data_url
  it("builds a data URL from raw bytes", () => {
    const part = ImageBase64Part.from_bytes(Buffer.from("\x89PNG"), "image/png");
    const url = part.to_data_url();
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
    const decoded = Buffer.from(url.split(",", 2)[1]!, "base64");
    expect(decoded.equals(Buffer.from("\x89PNG"))).toBe(true);
  });

  // PYTHON test_audio_part_roundtrip
  it("round-trips audio bytes and sample rate", () => {
    const part = AudioPart.from_bytes(Buffer.from("RIFFdata"), "audio/wav", 16000);
    expect(part.to_bytes().equals(Buffer.from("RIFFdata"))).toBe(true);
    const ui = new UserInput([part]);
    expect(ui.has_audio()).toBe(true);
    expect(ui.audio_parts()[0]?.sample_rate).toBe(16000);
    expect(ui.audio_parts()[0]?.mime_type).toBe("audio/wav");
  });

  it("accepts Uint8Array for from_bytes helpers", () => {
    const img = ImageBase64Part.from_bytes(Uint8Array.from([1, 2, 3]));
    const audio = AudioPart.from_bytes(Uint8Array.from([4, 5, 6]), "audio/ogg", 8000);
    expect(img.data).toBe(Buffer.from([1, 2, 3]).toString("base64"));
    expect(audio.to_bytes().equals(Buffer.from([4, 5, 6]))).toBe(true);
  });
});

describe("RealtimeAgentConfig defaults", () => {
  // PYTHON test_realtime_agent_config_defaults
  it("defaults to cascaded full-duplex voice", () => {
    const cfg = createRealtimeAgentConfig({
      name: "ivr",
      agent: testAgentConfig({ name: "vision" }),
    });
    expect(cfg.modality).toBe("voice_cascaded");
    expect(cfg.duplex).toBe("full");
    expect(isVoice(cfg)).toBe(true);
    expect(effectiveStt(cfg).provider).toBe("mock");
    expect(effectiveTts(cfg).provider).toBe("mock");
    expect(effectiveVad(cfg).provider).toBe("energy");
    expect(effectiveLid(cfg)).toBeNull();
    expect(effectiveInitialResponse(cfg).mode).toBe("none");
    expect(effectiveS2s(cfg).provider).toBe("openai_realtime");
  });

  it("isVoice is false for text modalities", () => {
    const cfg = createRealtimeAgentConfig({
      name: "text",
      modality: "text",
      agent: testAgentConfig(),
    });
    expect(isVoice(cfg)).toBe(false);
  });

  it("isVoice is true for speech-to-speech", () => {
    const cfg = createRealtimeAgentConfig({
      name: "s2s",
      modality: "voice_s2s",
      agent: testAgentConfig(),
    });
    expect(isVoice(cfg)).toBe(true);
  });

  it("effectiveLanguages uses stt language and all known codes when omitted", () => {
    const cfg = createRealtimeAgentConfig({
      name: "langs",
      agent: testAgentConfig(),
      stt: createSTTConfig({ language: "ta" }),
    });
    const langs = effectiveLanguages(cfg);
    expect(langs.default).toBe("ta");
    expect(langs.allowed).toContain("ta");
    expect(langs.allowed).toContain("hi");
    expect(langs.allowed).toEqual([...langs.allowed].sort());
  });

  it("effectiveLanguages keeps an explicit allow-list", () => {
    const cfg = createRealtimeAgentConfig({
      name: "langs",
      agent: testAgentConfig(),
      stt: createSTTConfig({ language: "hi" }),
      languages: { allowed: ["hi", "en"], default: "hi" },
    });
    expect(effectiveLanguages(cfg)).toEqual({ allowed: ["hi", "en"], default: "hi" });
  });

  it("effectiveLid returns configured LID", () => {
    const lid = createLIDConfig({ provider: "mock", fallback_language: "en" });
    const cfg = createRealtimeAgentConfig({
      name: "lid",
      agent: testAgentConfig(),
      lid,
    });
    expect(effectiveLid(cfg)?.fallback_language).toBe("en");
  });

  it("factory helpers fill defaults", () => {
    expect(createSTTConfig().sample_rate).toBe(16000);
    expect(createSTTConfig().interim_results).toBe(true);
    expect(createTTSConfig().audio_format).toBe("pcm16");
    expect(createTTSConfig().speed).toBe(1);
    expect(createVADConfig().threshold).toBe(0.02);
    expect(createVADConfig().silence_ms).toBe(700);
    expect(createLIDConfig().fallback_language).toBe("hi");
    expect(createS2SConfig().model).toBe("gpt-realtime");
    expect(createInitialResponseConfig().mode).toBe("none");
    expect(createInitialResponseConfig().via_llm).toBe(false);
    expect(effectiveTtsParams(createTTSConfig({ extra: { a: 1 }, params: { b: 2 } }))).toEqual({
      a: 1,
      b: 2,
    });
    expect(effectiveTtsParams(createTTSConfig({ extra: { a: 1 }, params: { a: 9 } })).a).toBe(9);
  });
});

describe("VoiceTeamConfig", () => {
  // PYTHON test_voice_team_config
  it("builds a voice team around a responder", () => {
    const responder = createRealtimeAgentConfig({
      name: "responder",
      agent: testAgentConfig({ name: "responder" }),
    });
    const team = createVoiceTeamConfig({
      name: "team",
      responder,
      context_agent: testAgentConfig({ name: "context" }),
    });
    expect(team.pattern).toBe("voice_team");
    expect(team.duplex).toBe("full");
    expect(team.responder.name).toBe("responder");
    expect(team.context_agent).not.toBeNull();
    expect(team.context_injection_var).toBe("live_context");
  });

  it("accepts a custom injection var and listener", () => {
    const responder = createRealtimeAgentConfig({
      name: "responder",
      agent: testAgentConfig(),
    });
    const listener = createRealtimeAgentConfig({
      name: "listener",
      agent: testAgentConfig({ name: "listener" }),
    });
    const team = createVoiceTeamConfig({
      name: "team",
      responder,
      listener,
      context_injection_var: "notes",
      duplex: "half",
    });
    expect(team.listener?.name).toBe("listener");
    expect(team.context_injection_var).toBe("notes");
    expect(team.duplex).toBe("half");
  });
});
