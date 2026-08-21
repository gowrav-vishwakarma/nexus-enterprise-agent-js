/** MCP client that mounts remote tools into ToolRegistry. */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { defineTool, type NexusToolHandler } from "../tools/decorators.js";
import type { RunContext } from "../tools/context.js";
import type { ToolRegistry } from "../tools/registry.js";

export type MCPTransport = "stdio" | "sse" | "streamable-http" | "http";

export interface MCPServerConfig {
  name: string;
  command?: string[] | null;
  url?: string | null;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  toolPrefix?: string | null;
  transport?: MCPTransport | string | null;
  tools?: string[] | null;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

export class MCPClient {
  config: MCPServerConfig;
  private tools: Array<Record<string, unknown>> = [];
  private nextId = 1;
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdioBuffer: Buffer = Buffer.alloc(0);
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >();
  private sessionHeaders: Record<string, string> = {};

  constructor(config: MCPServerConfig) {
    this.config = config;
  }

  private transport(): MCPTransport {
    if (this.config.transport) return this.config.transport as MCPTransport;
    if (this.config.command?.length) return "stdio";
    if (this.config.url) return "streamable-http";
    return "http";
  }

  async connect(): Promise<void> {
    const kind = this.transport();
    if (kind === "stdio") {
      await this.connectStdio();
    }
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "nexus-enterprise-agent", version: "0.1.0" },
    });
    await this.notify("notifications/initialized", {});
    const listed = (await this.request("tools/list", {})) as {
      tools?: Array<Record<string, unknown>>;
    };
    this.tools = listed?.tools ?? [];
  }

  async listTools(): Promise<Array<Record<string, unknown>>> {
    return [...this.tools];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.request("tools/call", { name, arguments: args });
    return typeof result === "string" ? result : JSON.stringify(result);
  }

  async close(): Promise<void> {
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
    for (const [, pending] of this.pending) {
      pending.reject(new Error("MCP client closed"));
    }
    this.pending.clear();
  }

  private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const payload: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    const kind = this.transport();
    if (kind === "stdio") return this.stdioRequest(payload);
    if (kind === "sse") return this.sseRequest(payload);
    return this.httpRequest(payload);
  }

  private async notify(method: string, params: Record<string, unknown>): Promise<void> {
    const payload = { jsonrpc: "2.0", method, params };
    const kind = this.transport();
    try {
      if (kind === "stdio") {
        writeStdioFrame(this.requireChild().stdin, payload);
        return;
      }
      await this.httpPost(payload);
    } catch {
      /* notifications are best-effort */
    }
  }

  private async connectStdio(): Promise<void> {
    const command = this.config.command;
    if (!command?.length) {
      throw new Error(`MCP server '${this.config.name}' has no command for stdio transport`);
    }
    this.child = spawn(command[0]!, command.slice(1), {
      env: { ...process.env, ...(this.config.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.on("data", (chunk: Buffer) => this.onStdioData(chunk));
    this.child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").trim();
      if (text) console.warn(`[mcp:${this.config.name}] ${text}`);
    });
    this.child.on("exit", () => {
      for (const [, pending] of this.pending) {
        pending.reject(new Error(`MCP stdio process for '${this.config.name}' exited`));
      }
      this.pending.clear();
    });
  }

  private requireChild(): ChildProcessWithoutNullStreams {
    if (!this.child) {
      throw new Error(`MCP stdio transport is not connected for '${this.config.name}'`);
    }
    return this.child;
  }

  private stdioRequest(payload: JsonRpcRequest): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.pending.set(payload.id, { resolve, reject });
      writeStdioFrame(this.requireChild().stdin, payload);
    });
  }

  private onStdioData(chunk: Buffer): void {
    this.stdioBuffer = Buffer.concat([this.stdioBuffer, chunk]) as Buffer;
    while (true) {
      const message = readStdioFrame(this.stdioBuffer);
      if (!message) break;
      this.stdioBuffer = message.rest;
      this.dispatchResponse(message.value);
    }
  }

  private dispatchResponse(value: unknown): void {
    if (!value || typeof value !== "object") return;
    const msg = value as JsonRpcResponse;
    if (msg.id == null) return;
    const pending = this.pending.get(Number(msg.id));
    if (!pending) return;
    this.pending.delete(Number(msg.id));
    if (msg.error) {
      pending.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
      return;
    }
    pending.resolve(msg.result);
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(this.config.headers ?? {}),
      ...this.sessionHeaders,
    };
  }

  private endpoint(): string {
    if (!this.config.url) {
      throw new Error(`MCP server '${this.config.name}' has no url for HTTP transport`);
    }
    return this.config.url;
  }

  private async httpPost(payload: unknown): Promise<Response> {
    const response = await fetch(this.endpoint(), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
    });
    const session = response.headers.get("mcp-session-id");
    if (session) this.sessionHeaders["mcp-session-id"] = session;
    return response;
  }

  private async httpRequest(payload: JsonRpcRequest): Promise<unknown> {
    const response = await this.httpPost(payload);
    if (!response.ok) {
      throw new Error(`MCP HTTP ${response.status} from ${this.config.name}: ${await response.text()}`);
    }
    const body = await readJsonOrSse(response);
    return unwrapRpc(body);
  }

  private async sseRequest(payload: JsonRpcRequest): Promise<unknown> {
    const url = this.endpoint();
    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...this.headers(),
        accept: "text/event-stream",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`MCP SSE ${response.status} from ${this.config.name}: ${await response.text()}`);
    }
    const body = await readJsonOrSse(response);
    return unwrapRpc(body);
  }
}

