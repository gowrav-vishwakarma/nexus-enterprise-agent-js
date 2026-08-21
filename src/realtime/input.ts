/** Multimodal user input models shared by realtime pipelines and channels. */

export class TextPart {
  readonly type = "text" as const;
  text: string;

  constructor(text: string) {
    this.text = text;
  }
}

export class ImageUrlPart {
  readonly type = "image_url" as const;
  url: string;
  detail: "auto" | "low" | "high";

  constructor(url: string, detail: "auto" | "low" | "high" = "auto") {
    this.url = url;
    this.detail = detail;
  }
}

export class ImageBase64Part {
  readonly type = "image_base64" as const;
  data: string;
  mime_type: string;
  detail: "auto" | "low" | "high";

  constructor(
    data: string,
    mime_type = "image/png",
    detail: "auto" | "low" | "high" = "auto",
  ) {
    this.data = data;
    this.mime_type = mime_type;
    this.detail = detail;
  }

  static from_bytes(
    raw: Uint8Array | Buffer,
    mime_type = "image/png",
    detail: "auto" | "low" | "high" = "auto",
  ): ImageBase64Part {
    return new ImageBase64Part(Buffer.from(raw).toString("base64"), mime_type, detail);
  }

  to_data_url(): string {
    return `data:${this.mime_type};base64,${this.data}`;
  }
}

export class AudioPart {
  readonly type = "audio" as const;
  data: string;
  mime_type: string;
  sample_rate?: number | null;

  constructor(data: string, mime_type = "audio/wav", sample_rate?: number | null) {
    this.data = data;
    this.mime_type = mime_type;
    this.sample_rate = sample_rate ?? null;
  }

  static from_bytes(
    raw: Uint8Array | Buffer,
    mime_type = "audio/wav",
    sample_rate?: number | null,
  ): AudioPart {
    return new AudioPart(Buffer.from(raw).toString("base64"), mime_type, sample_rate);
  }

  to_bytes(): Buffer {
    return Buffer.from(this.data, "base64");
  }
}

export type ContentPart = TextPart | ImageUrlPart | ImageBase64Part | AudioPart;

export class UserInput {
  parts: ContentPart[];
  metadata: Record<string, unknown>;

  constructor(parts: ContentPart[] = [], metadata: Record<string, unknown> = {}) {
    this.parts = parts;
    this.metadata = metadata;
  }

  static from_text(text: string, metadata: Record<string, unknown> = {}): UserInput {
    return new UserInput([new TextPart(text)], metadata);
  }

  static from_image_url(
    url: string,
    text = "",
    detail: "auto" | "low" | "high" = "auto",
    metadata: Record<string, unknown> = {},
  ): UserInput {
    const parts: ContentPart[] = [];
    if (text) parts.push(new TextPart(text));
    parts.push(new ImageUrlPart(url, detail));
    return new UserInput(parts, metadata);
  }

  static from_image_bytes(
    raw: Uint8Array | Buffer,
    text = "",
    mime_type = "image/png",
    metadata: Record<string, unknown> = {},
  ): UserInput {
    const parts: ContentPart[] = [];
    if (text) parts.push(new TextPart(text));
    parts.push(ImageBase64Part.from_bytes(raw, mime_type));
    return new UserInput(parts, metadata);
  }

  to_text(): string {
    return this.parts
      .filter((p): p is TextPart => p instanceof TextPart)
      .map((p) => p.text)
      .join(" ")
      .trim();
  }

  text_parts(): TextPart[] {
    return this.parts.filter((p): p is TextPart => p instanceof TextPart);
  }

  image_parts(): Array<ImageUrlPart | ImageBase64Part> {
    return this.parts.filter(
      (p): p is ImageUrlPart | ImageBase64Part =>
        p instanceof ImageUrlPart || p instanceof ImageBase64Part,
    );
  }

  audio_parts(): AudioPart[] {
    return this.parts.filter((p): p is AudioPart => p instanceof AudioPart);
  }

  has_images(): boolean {
    return this.image_parts().length > 0;
  }

  has_audio(): boolean {
    return this.audio_parts().length > 0;
  }
}
