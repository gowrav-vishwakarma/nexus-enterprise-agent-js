/** Inject cross-session user memory into system prompts when templates omit Jinja blocks. */

import type { MemoryConfig } from "../config/memory.js";

const USER_MEMORY_HEADING = "## About this user";

export class MemoryPromptInjector {
  private static storeTitle(memoryCfg: MemoryConfig, storeName: string): string {
    for (const store of memoryCfg.stores ?? []) {
      if (store.name === storeName) {
        const desc = (store.description ?? "").trim();
        return desc || store.name;
      }
    }
    return storeName;
  }

  private static formatBlock(
    facts: Record<string, string>,
    memoryCfg: MemoryConfig | null | undefined,
  ): string {
    if (!memoryCfg?.stores?.length) {
      const lines = Object.entries(facts).map(([key, value]) => `- ${key}: ${value}`);
      return `${USER_MEMORY_HEADING}\n${lines.join("\n")}`;
    }

    const grouped = new Map<string, Array<[string, string]>>();
    const unprefixed: Array<[string, string]> = [];
    const known = new Set((memoryCfg.stores ?? []).map((s) => s.name));

    for (const [key, value] of Object.entries(facts)) {
      const slash = key.indexOf("/");
      if (slash >= 0) {
        const storeName = key.slice(0, slash);
        const rest = key.slice(slash + 1);
        if (known.has(storeName) && rest) {
          const entries = grouped.get(storeName) ?? [];
          entries.push([rest, value]);
          grouped.set(storeName, entries);
          continue;
        }
      }
      unprefixed.push([key, value]);
    }

    const parts: string[] = [USER_MEMORY_HEADING];
    for (const store of memoryCfg.stores ?? []) {
      const entries = grouped.get(store.name);
      if (!entries?.length) continue;
      const title = MemoryPromptInjector.storeTitle(memoryCfg, store.name);
      parts.push(`### ${title}`);
      for (const [k, v] of entries) {
        parts.push(`- ${k}: ${v}`);
      }
    }
    for (const [k, v] of unprefixed) {
      parts.push(`- ${k}: ${v}`);
    }
    return parts.join("\n");
  }

  static inject(
    systemMessage: string,
    facts: Record<string, string>,
    memoryCfg: MemoryConfig | null | undefined,
  ): string {
    if (!memoryCfg?.enabled || !memoryCfg.inject_into_prompt) {
      return systemMessage;
    }
    if (!facts || Object.keys(facts).length === 0) {
      return systemMessage;
    }
    if (systemMessage.includes(USER_MEMORY_HEADING)) {
      return systemMessage;
    }

    const block = MemoryPromptInjector.formatBlock(facts, memoryCfg);
    if (systemMessage) {
      return `${systemMessage.trimEnd()}\n\n${block}`;
    }
    return block;
  }
}
