/** RealtimeSession: bind a transport to a voice pipeline. */

import { createBaseEvent, NexusEventType } from "../events/models.js";
import type { NexusEventEmitter } from "../events/emitter.js";
import { RealtimeStreamEvent } from "./events.js";
import type { Transport } from "./transport/base.js";

export interface VoicePipelineLike {
  runContext: { sessionId?: string | null };
  config?: { name?: string; duplex?: string };
  processAudioStream(
    audioIn: AsyncIterable<Uint8Array | Buffer>,
    sessionId?: string | null,
  ): AsyncIterable<RealtimeStreamEvent>;
  processText(text: string, sessionId?: string | null): AsyncIterable<RealtimeStreamEvent>;
  runInitialResponse?(sessionId?: string | null): AsyncIterable<RealtimeStreamEvent>;
}

export type VoicePipeline = VoicePipelineLike;

export class RealtimeSession {
  readonly pipeline: VoicePipelineLike;
  readonly transport: Transport;
  readonly sessionId?: string | null;
  readonly eventEmitter?: NexusEventEmitter | null;
  private readonly agentId?: string | null;

  constructor(
    pipeline: VoicePipeline,
    transport: Transport,
    sessionId?: string | null,
    eventEmitter?: NexusEventEmitter | null,
  ) {
    this.pipeline = pipeline;
    this.transport = transport;
    this.sessionId = sessionId ?? pipeline.runContext.sessionId ?? null;
    this.eventEmitter = eventEmitter ?? null;
    this.agentId = pipeline.config?.name ?? null;
  }

  private async emitTelemetry(event: RealtimeStreamEvent): Promise<void> {
    if (!this.eventEmitter) return;
    const mapping: Partial<Record<string, NexusEventType>> = {
      session_started: NexusEventType.REALTIME_SESSION_STARTED,
      transcript_final: NexusEventType.REALTIME_TRANSCRIBED,
      barge_in: NexusEventType.REALTIME_BARGE_IN,
      final_response: NexusEventType.REALTIME_RESPONSE_COMPLETED,
      error: NexusEventType.REALTIME_ERROR,
    };
    const etype = mapping[event.event_type];
    if (!etype) return;
    const data = { ...(event.data ?? {}) };
    if (event.content != null) data.content ??= event.content;
    try {
      await this.eventEmitter.emit(
        createBaseEvent(etype, {
          sessionId: this.sessionId,
          agentId: this.agentId,
          data,
        }),
      );
    } catch {
      // telemetry must never break a call
    }
  }

  private async dispatch(event: RealtimeStreamEvent): Promise<void> {
    if (event.event_type === "audio_out" && event.audio != null) {
      await this.transport.sendAudio(event.audio);
    }
    await this.transport.sendEvent(event);
    await this.emitTelemetry(event);
  }

  async runAudio(): Promise<void> {
    try {
      const duplex = this.pipeline.config?.duplex ?? "full";
      if (this.pipeline.runInitialResponse && duplex !== "full") {
        for await (const event of this.pipeline.runInitialResponse(this.sessionId)) {
          await this.dispatch(event);
        }
      }
      for await (const event of this.pipeline.processAudioStream(
        this.transport.receiveAudio(),
        this.sessionId,
      )) {
        await this.dispatch(event);
      }
    } finally {
      await this.emitSessionEnded();
    }
  }

  async runText(text: string): Promise<void> {
    for await (const event of this.pipeline.processText(text, this.sessionId)) {
      await this.dispatch(event);
    }
  }

  private async emitSessionEnded(): Promise<void> {
    if (!this.eventEmitter) return;
    try {
      await this.eventEmitter.emit(
        createBaseEvent(NexusEventType.REALTIME_SESSION_ENDED, {
          sessionId: this.sessionId,
          agentId: this.agentId,
        }),
      );
    } catch {
      // ignore
    }
  }
}
