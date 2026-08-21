/** Configuration models for realtime (voice/AV) agents. */

import type { AgentConfig } from "../config/agent.js";
import { DEFAULT_LANGUAGE, LANGUAGES } from "./languages.js";

export type Modality = "text" | "vision_text" | "voice_cascaded" | "voice_s2s";
export type DuplexMode = "half" | "full";
export type InitialResponseMode = "none" | "proactive" | "ivr";

export interface STTConfig {
  provider: string;
  model?: string | null;
  language: string;
  sample_rate: number;
  interim_results: boolean;
  api_key: string;
  base_url?: string | null;
  server_ref?: string | null;
  extra: Record<string, unknown>;
}

export function createSTTConfig(partial: Partial<STTConfig> = {}): STTConfig {
  return {
    provider: partial.provider ?? "mock",
    model: partial.model ?? null,
    language: partial.language ?? "en",
    sample_rate: partial.sample_rate ?? 16000,
    interim_results: partial.interim_results ?? true,
    api_key: partial.api_key ?? "",
    base_url: partial.base_url ?? null,
    server_ref: partial.server_ref ?? null,
    extra: partial.extra ?? {},
  };
}

export interface TTSConfig {
  provider: string;
  model?: string | null;
  voice?: string | null;
  sample_rate: number;
  audio_format: string;
  speed: number;
  api_key: string;
  base_url?: string | null;
  server_ref?: string | null;
  params: Record<string, unknown>;
  extra: Record<string, unknown>;
}

export function createTTSConfig(partial: Partial<TTSConfig> = {}): TTSConfig {
  return {
    provider: partial.provider ?? "mock",
    model: partial.model ?? null,
    voice: partial.voice ?? null,
    sample_rate: partial.sample_rate ?? 24000,
    audio_format: partial.audio_format ?? "pcm16",
    speed: partial.speed ?? 1.0,
    api_key: partial.api_key ?? "",
    base_url: partial.base_url ?? null,
    server_ref: partial.server_ref ?? null,
    params: partial.params ?? {},
    extra: partial.extra ?? {},
  };
}

export function effectiveTtsParams(config: TTSConfig): Record<string, unknown> {
  return { ...config.extra, ...config.params };
}

export interface LanguageConfig {
  allowed: string[];
  default?: string | null;
}

export interface LIDConfig {
  provider: string;
  fallback_language: string;
  sample_rate: number;
  base_url?: string | null;
  server_ref?: string | null;
  extra: Record<string, unknown>;
}

export function createLIDConfig(partial: Partial<LIDConfig> = {}): LIDConfig {
  return {
    provider: partial.provider ?? "mock",
    fallback_language: partial.fallback_language ?? "hi",
    sample_rate: partial.sample_rate ?? 16000,
    base_url: partial.base_url ?? null,
    server_ref: partial.server_ref ?? null,
    extra: partial.extra ?? {},
  };
}

export interface VADConfig {
  provider: string;
  threshold: number;
  silence_ms: number;
  min_speech_ms: number;
  barge_in_min_speech_ms: number;
  sample_rate: number;
  base_url?: string | null;
  server_ref?: string | null;
  extra: Record<string, unknown>;
}

export function createVADConfig(partial: Partial<VADConfig> = {}): VADConfig {
  return {
    provider: partial.provider ?? "energy",
    threshold: partial.threshold ?? 0.02,
    silence_ms: partial.silence_ms ?? 700,
    min_speech_ms: partial.min_speech_ms ?? 200,
    barge_in_min_speech_ms: partial.barge_in_min_speech_ms ?? 250,
    sample_rate: partial.sample_rate ?? 16000,
    base_url: partial.base_url ?? null,
    server_ref: partial.server_ref ?? null,
    extra: partial.extra ?? {},
  };
}

export interface InitialResponseConfig {
  mode: InitialResponseMode;
  text?: string | null;
  via_llm: boolean;
  llm_trigger?: string | null;
  ivr_script?: string[] | null;
  emit_transcript: boolean;
  reply_language?: string | null;
}

export function createInitialResponseConfig(
  partial: Partial<InitialResponseConfig> = {},
): InitialResponseConfig {
  return {
    mode: partial.mode ?? "none",
    text: partial.text ?? null,
    via_llm: partial.via_llm ?? false,
    llm_trigger: partial.llm_trigger ?? null,
    ivr_script: partial.ivr_script ?? null,
    emit_transcript: partial.emit_transcript ?? false,
    reply_language: partial.reply_language ?? null,
  };
}

