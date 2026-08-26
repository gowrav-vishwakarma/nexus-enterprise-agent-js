/** Split Qwen-style `<think>…</think>` out of streamed model text. */

export type ThinkSplit = { content?: string; reasoning?: string };

const OPEN = "<think>";
const CLOSE = "</think>";

function flushSafePrefix(buf: string, tag: string): string {
  for (let n = Math.min(tag.length - 1, buf.length); n > 0; n -= 1) {
    if (tag.startsWith(buf.slice(-n))) return buf.slice(0, -n);
  }
  return buf;
}

export class ThinkTagSplitter {
  private buf = "";
  private inThink = false;

  push(text: string): ThinkSplit[] {
    if (!text) return [];
    this.buf += text;
    const out: ThinkSplit[] = [];
    while (this.buf) {
      if (!this.inThink) {
        const i = this.buf.indexOf(OPEN);
        if (i === -1) {
          const safe = flushSafePrefix(this.buf, OPEN);
          if (safe) {
            out.push({ content: safe });
            this.buf = this.buf.slice(safe.length);
          }
          break;
        }
        if (i > 0) out.push({ content: this.buf.slice(0, i) });
        this.buf = this.buf.slice(i + OPEN.length);
        this.inThink = true;
        continue;
      }
      const i = this.buf.indexOf(CLOSE);
      if (i === -1) {
        const safe = flushSafePrefix(this.buf, CLOSE);
        if (safe) {
          out.push({ reasoning: safe });
          this.buf = this.buf.slice(safe.length);
        }
        break;
      }
      if (i > 0) out.push({ reasoning: this.buf.slice(0, i) });
      this.buf = this.buf.slice(i + CLOSE.length);
      this.inThink = false;
    }
    return out;
  }

  end(): ThinkSplit[] {
    if (!this.buf) return [];
    const leftover = this.buf;
    this.buf = "";
    return [this.inThink ? { reasoning: leftover } : { content: leftover }];
  }
}

export function splitThinkTags(text: string): { content: string; reasoning: string } {
  const splitter = new ThinkTagSplitter();
  const parts = [...splitter.push(text), ...splitter.end()];
  return {
    content: parts.map((p) => p.content ?? "").join(""),
    reasoning: parts.map((p) => p.reasoning ?? "").join(""),
  };
}
