/**
 * Cascaded voice pipeline, energy VAD, session transport, and mock adapters.
 *
 * PYTHON sources:
 *   tests/test_realtime_voice.py
 *   tests/test_realtime_full_duplex.py
 *   tests/test_initial_response.py (session + greeting path only)
 *
 * Skipped (no TS port): GPU/gRPC STT-TTS, IVRMenuPlugin, LLM-backed
 * sentence-splitting TTS, barge-in, CascadedVoicePipeline.runInitialResponse.
 */

import { describe, expect, it } from "vitest";
import { MockSTT } from "../src/realtime/adapters/stt/mock.js";
import { MockTTS } from "../src/realtime/adapters/tts/mock.js";
import { VADEvent } from "../src/realtime/adapters/vad/base.js";
import { EnergyVAD } from "../src/realtime/adapters/vad/energy.js";
import { MockVAD } from "../src/realtime/adapters/vad/mock.js";
import {
  createRealtimeAgentConfig,
  createSTTConfig,
  createVADConfig,
  type RealtimeAgentConfig,
} from "../src/realtime/config.js";
import {
  audioChunkEvent,
  RealtimeStreamEvent,
  realtimeEvent,
  textDeltaEvent,
  transcriptEvent,
} from "../src/realtime/events.js";
import { CascadedVoicePipeline } from "../src/realtime/pipelines/cascaded.js";
import { MockS2SAdapter, SpeechToSpeechPipeline } from "../src/realtime/pipelines/speech-to-speech.js";
import { RealtimeSession, type VoicePipelineLike } from "../src/realtime/session.js";
import { InMemoryTransport } from "../src/realtime/transport/memory.js";
import { CustomCallbackSink, NexusEventEmitter } from "../src/events/emitter.js";
import { NexusEventType } from "../src/events/models.js";
import { createRunContext } from "../src/tools/context.js";
import { testAgentConfig } from "./helpers.js";

function rtConfig(
  overrides: Partial<RealtimeAgentConfig> & { duplex?: RealtimeAgentConfig["duplex"] } = {},
): RealtimeAgentConfig {
  return createRealtimeAgentConfig({
    name: "voice_agent",
    modality: "voice_cascaded",
    duplex: overrides.duplex ?? "full",
    agent: testAgentConfig({ name: "voice_agent" }),
    stt: createSTTConfig({ provider: "mock" }),
    ...overrides,
  });
}

function pcmFrame(sample: number, samples = 320): Buffer {
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) buf.writeInt16LE(sample, i * 2);
  return buf;
}

/** Same RMS as PYTHON `_frame_rms` / TS energy VAD (not exported). */
function frameRms(frame: Buffer): number {
  if (frame.length < 2) return 0;
  const count = Math.floor(frame.length / 2);
  let total = 0;
  for (let i = 0; i < count; i++) {
    const sample = frame.readInt16LE(i * 2);
    total += sample * sample;
  }
  return Math.sqrt(total / count) / 32768;
}

const LOUD = pcmFrame(12000);
const SILENCE = pcmFrame(0);

function utteranceThenSilence(loudFrames = 4, silentFrames = 8): Buffer[] {
  return [...Array.from({ length: loudFrames }, () => LOUD), ...Array.from({ length: silentFrames }, () => SILENCE)];
}

