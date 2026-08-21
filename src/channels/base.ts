/** Core channel contracts shared by realtime and messaging channels. */

import type { UserInput } from "../realtime/input.js";
import { createRunContext, type RunContext } from "../tools/context.js";

export type ChannelKind = "realtime" | "messaging";

export interface InboundMessage {
  channel: string;
  kind?: ChannelKind;
  channelUserId: string;
  channelChatId?: string | null;
  userInput: UserInput;
  tenantId?: string | null;
  raw?: Record<string, unknown>;
}

export interface AgentOutput {
  text?: string | null;
  audio?: Buffer | null;
  audioMimeType?: string;
  sessionId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ChannelAdapter {
  name: string;
  kind: ChannelKind;
  parseInbound(raw: unknown): Promise<InboundMessage>;
  sendReply(message: InboundMessage, output: AgentOutput): Promise<void>;
}

export interface ChannelIdentityResolver {
  resolve(message: InboundMessage): RunContext;
}

export class StaticIdentityResolver implements ChannelIdentityResolver {
  constructor(
    private readonly tenantId?: string | null,
    private readonly sessionPrefix = "",
  ) {}

  resolve(message: InboundMessage): RunContext {
    const tenantId = message.tenantId ?? this.tenantId ?? null;
    const chatId = message.channelChatId ?? message.channelUserId;
    const sessionId = `${this.sessionPrefix}${message.channel}_${chatId}`;
    return createRunContext({
      tenantId,
      userId: `${message.channel}:${message.channelUserId}`,
      sessionId,
      metadata: { channel: message.channel, channelChatId: chatId },
    });
  }
}
