/** Tool registry to manage and execute tools. */

import type { RuntimeContextSummarizerConfig } from "../config/rcs.js";
import { ToolTimeoutError } from "../errors.js";
import { RunContext } from "./context.js";
import {
  defineTool,
  getPluginName,
  getToolMeta,
  isNexusPlugin,
  isNexusTool,
  type NexusToolHandler,
} from "./decorators.js";
import { RCSSchemaInjector } from "./schema-injector.js";
import {
  listFrontendToolsets,
  resolveToolsetTools,
  type Toolset,
  type ToolsetCatalog,
} from "./toolsets.js";

const RUN_CONTEXT_PARAM_NAMES = new Set(["ctx", "run_context"]);

export interface ToolMetadata {
  name: string;
  full_name: string;
  description: string;
  tags: string[];
  requires_approval: boolean;
  timeout_seconds: number | null;
  execution: "server" | "client";
  plugin: string;
  parameters?: Record<string, unknown>;
}

type ToolEntry = {
  func: NexusToolHandler;
  parent: unknown | null;
};

export class ToolRegistry {
  private readonly _tools = new Map<string, ToolEntry>();
  private readonly _toolMetadata = new Map<string, ToolMetadata>();
  private readonly _toolsets = new Map<string, Toolset>();

  registerPlugin(plugin: unknown): void {
    let pluginName: string | undefined;
    if (typeof plugin === "object" && plugin != null) {
      pluginName = (plugin as Record<string, unknown>)._plugin_name as string | undefined;
      if (!pluginName && plugin.constructor && isNexusPlugin(plugin.constructor)) {
        pluginName = getPluginName(plugin.constructor);
      }
    }
    if (!pluginName && typeof plugin === "object" && plugin != null) {
      let className = plugin.constructor?.name?.toLowerCase() ?? "plugin";
      if (className.endsWith("plugin")) {
        className = className.slice(0, -6);
      }
      pluginName = className;
    }
    pluginName ??= "plugin";

    const proto = Object.getPrototypeOf(plugin);
    const names = new Set<string>([
      ...Object.getOwnPropertyNames(plugin as object),
      ...Object.getOwnPropertyNames(proto),
    ]);

    for (const name of names) {
      if (name === "constructor") {
        continue;
      }
      const val = (plugin as Record<string, unknown>)[name];
      if (!isNexusTool(val)) {
        continue;
      }
      const meta = getToolMeta(val);
      const fullName = `${pluginName}.${meta.toolName}`;
      this._tools.set(fullName, { func: val, parent: plugin });
      this._toolMetadata.set(fullName, {
        name: meta.toolName,
        full_name: fullName,
        description: meta.description ?? "",
        tags: meta.tags ?? [],
        requires_approval: meta.requiresApproval ?? false,
        timeout_seconds: meta.timeoutSeconds ?? null,
        execution: meta.execution ?? "server",
        plugin: pluginName,
        parameters: meta.parameters,
      });
    }
  }

  private registerToolFlat(func: NexusToolHandler): string {
    if (!isNexusTool(func)) {
      throw new TypeError(`Expected a defineTool-decorated callable, got ${typeof func}`);
    }
    this.registerTool(func, null);
    return getToolMeta(func).toolName;
  }

  addTool(func: NexusToolHandler): string {
    return this.registerToolFlat(func);
  }

  registerTool(func: NexusToolHandler, pluginName: string | null = "global"): void {
    const meta = getToolMeta(func);
    const toolName = meta.toolName;
    const fullName = pluginName ? `${pluginName}.${toolName}` : toolName;

    this._tools.set(fullName, { func, parent: null });
    this._toolMetadata.set(fullName, {
      name: toolName,
      full_name: fullName,
      description: meta.description ?? "",
      tags: meta.tags ?? [],
      requires_approval: meta.requiresApproval ?? false,
      timeout_seconds: meta.timeoutSeconds ?? null,
      execution: meta.execution ?? "server",
      plugin: pluginName ?? "",
      parameters: meta.parameters,
    });
  }

  has(fullName: string): boolean {
    return this._tools.has(fullName);
  }

  toolNames(): string[] {
    return [...this._tools.keys()].sort();
  }

  getTool(fullName: string): [NexusToolHandler, unknown | null] {
    const entry = this._tools.get(fullName);
    if (!entry) {
      throw new Error(`Tool '${fullName}' not found in registry`);
    }
    return [entry.func, entry.parent];
  }