async function* audioOf(frames: Buffer[]): AsyncIterable<Buffer> {
  for (const frame of frames) yield frame;
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

function energyVad(): EnergyVAD {
  return new EnergyVAD(
    createVADConfig({
      provider: "energy",
      silence_ms: 100,
      min_speech_ms: 40,
      sample_rate: 16000,
      threshold: 0.02,
    }),
  );
}

describe("CascadedVoicePipeline", () => {
  // PYTHON test_cascaded_process_text_emits_audio_per_sentence
  // TS has no LLM: processText echoes the user text as one TTS chunk.
  it("processText emits transcript, audio, and final_response", async () => {
    const pipeline = new CascadedVoicePipeline(rtConfig(), {
      stt: new MockSTT(),
      tts: new MockTTS(),
      vad: energyVad(),
    });

    const events = await collect(pipeline.processText("hi there", "voice-1"));
    const types = events.map((e) => e.event_type);

    expect(types[0]).toBe("transcript_final");
    expect(events[0]?.content).toBe("hi there");
    expect(types).toContain("audio_out");
    expect(types).toContain("final_response");
    expect(types).toContain("content");

    const audioEvents = events.filter((e) => e.event_type === "audio_out");
    expect(audioEvents).toHaveLength(1);
    expect(Buffer.from(audioEvents[0]!.audio!).toString("utf8")).toBe("AUDIO:default:hi there");

    const final = events.find((e) => e.event_type === "final_response");
    expect(final?.content).toBe("hi there");
  });

  // PYTHON test_cascaded_process_utterance_uses_stt
  // TS has no process_utterance; processAudioStream + VAD + MockSTT is the equivalent.
  it("processAudioStream transcribes a finished utterance with MockSTT", async () => {
    const pipeline = new CascadedVoicePipeline(
      rtConfig({ stt: createSTTConfig({ provider: "mock", extra: { transcript: "book a flight" } }) }),
      {
        stt: new MockSTT(createSTTConfig({ provider: "mock" }), "book a flight"),
        tts: new MockTTS(),
        vad: energyVad(),
      },
    );

    const events = await collect(
      pipeline.processAudioStream(audioOf(utteranceThenSilence()), "voice-2"),
    );
    const transcript = events.find((e) => e.event_type === "transcript_final");
    expect(transcript?.content).toBe("book a flight");
    expect(events.some((e) => e.event_type === "session_started")).toBe(true);
    expect(events.some((e) => e.event_type === "final_response")).toBe(true);
    expect(events.some((e) => e.event_type === "turn_end")).toBe(true);
  });

  it("skips empty transcripts from STT", async () => {
    const pipeline = new CascadedVoicePipeline(rtConfig(), {
      stt: new MockSTT(createSTTConfig({ provider: "mock" }), "   "),
      tts: new MockTTS(),
      vad: energyVad(),
    });
    const events = await collect(
      pipeline.processAudioStream(audioOf(utteranceThenSilence()), "empty-stt"),
    );
    expect(events.filter((e) => e.event_type === "transcript_final")).toHaveLength(0);
    expect(events.filter((e) => e.event_type === "final_response")).toHaveLength(0);
  });

  it("emits a reply for each finished utterance", async () => {
    const pipeline = new CascadedVoicePipeline(rtConfig(), {
      stt: new MockSTT(createSTTConfig({ provider: "mock" }), "hello"),
      tts: new MockTTS(),
      vad: energyVad(),
    });
    const events = await collect(
      pipeline.processAudioStream(
        audioOf([...utteranceThenSilence(), ...utteranceThenSilence()]),
        "two-turns",
      ),
    );
    expect(events.filter((e) => e.event_type === "transcript_final")).toHaveLength(2);
    expect(events.filter((e) => e.event_type === "final_response")).toHaveLength(2);
  });
});

describe("EnergyVAD", () => {
  // PYTHON test_energy_vad_segments_speech
  it("segments speech after loud frames then silence", () => {
    const vad = energyVad();
    const loud = pcmFrame(10000);
    const silence = pcmFrame(0);

    expect(frameRms(loud)).toBeGreaterThan(0.02);
    expect(frameRms(silence)).toBe(0);

    const events: string[] = [];
    for (let i = 0; i < 4; i++) {
      const ev = vad.processFrame(loud);
      if (ev) events.push(ev);
    }
    for (let i = 0; i < 6; i++) {
      const ev = vad.processFrame(silence);
      if (ev) events.push(ev);
    }

    expect(events).toContain(VADEvent.SPEECH_START);
    expect(events).toContain(VADEvent.SPEECH_END);
    expect(vad.takeUtterance().length).toBeGreaterThan(0);
  });

  it("discards speech shorter than min_speech_ms", () => {
    const vad = energyVad();
    expect(vad.processFrame(LOUD)).toBe(VADEvent.SPEECH_START);
    const events: Array<VADEvent | null> = [];
    for (let i = 0; i < 8; i++) events.push(vad.processFrame(SILENCE));
    expect(events).not.toContain(VADEvent.SPEECH_END);
    expect(vad.takeUtterance().length).toBe(0);
  });

  it("reset clears in-progress speech", () => {
    const vad = energyVad();
    vad.processFrame(LOUD);
    vad.processFrame(LOUD);
    vad.reset();
    expect(vad.takeUtterance().length).toBe(0);
    expect(vad.processFrame(LOUD)).toBe(VADEvent.SPEECH_START);
  });

  it("accepts Uint8Array frames", () => {
    const vad = energyVad();
    const ev = vad.processFrame(new Uint8Array(LOUD));
    expect(ev).toBe(VADEvent.SPEECH_START);
  });

  it("MockVAD uses the same energy detector", () => {
    const vad = new MockVAD(
      createVADConfig({
        provider: "mock",
        silence_ms: 100,
        min_speech_ms: 40,
        sample_rate: 16000,
      }),
    );
    expect(vad.processFrame(LOUD)).toBe(VADEvent.SPEECH_START);
  });
});

describe("RealtimeSession", () => {
  // PYTHON test_realtime_session_pumps_audio
  it("pumps audio through the pipeline and transport", async () => {
    const pipeline = new CascadedVoicePipeline(rtConfig({ duplex: "half" }), {
      stt: new MockSTT(createSTTConfig({ provider: "mock" }), "hello"),
      tts: new MockTTS(),
      vad: energyVad(),
    });
    const transport = new InMemoryTransport();
    const session = new RealtimeSession(pipeline, transport, "voice-3");

    for (const frame of utteranceThenSilence(4, 8)) {
      await transport.pushAudio(frame);
    }
    await transport.endInput();
    await session.runAudio();

    expect(transport.sentAudio.map((b) => b.toString("utf8"))).toEqual(["AUDIO:default:hello"]);
    const eventTypes = new Set(transport.sentEvents.map((e) => e.event_type));
    expect(eventTypes.has("transcript_final")).toBe(true);
    expect(eventTypes.has("final_response")).toBe(true);
    expect(eventTypes.has("session_started")).toBe(true);
  });

  it("runText dispatches pipeline text events", async () => {
    const pipeline = new CascadedVoicePipeline(rtConfig(), {
      stt: new MockSTT(),
      tts: new MockTTS(),
    });
    const transport = new InMemoryTransport();
    const session = new RealtimeSession(pipeline, transport, "text-1");
    await session.runText("ping");
    expect(transport.sentEvents.some((e) => e.event_type === "transcript_final")).toBe(true);
    expect(transport.sentAudio[0]?.toString("utf8")).toBe("AUDIO:default:ping");
  });

  it("emits realtime telemetry when an event emitter is attached", async () => {
    const seen: string[] = [];
    const emitter = new NexusEventEmitter();
    emitter.registerSink(
      new CustomCallbackSink(async (event) => {
        seen.push(event.eventType);
      }),
    );
    const pipeline = new CascadedVoicePipeline(rtConfig({ duplex: "half" }), {
      stt: new MockSTT(createSTTConfig({ provider: "mock" }), "hi"),
      tts: new MockTTS(),
      vad: energyVad(),
      runContext: createRunContext({ sessionId: "tel-1" }),
    });
    const transport = new InMemoryTransport();
    const session = new RealtimeSession(pipeline, transport, "tel-1", emitter);
    for (const frame of utteranceThenSilence()) await transport.pushAudio(frame);
    await transport.endInput();
    await session.runAudio();

    expect(seen).toContain(NexusEventType.REALTIME_SESSION_STARTED);
    expect(seen).toContain(NexusEventType.REALTIME_TRANSCRIBED);
    expect(seen).toContain(NexusEventType.REALTIME_RESPONSE_COMPLETED);
    expect(seen).toContain(NexusEventType.REALTIME_SESSION_ENDED);
  });

  // PYTHON test_session_runs_initial_response_on_full_duplex_connect
  // TS only runs runInitialResponse when duplex !== "full".
  it("runs runInitialResponse on half-duplex connect", async () => {
    const transport = new InMemoryTransport();
    const pipeline: VoicePipelineLike = {
      runContext: { sessionId: "s5" },
      config: { name: "greeter", duplex: "half" },
      async *processAudioStream() {
        yield realtimeEvent("turn_end");
      },
      async *processText() {
        /* unused */
      },
      async *runInitialResponse() {
        yield audioChunkEvent(Buffer.from("AUDIO:default:Hi!", "utf8"));
        yield realtimeEvent("final_response", { content: "Hi!" });
      },
    };
    const session = new RealtimeSession(pipeline, transport, "s5");
    await transport.endInput();
    await session.runAudio();
    expect(transport.sentAudio.length).toBeGreaterThan(0);
    expect(transport.sentEvents.some((e) => e.event_type === "audio_out")).toBe(true);
  });

  it("does not run runInitialResponse on full duplex", async () => {
    let greetingRan = false;
    const transport = new InMemoryTransport();
    const pipeline: VoicePipelineLike = {
      runContext: { sessionId: "s6" },
      config: { name: "greeter", duplex: "full" },
      async *processAudioStream() {
        yield realtimeEvent("turn_end");
      },
      async *processText() {
        /* unused */
      },
      async *runInitialResponse() {
        greetingRan = true;
        yield realtimeEvent("final_response", { content: "Hi!" });
      },
    };
    const session = new RealtimeSession(pipeline, transport, "s6");
    await transport.endInput();
    await session.runAudio();
    expect(greetingRan).toBe(false);
  });
});

describe("full / half duplex (PYTHON test_realtime_full_duplex)", () => {
  // PYTHON test_full_duplex_emits_session_started_and_responses
  // TS client pipeline has no barge-in; assert the events it does emit.
  it("full duplex emits session_started and responses", async () => {
    const pipeline = new CascadedVoicePipeline(rtConfig({ duplex: "full" }), {
      stt: new MockSTT(createSTTConfig({ provider: "mock" }), "hi"),
      tts: new MockTTS(),
      vad: energyVad(),
    });
    const events = await collect(
      pipeline.processAudioStream(audioOf(utteranceThenSilence()), "bd-1"),
    );
    const types = events.map((e) => e.event_type);
    expect(types[0]).toBe("session_started");
    expect(types).toContain("final_response");
    expect(types).not.toContain("barge_in");
  });

  // PYTHON test_half_duplex_no_barge_in
  it("half duplex never emits barge_in", async () => {
    const pipeline = new CascadedVoicePipeline(rtConfig({ duplex: "half" }), {
      stt: new MockSTT(createSTTConfig({ provider: "mock" }), "ok"),
      tts: new MockTTS(),
      vad: energyVad(),
    });
    const events = await collect(
      pipeline.processAudioStream(audioOf(utteranceThenSilence()), "hd-1"),
    );
    const types = events.map((e) => e.event_type);
    expect(types).not.toContain("barge_in");
    expect(types).toContain("final_response");
  });
});

describe("MockSTT / MockTTS", () => {
  it("MockSTT prefers a fixed transcript", async () => {
    const stt = new MockSTT(createSTTConfig({ provider: "mock" }), "fixed");
    expect(await stt.transcribe(Buffer.from("ignored"))).toBe("fixed");
  });

  it("MockSTT reads extra.transcript from config", async () => {
    const stt = new MockSTT(createSTTConfig({ provider: "mock", extra: { transcript: "from-extra" } }));
    expect(await stt.transcribe(Buffer.from("x"))).toBe("from-extra");
  });

  it("MockSTT decodes audio as utf-8 when no fixed transcript", async () => {
    const stt = new MockSTT();
    expect(await stt.transcribe(Buffer.from("hello bytes", "utf8"))).toBe("hello bytes");
  });

  it("MockSTT streamTranscribe concatenates then transcribes", async () => {
    const stt = new MockSTT(createSTTConfig({ provider: "mock" }), "joined");
    const results = await collect(
      stt.streamTranscribe(
        (async function* () {
          yield Buffer.from("a");
          yield Buffer.from("b");
        })(),
      ),
    );
    expect(results).toEqual([{ text: "joined", is_final: true, confidence: 1 }]);
  });

  it("MockTTS prefixes AUDIO:language:", async () => {
    const tts = new MockTTS();
    const out = await tts.synthesize("Hello.", { language: "hi" });
    expect(out.toString("utf8")).toBe("AUDIO:hi:Hello.");
  });

  it("MockTTS streamSynthesize splits on sentence boundaries", async () => {
    const tts = new MockTTS();
    const chunks = await collect(
      tts.streamSynthesize(
        (async function* () {
          yield "Hello. ";
          yield "World.";
        })(),
      ),
    );
    expect(chunks.map((c) => c.toString("utf8"))).toEqual([
      "AUDIO:default:Hello.",
      "AUDIO:default:World.",
    ]);
  });
});

describe("RealtimeStreamEvent", () => {
  it("builds transcript, text delta, and audio helpers", () => {
    expect(transcriptEvent("hi", { final: true }).event_type).toBe("transcript_final");
    expect(transcriptEvent("hi", { final: false }).event_type).toBe("transcript_partial");
    expect(textDeltaEvent("x").event_type).toBe("content");
    const audio = audioChunkEvent(Buffer.from("abc"));
    expect(audio.event_type).toBe("audio_out");
    expect(audio.audio_b64).toBe(Buffer.from("abc").toString("base64"));
    expect(audio.toJSON()).toEqual({ event_type: "audio_out" });
    expect(new RealtimeStreamEvent({ event_type: "error", content: "boom" }).eventType).toBe(
      "error",
    );
  });
});

describe("SpeechToSpeechPipeline (mock)", () => {
  it("processText echoes through the mock S2S adapter format", async () => {
    const pipeline = new SpeechToSpeechPipeline(
      createRealtimeAgentConfig({
        name: "s2s",
        modality: "voice_s2s",
        agent: testAgentConfig({ name: "s2s" }),
      }),
      { adapter: new MockS2SAdapter() },
    );
    const events = await collect(pipeline.processText("hello"));
    expect(events[0]?.event_type).toBe("transcript_final");
    expect(events.some((e) => e.event_type === "audio_out")).toBe(true);
    expect(events.find((e) => e.event_type === "final_response")?.content).toBe("hello");
  });

  it("processAudioStream reports received bytes", async () => {
    const pipeline = new SpeechToSpeechPipeline(
      createRealtimeAgentConfig({
        name: "s2s",
        modality: "voice_s2s",
        agent: testAgentConfig({ name: "s2s" }),
      }),
    );
    const events = await collect(pipeline.processAudioStream(audioOf([Buffer.from("abcd")])));
    const transcript = events.find((e) => e.event_type === "transcript_final");
    expect(transcript?.content).toBe("[4 bytes received]");
  });
});