function writeStdioFrame(stdin: NodeJS.WritableStream, payload: unknown): void {
  const json = JSON.stringify(payload);
  const body = Buffer.from(json, "utf8");
  stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
  stdin.write(body);
}

function readStdioFrame(
  buffer: Buffer,
): { value: unknown; rest: Buffer } | null {
  const headerEnd = buffer.indexOf("\r\n\r\n");
  if (headerEnd >= 0) {
    const header = buffer.subarray(0, headerEnd).toString("utf8");
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) return null;
    const length = Number(match[1]);
    const start = headerEnd + 4;
    if (buffer.length < start + length) return null;
    const json = buffer.subarray(start, start + length).toString("utf8");
    return { value: JSON.parse(json), rest: buffer.subarray(start + length) as Buffer };
  }
  const newline = buffer.indexOf("\n");
  if (newline < 0) return null;
  const line = buffer.subarray(0, newline).toString("utf8").trim();
  if (!line.startsWith("{")) return null;
  try {
    return { value: JSON.parse(line), rest: buffer.subarray(newline + 1) as Buffer };
  } catch {
    return null;
  }
}

async function readJsonOrSse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  if (contentType.includes("text/event-stream")) {
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        return JSON.parse(data);
      } catch {
        continue;
      }
    }
    throw new Error("SSE response contained no JSON data frames");
  }
  return text ? JSON.parse(text) : {};
}

function unwrapRpc(body: unknown): unknown {
  if (body && typeof body === "object" && "error" in body) {
    const err = (body as JsonRpcResponse).error;
    throw new Error(err?.message ?? JSON.stringify(err));
  }
  if (body && typeof body === "object" && "result" in body) {
    return (body as JsonRpcResponse).result;
  }
  return body;
}

export async function mountMcpTools(
  registry: ToolRegistry,
  servers: MCPServerConfig[],
  opts: {
    credentialResolver?: (
      ctx: RunContext,
      serverName: string,
    ) => Record<string, string>;
  } = {},
): Promise<string[]> {
  const mounted: string[] = [];
  for (const server of servers) {
    const client = new MCPClient(server);
    await client.connect();
    const prefix = server.toolPrefix ?? server.name;
    for (const toolDef of await client.listTools()) {
      const toolName = String(toolDef.name ?? "unknown");
      if (server.tools != null && !server.tools.includes(toolName)) continue;
      const fullName = `${prefix}.${toolName}`;
      const inputSchema =
        (toolDef.inputSchema as Record<string, unknown> | undefined) ??
        (toolDef.input_schema as Record<string, unknown> | undefined) ??
        { type: "object", properties: {} };
      const handler = defineTool(
        (async (ctx?: RunContext | null, kwargs: Record<string, unknown> = {}) => {
          const args = { ...kwargs };
          if (opts.credentialResolver && ctx) {
            Object.assign(args, opts.credentialResolver(ctx, server.name));
          }
          const result = await client.callTool(toolName, args);
          return String(result);
        }) as NexusToolHandler,
        {
          name: fullName,
          description: String(toolDef.description ?? `MCP tool ${toolName}`),
          parameters: inputSchema,
        },
      );
      registry.registerTool(handler, null);
      mounted.push(fullName);
    }
  }
  return mounted;
}