  count(): number {
    return this._tools.size;
  }

  private coerceToolsetToolNames(tools: Iterable<unknown>): string[] {
    const names: string[] = [];
    for (const item of tools) {
      if (typeof item === "string") {
        names.push(item);
      } else if (isNexusTool(item)) {
        names.push(this.registerToolFlat(item));
      } else {
        throw new TypeError(
          `Toolset tools must be registered tool name strings or defineTool callables, got ${typeof item}`,
        );
      }
    }
    return names;
  }

  addToolset(
    name: string,
    tools: Iterable<unknown> = [],
    options: {
      includes?: Iterable<string>;
      description?: string;
      visibility?: "hidden" | "frontend";
      default_enabled?: boolean;
    } = {},
  ): Toolset {
    const toolNames = this.coerceToolsetToolNames(tools);
    return this.defineToolset(name, toolNames, options);
  }

  defineToolset(
    name: string,
    tools: Iterable<string> = [],
    options: {
      includes?: Iterable<string>;
      description?: string;
      visibility?: "hidden" | "frontend";
      default_enabled?: boolean;
    } = {},
  ): Toolset {
    const toolList = [...tools];
    const includes = [...(options.includes ?? [])];

    const missingTools = toolList.filter((tool) => !this.has(tool));
    if (missingTools.length > 0) {
      throw new Error(
        `Toolset '${name}' references tools not in registry: ${missingTools.sort().join(", ")}`,
      );
    }
    const missingIncludes = includes.filter((child) => !this._toolsets.has(child));
    if (missingIncludes.length > 0) {
      throw new Error(
        `Toolset '${name}' includes undefined toolsets (define them first): ${missingIncludes.sort().join(", ")}`,
      );
    }

    const ts: Toolset = {
      name,
      description: options.description ?? "",
      visibility: options.visibility ?? "hidden",
      default_enabled: options.default_enabled ?? false,
      includes,
      tools: toolList,
    };
    this._toolsets.set(name, ts);
    return ts;
  }

  getToolset(name: string): Toolset {
    const ts = this._toolsets.get(name);
    if (!ts) {
      throw new Error(`Toolset '${name}' not found in registry`);
    }
    return ts;
  }

  hasToolset(name: string): boolean {
    return this._toolsets.has(name);
  }

  listToolsets(): Toolset[] {
    return [...this._toolsets.values()];
  }

  listFrontendToolsets(toolDescriptions?: Record<string, string>): ToolsetCatalog[] {
    const map = Object.fromEntries(this._toolsets.entries());
    return listFrontendToolsets(map, toolDescriptions ?? {});
  }

  resolveToolset(nameOrNames: string | Iterable<string> | null | undefined): Set<string> | null {
    if (nameOrNames == null) {
      return null;
    }
    const names = typeof nameOrNames === "string" ? [nameOrNames] : [...nameOrNames];
    const map = Object.fromEntries(this._toolsets.entries());
    const out = new Set<string>();
    for (const name of names) {
      for (const toolName of resolveToolsetTools(name, map)) {
        out.add(toolName);
      }
    }
    return out;
  }

  schemasFor(names: Iterable<string>): Array<Record<string, unknown>> {
    const byName = new Map(this.getToolSchemasForLlm().map((schema) => [schema.name, schema]));
    const out: Array<Record<string, unknown>> = [];
    for (const name of names) {
      const schema = byName.get(name);
      if (schema) {
        out.push(schema);
      }
    }
    return out;
  }

  private isRunContextParam(paramName: string): boolean {
    return RUN_CONTEXT_PARAM_NAMES.has(paramName);
  }

  private getFunctionSchema(func: NexusToolHandler, metadata: ToolMetadata): Record<string, unknown> {
    if (metadata.parameters) {
      return metadata.parameters;
    }
    return { type: "object", properties: {}, required: [] };
  }

  getToolSchemasForLlm(
    pluginNames?: string[] | null,
    rcsConfig?: RuntimeContextSummarizerConfig | null,
  ): Array<Record<string, unknown>> {
    const schemas: Array<Record<string, unknown>> = [];
    for (const [fullName, entry] of this._tools.entries()) {
      const metadata = this._toolMetadata.get(fullName);
      if (!metadata) {
        continue;
      }
      if (
        pluginNames &&
        metadata.plugin &&
        !pluginNames.includes(metadata.plugin)
      ) {
        continue;
      }

      let paramsSchema = this.getFunctionSchema(entry.func, metadata);
      if (rcsConfig?.enabled) {
        paramsSchema = RCSSchemaInjector.inject(paramsSchema, rcsConfig);
      }

      schemas.push({
        name: fullName,
        description: metadata.description,
        parameters: paramsSchema,
      });
    }
    return schemas;
  }

