/**
 * Telegram + WhatsApp adapters and router vision/audio routing.
 *
 * PYTHON source: tests/test_channel_adapters.py
 */

import { describe, expect, it } from "vitest";
import { TelegramAdapter, type HttpClient, type HttpResponse } from "../src/channels/adapters/telegram.js";
import { WhatsAppAdapter } from "../src/channels/adapters/whatsapp.js";
import {
  ChannelRouter,
  type AgentOutput,
  type ChannelAdapter,
  type InboundMessage,
} from "../src/channels/index.js";
import { ImageBase64Part, UserInput } from "../src/realtime/input.js";
import type { RunContext } from "../src/tools/context.js";

class FakeResponse implements HttpResponse {
  ok = true;
  status = 200;

  constructor(
    private readonly jsonData: unknown = {},
    private readonly body: Buffer = Buffer.alloc(0),
  ) {}

  async json(): Promise<unknown> {
    return this.jsonData;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.body.buffer.slice(this.body.byteOffset, this.body.byteOffset + this.body.byteLength);
  }
}

class FakeClient implements HttpClient {
  readonly gets: Array<{ url: string; init?: { params?: Record<string, string> } }> = [];
  readonly posts: Array<{
    url: string;
    init?: { json?: unknown; data?: Record<string, string>; files?: Record<string, unknown> };
  }> = [];

  constructor(private readonly routes: Record<string, FakeResponse> = {}) {}

  async get(url: string, init?: { params?: Record<string, string> }): Promise<HttpResponse> {
    this.gets.push({ url, init });
    for (const [key, resp] of Object.entries(this.routes)) {
      if (url.includes(key)) return resp;
    }
    return new FakeResponse();
  }

  async post(
    url: string,
    init?: { json?: unknown; data?: Record<string, string>; files?: Record<string, unknown> },
  ): Promise<HttpResponse> {
    this.posts.push({ url, init });
    return new FakeResponse({ ok: true });
  }
}

