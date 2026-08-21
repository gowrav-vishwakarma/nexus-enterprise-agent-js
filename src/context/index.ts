/** Context management package for the Nexus Agent Framework. */

export { ContextWindowBuilder } from "./builder.js";
export type { ChatMessage, EventEmitterLike } from "./builder.js";
export { RCSSystemPromptInjector } from "./rcs-injector.js";
export { MemoryPromptInjector } from "./memory-injector.js";
export { SummaryPromptInjector } from "./summary-injector.js";
export { ContextSummarizer } from "./summarizer.js";
export type { SessionManagerLike } from "./summarizer.js";
