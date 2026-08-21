/** Registry of channel adapters, declared like tool plugins in a manifest. */

import type { ChannelAdapter } from "./base.js";

export class ChannelRegistry {
  private readonly channels = new Map<string, ChannelAdapter>();

  register(adapter: ChannelAdapter): void {
    this.channels.set(adapter.name, adapter);
  }

  get(name: string): ChannelAdapter {
    const adapter = this.channels.get(name);
    if (!adapter) {
      throw new Error(
        `Channel '${name}' not registered. Available: ${[...this.channels.keys()].sort().join(", ")}`,
      );
    }
    return adapter;
  }

  has(name: string): boolean {
    return this.channels.has(name);
  }

  names(): string[] {
    return [...this.channels.keys()].sort();
  }

  [Symbol.iterator](): Iterator<ChannelAdapter> {
    return this.channels.values();
  }
}
