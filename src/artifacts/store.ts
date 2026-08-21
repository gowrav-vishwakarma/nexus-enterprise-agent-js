/** Artifact storage protocol. */

import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ScopeLevel, scopeKey } from "../scope.js";
import { sanitizeSegment } from "../storage/paths.js";
import type { RunContext } from "../tools/context.js";

export interface ArtifactMeta {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  metadata?: Record<string, unknown>;
}

export interface ArtifactStore {
  put(
    ctx: RunContext,
    data: Buffer,
    opts: { filename: string; contentType?: string },
  ): Promise<ArtifactMeta>;
  get(ctx: RunContext, artifactId: string): Promise<Buffer | null>;
}

export class LocalArtifactStore implements ArtifactStore {
  private readonly root: string;

  constructor(root = "./artifacts") {
    this.root = resolve(root);
    mkdirSync(this.root, { recursive: true });
  }

  private dir(ctx: RunContext): string {
    const key = scopeKey(ctx, ScopeLevel.User, "artifacts");
    let path = this.root;
    for (const segment of key.split(":")) {
      path = join(path, sanitizeSegment(segment, "_"));
    }
    path = this.ensureInside(path);
    mkdirSync(path, { recursive: true });
    return path;
  }

  private ensureInside(path: string): string {
    const resolved = resolve(path);
    if (resolved !== this.root && !resolved.startsWith(this.root + "/")) {
      throw new Error(`Artifact path escapes the store root: ${path}`);
    }
    return resolved;
  }

  async put(
    ctx: RunContext,
    data: Buffer,
    opts: { filename: string; contentType?: string },
  ): Promise<ArtifactMeta> {
    const aid = randomUUID();
    const safeName = sanitizeSegment(opts.filename, "artifact");
    const path = this.ensureInside(join(this.dir(ctx), `${aid}_${safeName}`));
    writeFileSync(path, data);
    return {
      id: aid,
      filename: opts.filename,
      contentType: opts.contentType ?? "application/octet-stream",
      sizeBytes: data.length,
    };
  }

  async get(ctx: RunContext, artifactId: string): Promise<Buffer | null> {
    const safeId = sanitizeSegment(artifactId, "");
    if (!safeId) return null;
    const directory = this.dir(ctx);
    for (const name of readdirSync(directory)) {
      if (name.startsWith(`${safeId}_`)) {
        return readFileSync(join(directory, name));
      }
    }
    return null;
  }
}
