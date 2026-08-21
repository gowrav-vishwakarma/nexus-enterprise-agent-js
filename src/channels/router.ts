/** Route an inbound channel message through an agent and reply. */

import type { RunContext } from "../tools/context.js";
import {
  StaticIdentityResolver,
  type AgentOutput,
  type ChannelAdapter,
  type ChannelIdentityResolver,
  type InboundMessage,
} from "./base.js";

export interface ChannelExecutor {
  run(
    userMessage: string | unknown,
    options?: { sessionId?: string | null },
  ): Promise<unknown>;
}

export type ExecutorFactory = (ctx: RunContext) => ChannelExecutor;

export interface STTLike {
  transcribe(audio: Buffer, mimeType?: string): Promise<string>;
}

export interface TTSLike {
  synthesize(text: string): Promise<Buffer>;
}

export class ChannelRouter {
  readonly adapter: ChannelAdapter;
  readonly executorFactory: ExecutorFactory;
  readonly identityResolver: ChannelIdentityResolver;
  readonly stt?: STTLike | null;
  readonly tts?: TTSLike | null;
  readonly replyWithAudio: boolean;
  readonly visionExecutorFactory?: ExecutorFactory | null;

  constructor(
    adapter: ChannelAdapter,
    executorFactory: ExecutorFactory,
    options: {
      identityResolver?: ChannelIdentityResolver | null;
      stt?: STTLike | null;
      tts?: TTSLike | null;
      replyWithAudio?: boolean;
      visionExecutorFactory?: ExecutorFactory | null;
    } = {},
  ) {
    this.adapter = adapter;
    this.executorFactory = executorFactory;
    this.identityResolver = options.identityResolver ?? new StaticIdentityResolver();
    this.stt = options.stt ?? null;
    this.tts = options.tts ?? null;
    this.replyWithAudio = options.replyWithAudio ?? false;
    this.visionExecutorFactory = options.visionExecutorFactory ?? null;
  }

  async handle(raw: unknown): Promise<AgentOutput> {
    const message = await this.adapter.parseInbound(raw);
    const runContext = this.identityResolver.resolve(message);

    let result: unknown;
    if (message.userInput.has_images() && this.visionExecutorFactory) {
      const executor = this.visionExecutorFactory(runContext);
      result = await executor.run(message.userInput, { sessionId: runContext.sessionId });
    } else {
      const text = await this.resolveText(message);
      const executor = this.executorFactory(runContext);
      result = await executor.run(text, { sessionId: runContext.sessionId });
    }

    const replyText = extractFinalResponse(result);
    const output: AgentOutput = {
      text: replyText,
      sessionId: runContext.sessionId,
    };

    if (this.replyWithAudio && this.tts && replyText) {
      try {
        output.audio = await this.tts.synthesize(replyText);
      } catch (error) {
        console.warn(`ChannelRouter: TTS synthesis failed: ${String(error)}`);
      }
    }

    await this.adapter.sendReply(message, output);
    return output;
  }

  private async resolveText(message: InboundMessage): Promise<string> {
    const text = message.userInput.to_text();
    if (!message.userInput.has_audio() || !this.stt) return text;
    const transcripts: string[] = [];
    for (const audioPart of message.userInput.audio_parts()) {
      try {
        const transcript = await this.stt.transcribe(audioPart.to_bytes(), audioPart.mime_type);
        if (transcript) transcripts.push(transcript);
      } catch (error) {
        console.warn(`ChannelRouter: STT transcription failed: ${String(error)}`);
      }
    }
    return [text, ...transcripts].filter(Boolean).join(" ").trim();
  }
}

function extractFinalResponse(result: unknown): string | null {
  if (result && typeof result === "object" && "finalResponse" in result) {
    const value = (result as { finalResponse?: unknown }).finalResponse;
    return value == null ? null : String(value);
  }
  if (result && typeof result === "object" && "final_response" in result) {
    const value = (result as { final_response?: unknown }).final_response;
    return value == null ? null : String(value);
  }
  return null;
}