describe("TelegramAdapter", () => {
  // PYTHON test_telegram_parse_text
  it("parses a text update", async () => {
    const adapter = new TelegramAdapter("TOKEN", { httpClient: new FakeClient() });
    const update = { message: { chat: { id: 99 }, from: { id: 42 }, text: "hello bot" } };
    const msg = await adapter.parseInbound(update);
    expect(msg.channel).toBe("telegram");
    expect(msg.channelUserId).toBe("42");
    expect(msg.channelChatId).toBe("99");
    expect(msg.userInput.to_text()).toBe("hello bot");
    expect(adapter.kind).toBe("messaging");
  });

  // PYTHON test_telegram_parse_photo_downloads_image
  it("downloads the largest photo", async () => {
    const client = new FakeClient({
      getFile: new FakeResponse({ result: { file_path: "photos/x.jpg" } }),
      "/file/bot": new FakeResponse({}, Buffer.from("JPEGDATA")),
    });
    const adapter = new TelegramAdapter("TOKEN", { httpClient: client });
    const update = {
      message: {
        chat: { id: 1 },
        from: { id: 2 },
        caption: "look",
        photo: [
          { file_id: "small", file_size: 100 },
          { file_id: "big", file_size: 9999 },
        ],
      },
    };
    const msg = await adapter.parseInbound(update);
    expect(msg.userInput.has_images()).toBe(true);
    expect(msg.userInput.to_text()).toBe("look");
    expect(client.gets[0]?.init?.params?.file_id).toBe("big");
    const image = msg.userInput.image_parts()[0] as ImageBase64Part;
    expect(Buffer.from(image.data, "base64").toString("utf8")).toBe("JPEGDATA");
  });

  // PYTHON test_telegram_send_reply_posts_message
  it("posts sendMessage for a text reply", async () => {
    const client = new FakeClient();
    const adapter = new TelegramAdapter("TOKEN", { httpClient: client });
    const message: InboundMessage = {
      channel: "telegram",
      channelUserId: "42",
      channelChatId: "99",
      userInput: UserInput.from_text("hi"),
    };
    await adapter.sendReply(message, { text: "reply!" });
    const first = client.posts[0];
    expect(first?.url).toContain("sendMessage");
    expect(first?.init?.json).toEqual({ chat_id: "99", text: "reply!" });
  });

  it("posts sendVoice when the reply has audio", async () => {
    const client = new FakeClient();
    const adapter = new TelegramAdapter("TOKEN", { httpClient: client });
    await adapter.sendReply(
      {
        channel: "telegram",
        channelUserId: "42",
        channelChatId: "99",
        userInput: UserInput.from_text("hi"),
      },
      { audio: Buffer.from("ogg") },
    );
    expect(client.posts[0]?.url).toContain("sendVoice");
    expect(client.posts[0]?.init?.files).toBeDefined();
  });

  it("parses voice notes when media download is on", async () => {
    const client = new FakeClient({
      getFile: new FakeResponse({ result: { file_path: "voice/x.ogg" } }),
      "/file/bot": new FakeResponse({}, Buffer.from("OGGDATA")),
    });
    const adapter = new TelegramAdapter("TOKEN", { httpClient: client });
    const msg = await adapter.parseInbound({
      message: {
        chat: { id: 1 },
        from: { id: 2 },
        voice: { file_id: "v1", mime_type: "audio/ogg" },
      },
    });
    expect(msg.userInput.has_audio()).toBe(true);
    expect(msg.userInput.audio_parts()[0]?.to_bytes().toString("utf8")).toBe("OGGDATA");
  });

  it("skips media when downloadMedia is false", async () => {
    const client = new FakeClient();
    const adapter = new TelegramAdapter("TOKEN", { httpClient: client, downloadMedia: false });
    const msg = await adapter.parseInbound({
      message: {
        chat: { id: 1 },
        from: { id: 2 },
        caption: "look",
        photo: [{ file_id: "big", file_size: 9 }],
      },
    });
    expect(msg.userInput.has_images()).toBe(false);
    expect(msg.userInput.to_text()).toBe("look");
    expect(client.gets).toHaveLength(0);
  });

  it("parses edited_message and uses a custom name", async () => {
    const adapter = new TelegramAdapter("TOKEN", { name: "tg", httpClient: new FakeClient() });
    const msg = await adapter.parseInbound({
      edited_message: { chat: { id: 7 }, from: { id: 8 }, text: "edit" },
    });
    expect(adapter.name).toBe("tg");
    expect(msg.channel).toBe("tg");
    expect(msg.userInput.to_text()).toBe("edit");
  });

  it("throws when no httpClient is configured", async () => {
    const adapter = new TelegramAdapter("TOKEN");
    await expect(
      adapter.sendReply(
        { channel: "telegram", channelUserId: "1", userInput: UserInput.from_text("x") },
        { text: "hi" },
      ),
    ).rejects.toThrow(/httpClient/);
  });
});

