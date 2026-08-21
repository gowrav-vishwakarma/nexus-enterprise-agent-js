/** Decorators for registering tools and plugins. */

export type ToolExecutionMode = "server" | "client";

export interface ToolDecoratorOptions {
  name?: string;
  description?: string;
  tags?: string[];
  requiresApproval?: boolean;
  timeoutSeconds?: number | null;
  execution?: ToolExecutionMode;
  parameters?: Record<string, unknown>;
}

export interface NexusToolMeta extends ToolDecoratorOptions {
  toolName: string;
}

export interface NexusPluginMeta {
  pluginName: string;
}

export type NexusToolHandler = (...args: any[]) => unknown | Promise<unknown>;

const NEXUS_TOOL = "_nexus_tool";
const NEXUS_PLUGIN = "_nexus_plugin";

export function isNexusTool(fn: unknown): fn is NexusToolHandler & Record<string, unknown> {
  return typeof fn === "function" && Boolean((fn as unknown as Record<string, unknown>)[NEXUS_TOOL]);
}

export function getToolMeta(fn: NexusToolHandler): NexusToolMeta {
  const target = fn as NexusToolHandler & Record<string, unknown>;
  return {
    toolName: String(target._tool_name ?? fn.name),
    name: target._tool_name as string | undefined,
    description: (target._tool_description as string | undefined) ?? "",
    tags: (target._tool_tags as string[] | undefined) ?? [],
    requiresApproval: Boolean(target._tool_requires_approval),
    timeoutSeconds: (target._tool_timeout_seconds as number | null | undefined) ?? null,
    execution: (target._tool_execution as ToolExecutionMode | undefined) ?? "server",
    parameters: (target._tool_parameters as Record<string, unknown> | undefined) ?? undefined,
  };
}

export function defineTool<F extends NexusToolHandler>(
  fn: F,
  options: ToolDecoratorOptions = {},
): F {
  const target = fn as NexusToolHandler & Record<string, unknown>;
  target[NEXUS_TOOL] = true;
  target._tool_name = options.name ?? fn.name;
  target._tool_description = options.description ?? "";
  target._tool_tags = options.tags ?? [];
  target._tool_requires_approval = options.requiresApproval ?? false;
  target._tool_timeout_seconds = options.timeoutSeconds ?? null;
  target._tool_execution = options.execution ?? "server";
  if (options.parameters) {
    target._tool_parameters = options.parameters;
  }
  return fn;
}

/** Method decorator compatible with experimentalDecorators. */
export function tool(options: ToolDecoratorOptions = {}) {
  return (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor => {
    const fn = descriptor.value as NexusToolHandler;
    defineTool(fn, {
      ...options,
      name: options.name ?? String(propertyKey),
    });
    descriptor.value = fn;
    return descriptor;
  };
}

export function isNexusPlugin(value: unknown): value is { new (...args: any[]): unknown } {
  if (typeof value !== "function") {
    return false;
  }
  return Boolean((value as unknown as Record<string, unknown>)[NEXUS_PLUGIN]);
}

export function getPluginName(plugin: { new (...args: any[]): unknown }): string {
  const cls = plugin as unknown as Record<string, unknown>;
  return String(cls._plugin_name ?? plugin.name.toLowerCase().replace(/plugin$/, ""));
}

export function defineToolPlugin(name: string) {
  return function <T extends { new (...args: any[]): any }>(cls: T): T {
    const target = cls as Record<string, unknown>;
    target[NEXUS_PLUGIN] = true;
    target._plugin_name = name;
    return cls;
  };
}

export function toolPlugin(nameOrOpts: string | { name: string }) {
  const name = typeof nameOrOpts === "string" ? nameOrOpts : nameOrOpts.name;
  return defineToolPlugin(name);
}

/** Backward-compatible aliases matching Python decorator names. */
export { defineTool as registerTool, defineToolPlugin as registerToolPlugin };

declare global {
  interface Function {
    _nexus_tool?: boolean;
    _tool_name?: string;
    _tool_description?: string;
    _tool_tags?: string[];
    _tool_requires_approval?: boolean;
    _tool_timeout_seconds?: number | null;
    _tool_execution?: ToolExecutionMode;
    _tool_parameters?: Record<string, unknown>;
  }
}

declare global {
  interface FunctionConstructor {
    _nexus_plugin?: boolean;
    _plugin_name?: string;
  }
}
