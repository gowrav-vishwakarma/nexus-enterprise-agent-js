/** Skill script sandbox adapters. */

import { spawn } from "node:child_process";
import type { FileSkill, SkillScript } from "./models.js";
import type { RunContext } from "../tools/context.js";

export class SkillExecutionDisabledError extends Error {
  constructor(message = "Skill script execution is disabled") {
    super(message);
    this.name = "SkillExecutionDisabledError";
  }
}

export interface SkillSandboxAdapter {
  runScript(
    skill: FileSkill,
    script: SkillScript,
    args?: string[] | null,
    opts?: { runContext?: RunContext | null },
  ): Promise<string>;
}

export class DisabledSkillSandbox implements SkillSandboxAdapter {
  async runScript(): Promise<string> {
    throw new SkillExecutionDisabledError(
      "No SkillSandboxAdapter configured. Set SkillsConfig.sandboxAdapter to 'local' or register one.",
    );
  }
}

export class LocalProcessSandbox implements SkillSandboxAdapter {
  constructor(private readonly timeoutMs = 30_000) {}

  async runScript(
    _skill: FileSkill,
    script: SkillScript,
    args?: string[] | null,
  ): Promise<string> {
    const command = resolveInterpreter(script.fullPath);
    return runProcess(command[0]!, [...command.slice(1), ...(args ?? [])], this.timeoutMs);
  }
}

const adapters = new Map<string, SkillSandboxAdapter | (new () => SkillSandboxAdapter)>();

export function registerSandboxAdapter(
  name: string,
  adapter: SkillSandboxAdapter | (new () => SkillSandboxAdapter),
): void {
  adapters.set(name, adapter);
}

export function resolveSandbox(
  ref?: string | SkillSandboxAdapter | null,
): SkillSandboxAdapter {
  if (!ref) return new DisabledSkillSandbox();
  if (typeof ref !== "string") return ref;
  if (ref === "local" || ref === "process") return new LocalProcessSandbox();
  const found = adapters.get(ref);
  if (!found) {
    throw new SkillExecutionDisabledError(`Unknown sandbox adapter: ${ref}`);
  }
  return typeof found === "function" ? new found() : found;
}

function resolveInterpreter(scriptPath: string): string[] {
  if (scriptPath.endsWith(".py")) return ["python3", scriptPath];
  if (scriptPath.endsWith(".js") || scriptPath.endsWith(".mjs")) {
    return ["node", scriptPath];
  }
  if (scriptPath.endsWith(".ts")) return ["npx", "tsx", scriptPath];
  return [scriptPath];
}

function runProcess(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Skill script timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim() || "(no output)");
      else reject(new Error(stderr.trim() || `Script exited with code ${code}`));
    });
  });
}

registerSandboxAdapter("local", LocalProcessSandbox);
registerSandboxAdapter("process", LocalProcessSandbox);
registerSandboxAdapter("disabled", DisabledSkillSandbox);
