export { StaticIdentityResolver } from "./base.js";
export type {
  AgentOutput,
  ChannelAdapter,
  ChannelIdentityResolver,
  ChannelKind,
  InboundMessage,
} from "./base.js";
export { ChannelRegistry } from "./registry.js";
export { ChannelRouter, type ExecutorFactory } from "./router.js";
export { TelegramAdapter } from "./adapters/telegram.js";
export { WhatsAppAdapter } from "./adapters/whatsapp.js";
