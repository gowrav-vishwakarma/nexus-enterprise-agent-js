/** RCS system prompt injector — appends the RCS protocol block to the system message. */

import { getRcsSystemBlock, type RuntimeContextSummarizerConfig } from "../config/rcs.js";

export class RCSSystemPromptInjector {
  static inject(
    systemMessage: string,
    rcsConfig: RuntimeContextSummarizerConfig | null | undefined,
  ): string {
    if (!rcsConfig?.enabled) {
      return systemMessage;
    }

    const rcsBlock = getRcsSystemBlock(rcsConfig);

    if (systemMessage) {
      return `${systemMessage.trimEnd()}\n\n${rcsBlock}`;
    }
    return rcsBlock;
  }
}
