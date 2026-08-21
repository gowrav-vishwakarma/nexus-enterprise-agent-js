# MCP integration

**Who this is for:** Developers who want to expose Nexus tools to other agents, or mount tools from a Model Context Protocol (MCP) server.

## Key terms

- **MCP** — Model Context Protocol; a standard way for agents to call tools hosted by a separate process or service.
- **Server mode** — Your `ToolRegistry` becomes an MCP tool list that another client can call.
- **Client mode** — Nexus connects to a remote MCP server and registers its tools on your registry.
- **Transport** — How the client talks to the server: `stdio`, `sse`, or `streamable-http`.

Nexus supports both directions.

## Server mode — ready to use

Expose tools you already registered in a `ToolRegistry` so other agents (Cursor, Claude Desktop, another Nexus app) can call them. You supply the transport; Nexus converts schemas and dispatches calls.

```ts
import { executeMcpToolCall, toolsetToMcpTools } from "nexus-enterprise-agent";

const descriptors = toolsetToMcpTools(registry, ["get_invoice", "search_products"]);
// → [{ name, description, inputSchema }, ...]

const result = await executeMcpToolCall(registry, "get_invoice", { id: "INV-1" }, ctx);
```

Because dispatch goes through `registry.executeTool(..., ctx)`, every call carries a `RunContext`, so tenant scoping and tool policy apply exactly as they do in a normal agent run.

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `registry` | Yes | — | The `ToolRegistry` that owns the tools |
| `toolNames` | Yes | — | Which tools to advertise |
| `name` / `args` / `ctx` | Yes (execute) | — | Tool to run, arguments, and `RunContext` |

## Client mode

`MCPClient.connect()` initializes the remote server, lists tools, and `mountMcpTools()` registers them on your registry. Transports: `stdio` (spawn a command), `streamable-http` / `http` (POST JSON), and `sse`.

```ts
import { type MCPServerConfig, mountMcpTools } from "nexus-enterprise-agent";

const servers: MCPServerConfig[] = [
  {
    name: "filesystem",
    command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    transport: "stdio", // stdio | sse | streamable-http
    tools: ["read_file", "list_dir"], // optional allow-list; omit = all discovered tools
  },
];
const mounted = await mountMcpTools(registry, servers);
```

Each discovered tool mounts as `{prefix}.{tool}` where `prefix` is `MCPServerConfig.toolPrefix` or the server name.

### MCPServerConfig

| Name | Required? | Default | What it does |
|------|-----------|---------|--------------|
| `name` | Yes | — | Server id and default tool-name prefix |
| `command` | Yes for stdio | `null` | Process to spawn (`["npx", "-y", "…"]`) |
| `url` | Yes for HTTP/SSE | `null` | Remote MCP endpoint |
| `transport` | No | inferred | `stdio` if `command` is set; else `streamable-http` |
| `tools` | No | `null` | Allow-list; `null` mounts every discovered tool |
| `toolPrefix` | No | server `name` | Prefix for mounted tool names |
| `env` | No | `{}` | Extra environment for the stdio child process |
| `headers` | No | `{}` | Extra HTTP headers |

### Per-tenant credentials

Pass `credentialResolver` so each tenant uses its own credentials instead of a global config file:

```ts
await mountMcpTools(registry, servers, {
  credentialResolver: (ctx, serverName) => ({
    api_key: ctx.service("vault")?.get(ctx.tenantId, serverName),
  }),
});
```

The resolver receives the calling `RunContext` and the server name, and its return value is merged into the tool arguments. Credentials should come from `RunContext.auth` or `RunContext` services, never module-level config.

| Field / hook | Why |
|--------------|-----|
| `MCPServerConfig.transport` | Explicit `stdio`, `sse`, or `streamable-http` (do not guess) |
| `MCPServerConfig.tools` | Allow-list; `null` mounts every discovered tool |
| `credentialResolver(ctx, serverName)` | Per-tenant secrets from `RunContext`, not a global file |

`mountMcpTools` already skips tools that are not in `server.tools` when that list is set.

## Next steps

- [Tools](tools.md)
- [Run context](run-context.md)
- [Guardrails](guardrails.md)
