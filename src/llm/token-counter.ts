import { getEncoding, encodingForModel } from "js-tiktoken";

export class TokenCounter {
  static countString(text: string, model = "gpt-4o"): number {
    if (!text) {
      return 0;
    }
    try {
      let encoding;
      try {
        encoding = encodingForModel(model as Parameters<typeof encodingForModel>[0]);
      } catch {
        if (model.includes("o1") || model.includes("o3")) {
          encoding = getEncoding("o200k_base");
        } else {
          encoding = getEncoding("cl100k_base");
        }
      }
      return encoding.encode(text).length;
    } catch {
      return Math.floor(text.length / 4);
    }
  }

  static countMessages(messages: Array<Record<string, unknown>>, model = "gpt-4o"): number {
    let encoding;
    try {
      try {
        encoding = encodingForModel(model as Parameters<typeof encodingForModel>[0]);
      } catch {
        encoding = getEncoding("cl100k_base");
      }
    } catch {
      let total = 0;
      for (const msg of messages) {
        total += TokenCounter.countString(String(msg.content ?? ""), model);
        total += 4;
      }
      return total;
    }

    let tokensPerMessage = 3;
    let tokensPerName = 1;
    if (model.includes("gpt-3.5-turbo-0301")) {
      tokensPerMessage = 4;
      tokensPerName = -1;
    }

    let numTokens = 0;
    for (const message of messages) {
      numTokens += tokensPerMessage;
      for (const [key, value] of Object.entries(message)) {
        if (value == null) {
          continue;
        }
        if (Array.isArray(value)) {
          for (const item of value) {
            numTokens += encoding.encode(String(item)).length;
            if (typeof item === "object" && item !== null) {
              numTokens += encoding.encode(JSON.stringify(item)).length;
            }
          }
        } else if (typeof value === "object") {
          numTokens += encoding.encode(JSON.stringify(value)).length;
        } else {
          numTokens += encoding.encode(String(value)).length;
        }
        if (key === "name") {
          numTokens += tokensPerName;
        }
      }
    }
    numTokens += 3;
    return numTokens;
  }

  static estimateToolSchemaOverhead(tools: Array<Record<string, unknown>>, model = "gpt-4o"): number {
    if (!tools.length) {
      return 0;
    }
    return TokenCounter.countString(JSON.stringify(tools), model);
  }
}
