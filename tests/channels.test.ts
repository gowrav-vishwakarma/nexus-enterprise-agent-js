/**
 * Channel contracts, registry, router, and identity.
 *
 * PYTHON source: tests/test_channels.py
 */

import { describe, expect, it } from "vitest";
import {
  ChannelRegistry,
  ChannelRouter,
  StaticIdentityResolver,
  type AgentOutput,
  type ChannelAdapter,
  type InboundMessage,
} from "../src/channels/index.js";
import { AudioPart, TextPart, UserInput } from "../src/realtime/input.js";
import type { RunContext } from "../src/tools/context.js";

class FakeResult {
  constructor(
    readonly finalResponse: string,
    readonly sessionId: string,
  ) {}
}

class FakeExecutor {
  readonly received: unknown[] = [];

  constructor(readonly runContext: RunContext) {}

  async run(userMessage: string | unknown, options: { sessionId?: string | null } = {}) {
    this.received.push(userMessage);
    return new FakeResult(`echo: ${String(userMessage)}`, options.sessionId ?? "s");
  }
}

class FakeChannel implements ChannelAdapter {
  readonly name = "fake";
  readonly kind = "messaging" as const;
  readonly sent: AgentOutput[] = [];

  async parseInbound(raw: unknown): Promise<InboundMessage> {
    const rec = raw as { from: string; text: string };
    return {
      channel: this.name,
      channelUserId: rec.from,
      userInput: UserInput.from_text(rec.text),
      raw: rec,
    };
  }

  async sendReply(_message: InboundMessage, output: AgentOutput): Promise<void> {
    this.sent.push(output);
  }
}

class FakeSTT {
  async transcribe(_audio: Buffer, _mimeType?: string): Promise<string> {
    return "transcribed words";
  }
}

class FakeTTS {
  async synthesize(text: string): Promise<Buffer> {
    return Buffer.from(`AUDIO:${text}`, "utf8");
  }
}

describe("StaticIdentityResolver", () => {
  // PYTHON test_static_identity_resolver
  it("maps channel user id onto tenant, user, and session", () => {
    const resolver = new StaticIdentityResolver("acme");
    const msg: InboundMessage = {
      channel: "telegram",
      channelUserId: "12345",
      userInput: UserInput.from_text("hi"),
    };
    const ctx = resolver.resolve(msg);
    expect(ctx.tenantId).toBe("acme");
    expect(ctx.userId).toBe("telegram:12345");
    expect(ctx.sessionId).toBe("telegram_12345");
    expect(ctx.metadata.channel).toBe("telegram");
  });

  it("prefers an inbound tenant and chat id", () => {
    const resolver = new StaticIdentityResolver("fallback", "sess-");
    const ctx = resolver.resolve({
      channel: "whatsapp",
      channelUserId: "u1",
      channelChatId: "g9",
      tenantId: "acme",
      userInput: UserInput.from_text("hi"),
    });
    expect(ctx.tenantId).toBe("acme");
    expect(ctx.sessionId).toBe("sess-whatsapp_g9");
    expect(ctx.userId).toBe("whatsapp:u1");
  });
});

describe("ChannelRegistry", () => {
  // PYTHON test_channel_registry
  it("registers, lists, and looks up adapters", () => {
    const reg = new ChannelRegistry();
    const ch = new FakeChannel();
    reg.register(ch);
    expect(reg.has("fake")).toBe(true);
    expect(reg.get("fake")).toBe(ch);
    expect(reg.names()).toEqual(["fake"]);
    expect(() => reg.get("missing")).toThrow(/not registered/);
  });

  it("sorts names and is iterable", () => {
    const reg = new ChannelRegistry();
    const named = (name: string): ChannelAdapter => ({
      name,
      kind: "messaging",
      parseInbound: async () => ({
        channel: name,
        channelUserId: "u",
        userInput: UserInput.from_text(""),
      }),
      sendReply: async () => undefined,
    });
    reg.register(named("zeta"));
    reg.register(named("alpha"));
    expect(reg.names()).toEqual(["alpha", "zeta"]);
    expect([...reg].map((ch) => ch.name).sort()).toEqual(["alpha", "zeta"]);
  });
});

