/** Cascaded voice pipeline: VAD -> STT -> agent -> TTS (simplified). */

import { buildStt, buildTts, buildVad } from "../adapters/factory.js";
import type { STTAdapter } from "../adapters/stt/base.js";
import type { TTSAdapter } from "../adapters/tts/base.js";
import { VADEvent, type VADAdapter } from "../adapters/vad/base.js";
import {
  effectiveStt,
  effectiveTts,
  effectiveVad,
  type RealtimeAgentConfig,
} from "../config.js";
import {
  audioChunkEvent,
  realtimeEvent,
  textDeltaEvent,
  transcriptEvent,
  type RealtimeStreamEvent,
} from "../events.js";
import { createRunContext, type RunContext } from "../../tools/context.js";

export class CascadedVoicePipeline {
  config: RealtimeAgentConfig;
  duplex: string;
  runContext: RunContext;
  stt: STTAdapter;
  tts: TTSAdapter;
  vad: VADAdapter;

  constructor(
    config: RealtimeAgentConfig,
    opts: {
      runContext?: RunContext | null;
      stt?: STTAdapter | null;
      tts?: TTSAdapter | null;
      vad?: VADAdapter | null;
    } = {},
  ) {
    this.config = config;
    this.duplex = config.duplex ?? "full";
    this.runContext = opts.runContext ?? createRunContext();
    this.stt = opts.stt ?? buildStt(effectiveStt(config));
    this.tts = opts.tts ?? buildTts(effectiveTts(config));
    this.vad = opts.vad ?? buildVad(effectiveVad(config));
  }

  async *processText(
    text: string,
    sessionId?: string | null,
  ): AsyncIterable<RealtimeStreamEvent> {
    yield transcriptEvent(text, { final: true });
    for await (const event of this.synthesizeReply(text, sessionId)) {
      yield event;
    }
  }

  async *processAudioStream(
    audioIn: AsyncIterable<Buffer>,
    sessionId?: string | null,
  ): AsyncIterable<RealtimeStreamEvent> {
    yield realtimeEvent("session_started", { data: { sessionId: sessionId ?? null } });
    for await (const frame of audioIn) {
      const vadEvent = this.vad.processFrame(frame);
      if (vadEvent === VADEvent.SPEECH_END) {
        const utterance = this.vad.takeUtterance();
        const text = await this.stt.transcribe(utterance);
        if (text.trim()) {
          yield transcriptEvent(text, { final: true });
          for await (const event of this.processText(text, sessionId)) {
            if (event.event_type !== "transcript_final") yield event;
          }
        }
        this.vad.reset();
      }
    }
    yield realtimeEvent("turn_end");
  }

  private async *synthesizeReply(
    text: string,
    _sessionId?: string | null,
  ): AsyncIterable<RealtimeStreamEvent> {
    yield textDeltaEvent(text);
    const audio = await this.tts.synthesize(text);
    yield audioChunkEvent(audio);
    yield realtimeEvent("final_response", { content: text });
  }
}
