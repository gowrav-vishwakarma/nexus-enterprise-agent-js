/** Inject rolling conversation summary into system prompts when templates omit Jinja blocks. */

import type { ContextSummaryConfig } from "../config/context-summary.js";

const SUMMARY_HEADING = "## Conversation Summary";

export class SummaryPromptInjector {
  static inject(
    systemMessage: string,
    summaryText: string,
    summaryCfg: ContextSummaryConfig | null | undefined,
  ): string {
    if (
      !summaryCfg ||
      summaryCfg.summarize_on == null ||
      !summaryCfg.inject_into_prompt
    ) {
      return systemMessage;
    }
    if (!summaryText?.trim()) {
      return systemMessage;
    }
    if (systemMessage.includes(SUMMARY_HEADING)) {
      return systemMessage;
    }

    const block = `${SUMMARY_HEADING}\n${summaryText.trim()}`;
    if (systemMessage) {
      return `${systemMessage.trimEnd()}\n\n${block}`;
    }
    return block;
  }
}
