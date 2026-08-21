/** Memory provider protocol for pluggable external stores. */

import type { RunContext } from "../tools/context.js";

export interface MemoryProvider {
  prefetch(ctx: RunContext): Promise<Record<string, string>>;
  search(
    ctx: RunContext,
    query: string,
    k?: number,
  ): Promise<Array<Record<string, unknown>>>;
  write(
    ctx: RunContext,
    key: string,
    value: string,
    store?: string,
  ): Promise<void>;
  remove(ctx: RunContext, key: string, store?: string): Promise<void>;
  listStores(ctx: RunContext): Promise<string[]>;
  curate(ctx: RunContext, turnSummary: string): Promise<Record<string, string>>;
}

/** @deprecated Use MemoryProvider */
export type MemoryProviderProtocol = MemoryProvider;