describe("ChannelRouter", () => {
  // PYTHON test_router_text_message
  it("routes a text message through the executor and sends a reply", async () => {
    const channel = new FakeChannel();
    const executors: FakeExecutor[] = [];
    const router = new ChannelRouter(
      channel,
      (ctx) => {
        const ex = new FakeExecutor(ctx);
        executors.push(ex);
        return ex;
      },
      { identityResolver: new StaticIdentityResolver("acme") },
    );

    const output = await router.handle({ from: "u1", text: "hello" });
    expect(output.text).toBe("echo: hello");
    expect(channel.sent[0]?.text).toBe("echo: hello");
    expect(executors[0]?.received).toEqual(["hello"]);
    expect(executors[0]?.runContext.tenantId).toBe("acme");
    expect(executors[0]?.runContext.userId).toBe("fake:u1");
  });

  // PYTHON test_router_transcribes_audio_note
  it("transcribes an audio note before calling the executor", async () => {
    const channel = new FakeChannel();
    channel.parseInbound = async (raw) => ({
      channel: "fake",
      channelUserId: "u2",
      userInput: new UserInput([AudioPart.from_bytes(Buffer.from("audio"))]),
      raw: raw as Record<string, unknown>,
    });

    const captured: FakeExecutor[] = [];
    const router = new ChannelRouter(
      channel,
      (ctx) => {
        const ex = new FakeExecutor(ctx);
        captured.push(ex);
        return ex;
      },
      { stt: new FakeSTT() },
    );
    await router.handle({ voice: true });
    expect(captured[0]?.received).toEqual(["transcribed words"]);
  });

  it("keeps caption text when transcribing audio", async () => {
    const channel = new FakeChannel();
    channel.parseInbound = async () => ({
      channel: "fake",
      channelUserId: "u2",
      userInput: new UserInput([
        new TextPart("caption"),
        AudioPart.from_bytes(Buffer.from("audio")),
      ]),
    });
    const captured: FakeExecutor[] = [];
    const router = new ChannelRouter(
      channel,
      (ctx) => {
        const ex = new FakeExecutor(ctx);
        captured.push(ex);
        return ex;
      },
      { stt: new FakeSTT() },
    );
    await router.handle({});
    expect(captured[0]?.received).toEqual(["caption transcribed words"]);
  });

  it("returns empty text when audio is present but STT is missing", async () => {
    const channel = new FakeChannel();
    channel.parseInbound = async () => ({
      channel: "fake",
      channelUserId: "u2",
      userInput: new UserInput([AudioPart.from_bytes(Buffer.from("audio"))]),
    });
    const captured: FakeExecutor[] = [];
    const router = new ChannelRouter(channel, (ctx) => {
      const ex = new FakeExecutor(ctx);
      captured.push(ex);
      return ex;
    });
    await router.handle({});
    expect(captured[0]?.received).toEqual([""]);
  });

  it("synthesizes a spoken reply when replyWithAudio is set", async () => {
    const channel = new FakeChannel();
    const router = new ChannelRouter(channel, (ctx) => new FakeExecutor(ctx), {
      tts: new FakeTTS(),
      replyWithAudio: true,
    });
    const output = await router.handle({ from: "u1", text: "hello" });
    expect(output.audio?.toString("utf8")).toBe("AUDIO:echo: hello");
  });

  it("still sends text when TTS fails", async () => {
    const channel = new FakeChannel();
    const router = new ChannelRouter(channel, (ctx) => new FakeExecutor(ctx), {
      replyWithAudio: true,
      tts: {
        async synthesize() {
          throw new Error("tts down");
        },
      },
    });
    const output = await router.handle({ from: "u1", text: "hello" });
    expect(output.text).toBe("echo: hello");
    expect(output.audio).toBeUndefined();
    expect(channel.sent[0]?.text).toBe("echo: hello");
  });

  it("reads final_response as well as finalResponse", async () => {
    const channel = new FakeChannel();
    const router = new ChannelRouter(channel, () => ({
      async run() {
        return { final_response: "snake" };
      },
    }));
    const output = await router.handle({ from: "u1", text: "hi" });
    expect(output.text).toBe("snake");
  });

  it("returns null text when the executor result has no reply field", async () => {
    const channel = new FakeChannel();
    const router = new ChannelRouter(channel, () => ({
      async run() {
        return { ok: true };
      },
    }));
    const output = await router.handle({ from: "u1", text: "hi" });
    expect(output.text).toBeNull();
  });
});