export interface S2SConfig {
  provider: string;
  model: string;
  voice?: string | null;
  instructions?: string | null;
  api_key: string;
  base_url?: string | null;
  extra: Record<string, unknown>;
}

export function createS2SConfig(partial: Partial<S2SConfig> = {}): S2SConfig {
  return {
    provider: partial.provider ?? "openai_realtime",
    model: partial.model ?? "gpt-realtime",
    voice: partial.voice ?? "marin",
    instructions: partial.instructions ?? null,
    api_key: partial.api_key ?? "",
    base_url: partial.base_url ?? null,
    extra: partial.extra ?? {},
  };
}

export interface RealtimeAgentConfig {
  name: string;
  modality: Modality;
  duplex: DuplexMode;
  agent: AgentConfig;
  stt?: STTConfig | null;
  tts?: TTSConfig | null;
  vad?: VADConfig | null;
  lid?: LIDConfig | null;
  languages?: LanguageConfig | null;
  initial_response?: InitialResponseConfig | null;
  s2s?: S2SConfig | null;
}

export function createRealtimeAgentConfig(
  partial: Omit<RealtimeAgentConfig, "modality" | "duplex"> &
    Partial<Pick<RealtimeAgentConfig, "modality" | "duplex">>,
): RealtimeAgentConfig {
  return {
    name: partial.name,
    modality: partial.modality ?? "voice_cascaded",
    duplex: partial.duplex ?? "full",
    agent: partial.agent,
    stt: partial.stt ?? null,
    tts: partial.tts ?? null,
    vad: partial.vad ?? null,
    lid: partial.lid ?? null,
    languages: partial.languages ?? null,
    initial_response: partial.initial_response ?? null,
    s2s: partial.s2s ?? null,
  };
}

export function isVoice(config: RealtimeAgentConfig): boolean {
  return config.modality === "voice_cascaded" || config.modality === "voice_s2s";
}

export function effectiveStt(config: RealtimeAgentConfig): STTConfig {
  return config.stt ?? createSTTConfig();
}

export function effectiveTts(config: RealtimeAgentConfig): TTSConfig {
  return config.tts ?? createTTSConfig();
}

export function effectiveVad(config: RealtimeAgentConfig): VADConfig {
  return config.vad ?? createVADConfig();
}

export function effectiveLid(config: RealtimeAgentConfig): LIDConfig | null {
  return config.lid ?? null;
}

export function effectiveLanguages(config: RealtimeAgentConfig): LanguageConfig {
  const sttLang = (effectiveStt(config).language || DEFAULT_LANGUAGE).toLowerCase().split("-")[0]!;
  const lid = effectiveLid(config);
  const lidFallback = lid
    ? lid.fallback_language.toLowerCase().split("-")[0]!
    : sttLang;

  if (config.languages != null) {
    return {
      allowed: [...config.languages.allowed],
      default: config.languages.default ?? sttLang ?? DEFAULT_LANGUAGE,
    };
  }

  const allowed = new Set(Object.keys(LANGUAGES));
  allowed.add(sttLang);
  allowed.add(lidFallback);
  return { allowed: [...allowed].sort(), default: lidFallback || sttLang };
}

export function effectiveInitialResponse(config: RealtimeAgentConfig): InitialResponseConfig {
  return config.initial_response ?? createInitialResponseConfig();
}

export function effectiveS2s(config: RealtimeAgentConfig): S2SConfig {
  return config.s2s ?? createS2SConfig();
}

export interface VoiceTeamConfig {
  name: string;
  pattern: "voice_team";
  duplex: DuplexMode;
  responder: RealtimeAgentConfig;
  context_agent?: AgentConfig | null;
  listener?: RealtimeAgentConfig | null;
  context_injection_var: string;
}

export function createVoiceTeamConfig(
  partial: Omit<VoiceTeamConfig, "pattern" | "duplex" | "context_injection_var"> &
    Partial<Pick<VoiceTeamConfig, "pattern" | "duplex" | "context_injection_var">>,
): VoiceTeamConfig {
  return {
    name: partial.name,
    pattern: "voice_team",
    duplex: partial.duplex ?? "full",
    responder: partial.responder,
    context_agent: partial.context_agent ?? null,
    listener: partial.listener ?? null,
    context_injection_var: partial.context_injection_var ?? "live_context",
  };
}
