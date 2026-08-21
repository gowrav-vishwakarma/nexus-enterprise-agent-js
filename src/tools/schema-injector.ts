/** RCS Schema Injector to add _context_updates to tool parameters. */

import type { RuntimeContextSummarizerConfig } from "../config/rcs.js";
import { getContextUpdatesDescription } from "../config/rcs.js";

export class RCSSchemaInjector {
  /** Inject the _context_updates parameters schema into the tool's schema. */
  static inject(
    schema: Record<string, unknown>,
    rcsConfig: RuntimeContextSummarizerConfig,
  ): Record<string, unknown> {
    if (!rcsConfig?.enabled) {
      return schema;
    }

    const next = { ...schema };
    const properties =
      typeof next.properties === "object" && next.properties != null
        ? { ...(next.properties as Record<string, unknown>) }
        : {};

    const description =
      rcsConfig.context_updates_param_description ||
      getContextUpdatesDescription(rcsConfig) ||
      "(Optional) Compress previous tool results you no longer need in full.";

    properties[rcsConfig.context_updates_param_name] = {
      type: "array",
      description,
      items: {
        type: "object",
        required: ["tc_id", "summary"],
        properties: {
          tc_id: {
            type: "string",
            description: "The TC tag of the result to compress, e.g. 'TC1', 'TC3'",
          },
          summary: {
            type: "string",
            description:
              "Your compact summary of that result. Pass '[]' if the result had nothing useful and should be dropped.",
          },
        },
      },
      default: [],
    };

    next.properties = properties;
    return next;
  }
}
