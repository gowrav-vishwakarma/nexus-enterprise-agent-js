/** Realtime stream events emitted by voice/AV pipelines. */

export type RealtimeEventType =
  | "session_started"
  | "transcript_partial"
  | "transcript_final"
  | "content"
  | "audio_out"
  | "tool_call"
  | "tool_result"
  | "barge_in"
  | "dtmf"
  | "turn_end"
  | "final_response"
  | "error"
  | "event";

export class RealtimeStreamEvent {
  event_type: RealtimeEventType;
  content?: string | null;
  audio?: Uint8Array | null;
  data?: Record<string, unknown> | null;

  constructor(init: {
    event_type: RealtimeEventType;
    content?: string | null;
    audio?: Uint8Array | Buffer | null;
    data?: Record<string, unknown> | null;
  }) {
    this.event_type = init.event_type;
    this.content = init.content ?? null;
    this.audio = init.audio
      ? init.audio instanceof Uint8Array
        ? init.audio
        : new Uint8Array(init.audio)
      : null;
    this.data = init.data ?? null;
  }

  get audio_b64(): string | null {
    if (!this.audio) return null;
    return Buffer.from(this.audio).toString("base64");
  }

  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = { event_type: this.event_type };
    if (this.content != null) out.content = this.content;
    if (this.data != null) out.data = this.data;
    return out;
  }

  static transcript(
    text: string,
    options: { final: boolean } & Record<string, unknown>,
  ): RealtimeStreamEvent {
    const { final, ...data } = options;
    return new RealtimeStreamEvent({
      event_type: final ? "transcript_final" : "transcript_partial",
      content: text,
      data: Object.keys(data).length ? data : null,
    });
  }

  static audio_chunk(
    audio: Uint8Array | Buffer,
    data: Record<string, unknown> = {},
  ): RealtimeStreamEvent {
    return new RealtimeStreamEvent({
      event_type: "audio_out",
      audio,
      data: Object.keys(data).length ? data : null,
    });
  }

  static text_delta(text: string, data: Record<string, unknown> = {}): RealtimeStreamEvent {
    return new RealtimeStreamEvent({
      event_type: "content",
      content: text,
      data: Object.keys(data).length ? data : null,
    });
  }

  get eventType(): RealtimeEventType {
    return this.event_type;
  }
}

export function transcriptEvent(
  text: string,
  options: { final: boolean } & Record<string, unknown> = { final: true },
): RealtimeStreamEvent {
  return RealtimeStreamEvent.transcript(text, options);
}

export function audioChunkEvent(
  audio: Uint8Array | Buffer,
  data: Record<string, unknown> = {},
): RealtimeStreamEvent {
  return RealtimeStreamEvent.audio_chunk(audio, data);
}

export function textDeltaEvent(text: string, data: Record<string, unknown> = {}): RealtimeStreamEvent {
  return RealtimeStreamEvent.text_delta(text, data);
}

export function realtimeEvent(
  eventType: RealtimeEventType,
  extra: { content?: string | null; data?: Record<string, unknown> | null } = {},
): RealtimeStreamEvent {
  return new RealtimeStreamEvent({
    event_type: eventType,
    content: extra.content,
    data: extra.data,
  });
}