  getExecutionMode(fullName: string): "server" | "client" {
    return this.getToolMetadata(fullName).execution ?? "server";
  }

  resolveToolName(name: string): string {
    if (this.has(name)) {
      return name;
    }
    for (const prefix of ["tenant.", "admin."]) {
      if (name.startsWith(prefix)) {
        const bare = name.slice(prefix.length);
        if (this.has(bare)) {
          return bare;
        }
      }
    }
    if (!name.includes(".")) {
      for (const qualified of [`tenant.${name}`, `admin.${name}`]) {
        if (this.has(qualified)) {
          return qualified;
        }
      }
    }
    throw new Error(`Tool '${name}' not found in registry`);
  }

  async executeTool(
    name: string,
    args: Record<string, unknown>,
    runContext: RunContext,
  ): Promise<unknown> {
    const fullName = this.resolveToolName(name);
    if (this._tools.has(fullName)) {
      const dot = fullName.indexOf(".");
      if (dot >= 0) {
        return this.execute(fullName.slice(0, dot), fullName.slice(dot + 1), args, runContext);
      }
      return this.execute(fullName, "", args, runContext);
    }
    const [plugin, tool] = fullName.split(".", 2);
    return this.execute(plugin, tool, args, runContext);
  }

  getToolMetadata(fullName: string): ToolMetadata {
    return { ...(this._toolMetadata.get(fullName) ?? ({} as ToolMetadata)) };
  }

  requiresApproval(fullName: string): boolean {
    return Boolean(this.getToolMetadata(fullName).requires_approval);
  }

  getTimeoutSeconds(fullName: string): number | null {
    const declared = this.getToolMetadata(fullName).timeout_seconds;
    return declared != null ? Number(declared) : null;
  }

  async execute(
    plugin: string,
    tool: string,
    args: Record<string, unknown>,
    runContext: RunContext,
  ): Promise<unknown> {
    let fullName = `${plugin}.${tool}`;
    if (!this._tools.has(fullName)) {
      if (tool === "" && this._tools.has(plugin)) {
        fullName = plugin;
      } else {
        throw new Error(`Tool '${fullName}' not found in registry`);
      }
    }

    const entry = this._tools.get(fullName)!;
    const func = entry.func;

    const timeout = this.getTimeoutSeconds(fullName);

    const paramNames = this.getCallableParamNames(func).filter((name) => name !== "self");
    const positional: unknown[] = [];
    for (const paramName of paramNames) {
      if (this.isRunContextParam(paramName)) {
        positional.push(runContext);
      } else if (
        paramName === "kwargs" ||
        paramName === "args" ||
        paramName === "arguments"
      ) {
        positional.push(args);
      } else if (paramName in args) {
        positional.push(args[paramName]);
      }
    }

    const run = async (): Promise<unknown> => {
      const result = func.apply(entry.parent, positional);
      return result instanceof Promise ? await result : result;
    };

    try {
      if (timeout != null && timeout > 0) {
        return await withTimeout(run(), timeout * 1000, fullName);
      }
      return await run();
    } catch (error) {
      if (error instanceof ToolTimeoutError) {
        throw error;
      }
      console.error(`Error executing tool ${fullName}:`, error);
      throw error;
    }
  }

  private getCallableParamNames(func: NexusToolHandler): string[] {
    const src = func.toString();
    const match = src.match(/^(?:async\s*)?(?:function\s*)?\(?([^)=]*)\)?/);
    if (!match?.[1]) {
      return [];
    }
    return match[1]
      .split(",")
      .map((part) => part.trim().split(/[\s=:]/)[0])
      .filter((name) => name.length > 0);
  }

  private buildOrderedArgs(
    func: NexusToolHandler,
    callArgs: Record<string, unknown>,
  ): unknown[] {
    return this.getCallableParamNames(func)
      .filter((name) => name !== "self")
      .map((name) => callArgs[name]);
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  toolName: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new ToolTimeoutError(`Tool '${toolName}' timed out after ${ms / 1000}s`, {
              toolName,
            }),
          );
        }, ms);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export { defineTool };
