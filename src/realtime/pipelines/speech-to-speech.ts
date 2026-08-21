/** Speech-to-speech pipeline (simplified mock). */

import {
  effectiveS2s,
  type RealtimeAgentConfig,
} from "../config.js";
import {
  audioChunkEvent,
  realtimeEvent,
  transcriptEvent,
  type RealtimeStreamEvent,
} from "../events.js";
import { createRunContext, type RunContext } from "../../tools/context.js";
import type { ToolRegistry } from "../../tools/registry.js";

export interface SpeechToSpeechAdapter {
  runAudio(
    audio: AsyncIterable<Buffer>,
    opts: { instructions: string; tools: Array<Record<string, unknown>> },
  ): AsyncIterable<RealtimeStreamEvent>;
}

export class MockS2SAdapter implements SpeechToSpeechAdapter {
  async *runAudio(
    audio: AsyncIterable<Buffer>,
    _opts: { instructions: string; tools: Array<Record<string, unknown>> },
  ): AsyncIterable<RealtimeStreamEvent> {
    let bytes = 0;
    for await (const chunk of audio) bytes += chunk.length;
    const text = `[${bytes} bytes received]`;
    yield transcriptEvent(text, { final: true });
    yield audioChunkEvent(Buffer.from(`S2S:${text}`, "utf8"));
    yield realtimeEvent("final_response", { content: text });
  }
}

export class SpeechToSpeechPipeline {
  config: RealtimeAgentConfig;
  duplex: string;
  runContext: RunContext;
  adapter: SpeechToSpeechAdapter;

  constructor(
    config: RealtimeAgentConfig,
    opts: {
      toolRegistry?: ToolRegistry | null;
      runContext?: RunContext | null;
      adapter?: SpeechToSpeechAdapter | null;
    } = {},
  ) {
    this.config = config;
    this.duplex = config.duplex ?? "full";
    this.runContext = opts.runContext ?? createRunContext();
    void opts.toolRegistry;
    this.adapter = opts.adapter ?? new MockS2SAdapter();
  }

  private instructions(): string {
    const s2s = effectiveS2s(this.config);
    if (s2s.instructions) return s2s.instructions;
    const persona = this.config.agent.persona ?? {};
    if (persona.system_prompt) return persona.system_prompt;
    return `You are ${persona.role ?? "an assistant"}. Goal: ${persona.goal ?? "help the user"}.`;
  }

  async *processText(
    text: string,
    _sessionId?: string | null,
  ): AsyncIterable<RealtimeStreamEvent> {
    yield transcriptEvent(text, { final: true });
    yield audioChunkEvent(Buffer.from(`S2S:${text}`, "utf8"));
    yield realtimeEvent("final_response", { content: text });
  }

  async *processAudioStream(
    audioIn: AsyncIterable<Buffer>,
    _sessionId?: string | null,
  ): AsyncIterable<RealtimeStreamEvent> {
    yield* this.adapter.runAudio(audioIn, {
      instructions: this.instructions(),
      tools: [],
    });
  }
}
