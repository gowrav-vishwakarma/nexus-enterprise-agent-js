/** Ports of Python tests/test_storage_paths.py — tenant-scoped path helpers. */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDataRoot,
  lookupSession,
  memoryDbPath,
  registerSession,
  sanitizeSegment,
  sessionFile,
  sessionsDbPath,
  tenantUserDir,
  unregisterSession,
} from "../src/storage/paths.js";

describe("storage paths", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // PYTHON: test_sanitize_segment_replaces_unsafe_chars
  it("replaces unsafe path characters", () => {
    expect(sanitizeSegment("acme/corp", "_default")).toBe("acme_corp");
    expect(sanitizeSegment(null, "_default")).toBe("_default");
    expect(sanitizeSegment("", "_default")).toBe("_default");
  });

  // PYTHON: test_tenant_user_paths
  it("builds tenant/user session and db paths", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "nexus-paths-"));
    const root = tenantUserDir("t1", "u1", tmp);
    expect(root.endsWith(join("t1", "users", "u1"))).toBe(true);
    expect(sessionFile("t1", "u1", "sess-1", tmp).endsWith(join("t1", "users", "u1", "sess-1", "session.json"))).toBe(
      true,
    );
    expect(sessionsDbPath("t1", "u1", tmp).endsWith(join("t1", "users", "u1", "sessions.db"))).toBe(true);
    expect(memoryDbPath("t1", "u1", tmp).endsWith(join("t1", "users", "u1", "memory.db"))).toBe(true);
  });

  // PYTHON: test_nexus_data_root_env_override
  it("honors NEXUS_DATA_ROOT", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "nexus-data-root-"));
    vi.stubEnv("NEXUS_DATA_ROOT", tmp);
    expect(getDataRoot()).toBe(tmp);
  });

  // PYTHON: test_session_index_round_trip
  it("round-trips the session index", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "nexus-index-"));
    await registerSession("sess-a", "t1", "u1", tmp);
    expect(await lookupSession("sess-a", tmp)).toEqual({ tenant_id: "t1", user_id: "u1" });
    await unregisterSession("sess-a", tmp);
    expect(await lookupSession("sess-a", tmp)).toBeNull();
  });
});