describe("WhatsAppAdapter", () => {
  // PYTHON test_whatsapp_parse_text_and_send
  it("parses text and posts a Cloud API reply", async () => {
    const client = new FakeClient();
    const adapter = new WhatsAppAdapter("WATOKEN", "PHONE123", { httpClient: client });
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [{ from: "15551230000", type: "text", text: { body: "hey" } }],
              },
            },
          ],
        },
      ],
    };
    const msg = await adapter.parseInbound(payload);
    expect(msg.channelUserId).toBe("15551230000");
    expect(msg.userInput.to_text()).toBe("hey");

    await adapter.sendReply(msg, { text: "hi there" });
    const first = client.posts[0];
    expect(first?.url).toContain("PHONE123/messages");
    expect((first?.init?.json as { text: { body: string } }).text.body).toBe("hi there");
    // PYTHON asserted Authorization: Bearer WATOKEN. The TS adapter is library-only
    // and does not attach auth headers — the injected client must do that.
  });

  // PYTHON test_whatsapp_parse_image_downloads_media
  it("downloads image media and keeps the caption", async () => {
    const client = new FakeClient({
      "/MEDIA1": new FakeResponse({ url: "https://cdn/media1" }),
      media1: new FakeResponse({}, Buffer.from("IMGBYTES")),
    });
    const adapter = new WhatsAppAdapter("WATOKEN", "PHONE123", { httpClient: client });
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "1555",
                    type: "image",
                    image: { id: "MEDIA1", caption: "see", mime_type: "image/png" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const msg = await adapter.parseInbound(payload);
    expect(msg.userInput.has_images()).toBe(true);
    expect(msg.userInput.to_text()).toBe("see");
    const image = msg.userInput.image_parts()[0] as ImageBase64Part;
    expect(image.mime_type).toBe("image/png");
    expect(Buffer.from(image.data, "base64").toString("utf8")).toBe("IMGBYTES");
  });

  it("downloads audio messages", async () => {
    const client = new FakeClient({
      "/AUD1": new FakeResponse({ url: "https://cdn/aud1" }),
      aud1: new FakeResponse({}, Buffer.from("WAV")),
    });
    const adapter = new WhatsAppAdapter("WATOKEN", "PHONE123", { httpClient: client });
    const msg = await adapter.parseInbound({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [{ from: "1555", type: "audio", audio: { id: "AUD1", mime_type: "audio/ogg" } }],
              },
            },
          ],
        },
      ],
    });
    expect(msg.userInput.has_audio()).toBe(true);
    expect(msg.userInput.audio_parts()[0]?.to_bytes().toString("utf8")).toBe("WAV");
  });

  it("returns empty text for an empty webhook", async () => {
    const adapter = new WhatsAppAdapter("WATOKEN", "PHONE123", { httpClient: new FakeClient() });
    const msg = await adapter.parseInbound({});
    expect(msg.userInput.to_text()).toBe("");
    expect(msg.channelUserId).toBe("");
  });

  it("does not post when the reply has no text", async () => {
    const client = new FakeClient();
    const adapter = new WhatsAppAdapter("WATOKEN", "PHONE123", { httpClient: client });
    await adapter.sendReply(
      { channel: "whatsapp", channelUserId: "1", userInput: UserInput.from_text("x") },
      {},
    );
    expect(client.posts).toHaveLength(0);
  });
});

class VisionExecutor {
  received: unknown = null;

  constructor(readonly ctx: RunContext) {}

  async run(userInput: unknown) {
    this.received = userInput;
    return { finalResponse: "I see an image" };
  }
}

class ImageChannel implements ChannelAdapter {
  readonly name = "img";
  readonly kind = "messaging" as const;
  readonly sent: AgentOutput[] = [];

  async parseInbound(): Promise<InboundMessage> {
    return {
      channel: "img",
      channelUserId: "u1",
      userInput: new UserInput([ImageBase64Part.from_bytes(Buffer.from("img"))]),
    };
  }

  async sendReply(_message: InboundMessage, output: AgentOutput): Promise<void> {
    this.sent.push(output);
  }
}

describe("ChannelRouter vision routing", () => {
  // PYTHON test_router_routes_images_to_vision_executor
  it("routes images to the vision executor", async () => {
    const channel = new ImageChannel();
    const captured: VisionExecutor[] = [];
    const router = new ChannelRouter(
      channel,
      () => {
        throw new Error("text executor should not be used for image input");
      },
      {
        visionExecutorFactory: (ctx) => {
          const ex = new VisionExecutor(ctx);
          captured.push(ex);
          return ex;
        },
      },
    );
    const output = await router.handle({});
    expect(output.text).toBe("I see an image");
    expect(captured[0]?.received).toBeInstanceOf(UserInput);
    expect((captured[0]?.received as UserInput).has_images()).toBe(true);
  });

  it("uses the text executor when no vision factory is set", async () => {
    const channel = new ImageChannel();
    let sawText = false;
    const router = new ChannelRouter(channel, () => ({
      async run(userMessage: string | unknown) {
        sawText = true;
        return { finalResponse: `text:${String(userMessage)}` };
      },
    }));
    const output = await router.handle({});
    expect(sawText).toBe(true);
    expect(output.text).toBe("text:");
  });
});
