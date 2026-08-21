/** Session storage configuration models. */

import { z } from "zod";
import { getDataRoot } from "../storage/paths.js";

export const storageAdapterTypeSchema = z.enum([
  "memory",
  "file",
  "sqlite",
  "postgresql",
  "redis",
  "custom",
]);

export type StorageAdapterType = z.infer<typeof storageAdapterTypeSchema>;

export const schemaModeSchema = z.enum(["managed", "existing", "qualified"]);
export type SchemaMode = z.infer<typeof schemaModeSchema>;

export const sessionStorageConfigSchema = z.object({
  adapter: storageAdapterTypeSchema.default("memory"),
  adapter_config: z.record(z.unknown()).default({}),
  custom_adapter_class: z.string().nullable().optional(),
  custom_memory_adapter_class: z.string().nullable().optional(),
  codec_class: z.string().nullable().optional(),
});

export type SessionStorageConfig = z.infer<typeof sessionStorageConfigSchema>;

export const memoryStorageConfigSchema = z.object({
  max_sessions: z.number().int().min(1).default(10000),
  ttl_seconds: z.number().int().nullable().optional(),
});

export type MemoryStorageConfig = z.infer<typeof memoryStorageConfigSchema>;

export function memoryStorageConfigToAdapterConfig(
  config: MemoryStorageConfig,
): Record<string, unknown> {
  return {
    max_sessions: config.max_sessions,
    ttl_seconds: config.ttl_seconds ?? null,
  };
}

export const fileStorageConfigSchema = z.object({
  data_root: z.string().default(() => getDataRoot()),
  tenant_scoped: z.boolean().default(true),
  base_path: z.string().default("./nexus_sessions"),
  filename_template: z.string().default("{session_id}.json"),
  overwrite_mode: z.enum(["full_rewrite", "append_jsonl"]).default("full_rewrite"),
  pretty_print: z.boolean().default(false),
  compression: z.enum(["gzip"]).nullable().optional(),
});

export type FileStorageConfig = z.infer<typeof fileStorageConfigSchema>;

export function fileStorageConfigToAdapterConfig(
  config: FileStorageConfig,
): Record<string, unknown> {
  return {
    data_root: config.data_root,
    tenant_scoped: config.tenant_scoped,
    base_path: config.base_path,
    filename_template: config.filename_template,
    overwrite_mode: config.overwrite_mode,
    pretty_print: config.pretty_print,
  };
}

export const sqliteStorageConfigSchema = z.object({
  data_root: z.string().default(() => getDataRoot()),
  tenant_scoped: z.boolean().default(true),
  db_path: z.string().nullable().optional(),
  table_prefix: z.string().default("nexus_"),
  wal_mode: z.boolean().default(true),
  auto_migrate: z.boolean().default(true),
});

export type SQLiteStorageConfig = z.infer<typeof sqliteStorageConfigSchema>;

export function sqliteStorageConfigToAdapterConfig(
  config: SQLiteStorageConfig,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    data_root: config.data_root,
    tenant_scoped: config.tenant_scoped,
    table_prefix: config.table_prefix,
    wal_mode: config.wal_mode,
    auto_migrate: config.auto_migrate,
  };
  if (config.db_path != null) {
    out.db_path = config.db_path;
  }
  return out;
}

export const postgreSQLStorageConfigSchema = z.object({
  dsn: z.string(),
  pool_size: z.number().int().min(1).default(10),
  max_overflow: z.number().int().min(0).default(20),
  schema: z.string().nullable().optional(),
  schema_mode: schemaModeSchema.default("managed"),
  sessions_table: z.string().nullable().optional(),
  user_memory_table: z.string().nullable().optional(),
  table_prefix: z.string().default("nexus_"),
  auto_migrate: z.boolean().default(false),
  connect_args: z.record(z.unknown()).default({}),
});

export type PostgreSQLStorageConfig = z.infer<typeof postgreSQLStorageConfigSchema>;

export function postgreSQLStorageConfigToAdapterConfig(
  config: PostgreSQLStorageConfig,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    dsn: config.dsn,
    pool_size: config.pool_size,
    max_overflow: config.max_overflow,
    schema_mode: config.schema_mode,
    table_prefix: config.table_prefix,
    auto_migrate: config.auto_migrate,
    connect_args: config.connect_args,
  };
  if (config.schema != null) {
    out.schema = config.schema;
  }
  if (config.sessions_table != null) {
    out.sessions_table = config.sessions_table;
  }
  if (config.user_memory_table != null) {
    out.user_memory_table = config.user_memory_table;
  }
  return out;
}

export const redisStorageConfigSchema = z.object({
  url: z.string().nullable().optional(),
  host: z.string().default("localhost"),
  port: z.number().int().min(1).default(6379),
  db: z.number().int().min(0).default(0),
  password: z.string().nullable().optional(),
  key_prefix: z.string().default("nexus:"),
  session_key_template: z.string().nullable().optional(),
  index_key_template: z.string().nullable().optional(),
  memory_key_template: z.string().nullable().optional(),
  ttl_seconds: z.number().int().nullable().optional(),
  max_connections: z.number().int().min(1).default(50),
});

export type RedisStorageConfig = z.infer<typeof redisStorageConfigSchema>;

export function redisStorageConfigToAdapterConfig(
  config: RedisStorageConfig,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    host: config.host,
    port: config.port,
    db: config.db,
    key_prefix: config.key_prefix,
    ttl_seconds: config.ttl_seconds ?? null,
    max_connections: config.max_connections,
  };
  if (config.url) {
    out.url = config.url;
  }
  if (config.password != null) {
    out.password = config.password;
  }
  if (config.session_key_template) {
    out.session_key_template = config.session_key_template;
  }
  if (config.index_key_template) {
    out.index_key_template = config.index_key_template;
  }
  if (config.memory_key_template) {
    out.memory_key_template = config.memory_key_template;
  }
  return out;
}

export function parseSessionStorageConfig(input: unknown): SessionStorageConfig {
  return sessionStorageConfigSchema.parse(input);
}
