/**
 * RealtimeRuntime manifest resolution, pipeline building, factory, reconnect.
 *
 * PYTHON source: tests/test_realtime_runtime.py
 *
 * Skipped (no TS port): IVRMenuPlugin / ivr_menu toolset, nexus_server STT-TTS.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { buildStt, buildTts, buildVad } from "../src/realtime/adapters/factory.js";
import { MockSTT } from "../src/realtime/adapters/stt/mock.js";
import { MockTTS } from "../src/realtime/adapters/tts/mock.js";
import { EnergyVAD } from "../src/realtime/adapters/vad/energy.js";
import {
  createRealtimeAgentConfig,
  createSTTConfig,
  createTTSConfig,
  createVADConfig,
  type RealtimeAgentConfig,
} from "../src/realtime/config.js";
import { CascadedVoicePipeline } from "../src/realtime/pipelines/cascaded.js";
import { SpeechToSpeechPipeline } from "../src/realtime/pipelines/speech-to-speech.js";
import { connectWithRetry } from "../src/realtime/reconnect.js";
import {
  RealtimeRuntime,
  resolveRealtimeAgent,
  resolveVoiceTeam,
  type OrchestrationManifestLike,
} from "../src/realtime/runtime.js";
import { InMemoryTransport } from "../src/realtime/transport/memory.js";
import { WebSocketTransport } from "../src/realtime/transport/websocket.js";
import { createRunContext } from "../src/tools/context.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { testAgentConfig } from "./helpers.js";

function runContext() {
  return createRunContext({ tenantId: "t1", userId: "+1555", sessionId: "call-1" });
}

function voiceManifest(): OrchestrationManifestLike {
  const agent = testAgentConfig({ name: "ivr_support" });
  return {
    schema: {
      root: "ivr_support",
      agents: {
        ivr_support: {
          modality: "voice_cascaded",
          duplex: "half",
          stt: createSTTConfig({ provider: "mock", language: "hi" }),
          tts: createTTSConfig({ provider: "mock" }),
          languages: { allowed: ["hi"], default: "hi" },
          agent,
          name: "ivr_support",
          llm: agent.llm,
        },
        s2s_bot: {
          modality: "voice_s2s",
          duplex: "full",
          s2s: { provider: "mock", model: "mock", api_key: "", extra: {} },
          agent: testAgentConfig({ name: "s2s_bot" }),
        },
      },
      groups: {
        support_team: {
          duplex: "full",
          context_injection_var: "live_context",
          members: [
            { role: "responder", name: "ivr_support" },
            { role: "listener", name: "s2s_bot" },
          ],
        },
      },
    },
  };
}

describe("resolveRealtimeAgent", () => {
  // PYTHON test_resolve_realtime_agent_from_manifest
  it("reads modality, duplex, and mock STT/TTS from a manifest agent", () => {
    const rt = resolveRealtimeAgent("ivr_support", voiceManifest(), runContext());
    expect(rt.modality).toBe("voice_cascaded");
    expect(rt.duplex).toBe("half");
    expect(rt.name).toBe("ivr_support");
    expect(rt.stt?.provider).toBe("mock");
    expect(rt.tts?.provider).toBe("mock");
    expect(rt.languages?.allowed).toContain("hi");
  });

  it("uses non-realtime keys as the nested agent spec", () => {
    const manifest: OrchestrationManifestLike = {
      schema: {
        agents: {
          bare: {
            modality: "text",
            name: "bare",
            llm: testAgentConfig().llm,
          },
        },
      },
    };
    const rt = resolveRealtimeAgent("bare", manifest, runContext());
    expect(rt.modality).toBe("text");
    expect((rt.agent as { name?: string }).name).toBe("bare");
  });

  it("throws when the agent is missing", () => {
    expect(() => resolveRealtimeAgent("missing", voiceManifest(), runContext())).toThrow(
      /not found in manifest agents/,
    );
  });
});

describe("resolveVoiceTeam", () => {
  it("resolves a responder from group members", () => {
    const team = resolveVoiceTeam("support_team", voiceManifest(), runContext());
    expect(team.pattern).toBe("voice_team");
    expect(team.responder.name).toBe("ivr_support");
    expect(team.context_injection_var).toBe("live_context");
    expect(team.duplex).toBe("full");
  });

  it("throws when the group is missing", () => {
    expect(() => resolveVoiceTeam("nope", voiceManifest(), runContext())).toThrow(
      /not found in manifest groups/,
    );
  });

  it("throws when there is no responder member", () => {
    const manifest: OrchestrationManifestLike = {
      schema: {
        groups: { empty: { members: ["other"] } },
        agents: {},
      },
    };
    expect(() => resolveVoiceTeam("empty", manifest, runContext())).toThrow(/responder/);
  });

  it("accepts a string member named responder", () => {
    const manifest: OrchestrationManifestLike = {
      schema: {
        agents: {
          responder: {
            modality: "voice_cascaded",
            agent: testAgentConfig({ name: "responder" }),
          },
        },
        groups: { g: { members: ["responder"] } },
      },
    };
    const team = resolveVoiceTeam("g", manifest, runContext());
    expect(team.responder.name).toBe("responder");
  });
});

describe("RealtimeRuntime", () => {
  // PYTHON test_runtime_builds_pipeline_and_runs
  it("builds a cascaded pipeline and runs processText", async () => {
    const runtime = RealtimeRuntime.fromManifest(voiceManifest(), {
      runContext: runContext(),
      toolRegistry: new ToolRegistry(),
    });
    const pipeline = runtime.buildPipeline("ivr_support");
    expect(pipeline).toBeInstanceOf(CascadedVoicePipeline);

    const events: string[] = [];
    for await (const ev of pipeline.processText("billing", "call-1")) {
      events.push(ev.event_type);
    }
    expect(events).toContain("final_response");
    expect(events).toContain("audio_out");
  });

  it("buildPipeline defaults to the manifest root", () => {
    const runtime = new RealtimeRuntime(voiceManifest(), runContext());
    const pipeline = runtime.buildPipeline();
    expect(pipeline).toBeInstanceOf(CascadedVoicePipeline);
    expect((pipeline as CascadedVoicePipeline).config.name).toBe("ivr_support");
  });

  it("pipelineFor builds SpeechToSpeechPipeline for voice_s2s", () => {
    const runtime = RealtimeRuntime.fromManifest(voiceManifest(), { runContext: runContext() });
    const cfg = resolveRealtimeAgent("s2s_bot", voiceManifest(), runContext());
    expect(runtime.pipelineFor(cfg)).toBeInstanceOf(SpeechToSpeechPipeline);
  });

  it("pipelineFor builds CascadedVoicePipeline for cascaded voice", () => {
    const runtime = RealtimeRuntime.fromManifest(voiceManifest(), { runContext: runContext() });
    const cfg: RealtimeAgentConfig = createRealtimeAgentConfig({
      name: "x",
      agent: testAgentConfig(),
    });
    expect(runtime.pipelineFor(cfg)).toBeInstanceOf(CascadedVoicePipeline);
  });

  it("buildVoiceTeam uses the root group name when omitted", () => {
    const manifest = voiceManifest();
    manifest.schema.root = "support_team";
    const runtime = RealtimeRuntime.fromManifest(manifest, { runContext: runContext() });
    expect(runtime.buildVoiceTeam().name).toBe("support_team");
  });
});

describe("adapter factory (client-side mock / energy only)", () => {
  it("builds mock STT/TTS and energy VAD", () => {
    expect(buildStt(createSTTConfig({ provider: "mock" }))).toBeInstanceOf(MockSTT);
    expect(buildStt(createSTTConfig({ provider: "test" }))).toBeInstanceOf(MockSTT);
    expect(buildTts(createTTSConfig({ provider: "mock" }))).toBeInstanceOf(MockTTS);
    expect(buildVad(createVADConfig({ provider: "energy" }))).toBeInstanceOf(EnergyVAD);
    expect(buildVad(createVADConfig({ provider: "mock" }))).toBeInstanceOf(EnergyVAD);
  });

  it("rejects GPU / gRPC providers", () => {
    expect(() => buildStt(createSTTConfig({ provider: "nexus_server" }))).toThrow(/Unknown STT/);
    expect(() => buildTts(createTTSConfig({ provider: "nexus_server" }))).toThrow(/Unknown TTS/);
    expect(() => buildVad(createVADConfig({ provider: "silero" }))).toThrow(/Unknown VAD/);
  });
});

describe("connectWithRetry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns on the first successful connect", async () => {
    const result = await connectWithRetry(async () => "ok", { maxRetries: 2, baseDelay: 0.001, jitter: 0 });
    expect(result).toBe("ok");
  });

  it("retries then succeeds", async () => {
    let attempts = 0;
    const result = await connectWithRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("down");
        return "up";
      },
      { maxRetries: 4, baseDelay: 0.001, jitter: 0 },
    );
    expect(result).toBe("up");
    expect(attempts).toBe(3);
  });

  it("throws the last error after retries are exhausted", async () => {
    await expect(
      connectWithRetry(
        async () => {
          throw new Error("still down");
        },
        { maxRetries: 1, baseDelay: 0.001, jitter: 0 },
      ),
    ).rejects.toThrow("still down");
  });
});

describe("WebSocketTransport", () => {
  it("sends events as JSON text and audio as raw bytes", async () => {
    const sent: Array<string | Uint8Array | Buffer> = [];
    const ws = {
      send(data: string | Uint8Array | Buffer) {
        sent.push(data);
      },
    };
    const transport = new WebSocketTransport(ws);
    await transport.sendEvent({ event_type: "content", content: "hi", toJSON: () => ({ event_type: "content", content: "hi" }) } as never);
    await transport.sendAudio(Buffer.from("pcm"));
    expect(sent[0]).toBe(JSON.stringify({ event_type: "content", content: "hi" }));
    expect(Buffer.from(sent[1] as Buffer).toString("utf8")).toBe("pcm");
  });

  it("can send audio as base64 JSON", async () => {
    const sent: string[] = [];
    const ws = {
      send(data: string | Uint8Array | Buffer) {
        sent.push(String(data));
      },
    };
    const transport = new WebSocketTransport(ws, { sendAudioAsBase64: true });
    await transport.sendAudio(Buffer.from("hi"));
    const payload = JSON.parse(sent[0]!);
    expect(payload.type).toBe("audio_out");
    expect(payload.audio_b64).toBe(Buffer.from("hi").toString("base64"));
  });

  it("yields binary frames from an async iterator and parses control JSON", async () => {
    const controls: Array<Record<string, unknown>> = [];
    async function* messages() {
      yield JSON.stringify({ type: "ping" });
      yield Buffer.from("frame");
    }
    const ws = {
      [Symbol.asyncIterator]: () => messages()[Symbol.asyncIterator](),
    };
    const transport = new WebSocketTransport(ws, { onControl: (p) => controls.push(p) });
    const frames: Buffer[] = [];
    for await (const frame of transport.receiveAudio()) frames.push(frame);
    expect(controls).toEqual([{ type: "ping" }]);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.toString("utf8")).toBe("frame");
  });

  it("uses FastAPI-style sendBytes / receive", async () => {
    const bytes: Buffer[] = [];
    const texts: string[] = [];
    const inbox: Array<{ type?: string; bytes?: Buffer; text?: string }> = [
      { bytes: Buffer.from("in") },
      { type: "websocket.disconnect" },
    ];
    const ws = {
      async sendBytes(data: Uint8Array | Buffer) {
        bytes.push(Buffer.from(data));
      },
      async sendText(text: string) {
        texts.push(text);
      },
      async receive() {
        const next = inbox.shift();
        if (!next) throw new Error("closed");
        return next;
      },
    };
    const transport = new WebSocketTransport(ws);
    const frames: Buffer[] = [];
    for await (const frame of transport.receiveAudio()) frames.push(frame);
    await transport.sendAudio(Buffer.from("out"));
    await transport.close();
    expect(frames[0]!.toString("utf8")).toBe("in");
    expect(bytes[0]!.toString("utf8")).toBe("out");
  });

  it("InMemoryTransport queues audio for a late consumer", async () => {
    const transport = new InMemoryTransport();
    await transport.pushAudio(Buffer.from("a"));
    await transport.endInput();
    const got: Buffer[] = [];
    for await (const chunk of transport.receiveAudio()) got.push(chunk);
    expect(got.map((b) => b.toString("utf8"))).toEqual(["a"]);
  });
});
