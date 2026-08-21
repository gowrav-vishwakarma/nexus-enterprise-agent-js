/** Error taxonomy for Nexus agent framework. */

export enum ErrorCode {
  LLM_RATE_LIMIT = "llm_rate_limit",
  LLM_AUTH = "llm_auth",
  LLM_CONTEXT_LENGTH = "llm_context_length",
  LLM_PROVIDER = "llm_provider",
  LLM_TIMEOUT = "llm_timeout",
  TOOL_NOT_FOUND = "tool_not_found",
  TOOL_EXECUTION = "tool_execution",
  TOOL_TIMEOUT = "tool_timeout",
  TOOL_APPROVAL_REQUIRED = "tool_approval_required",
  GUARDRAIL_BLOCKED = "guardrail_blocked",
  BUDGET_EXCEEDED = "budget_exceeded",
  RATE_LIMIT_EXCEEDED = "rate_limit_exceeded",
  TURN_TIMEOUT = "turn_timeout",
  VALIDATION = "validation",
}

export class NexusError extends Error {
  readonly code: ErrorCode | string;
  readonly cause?: unknown;

  constructor(
    message: string,
    code: ErrorCode | string = ErrorCode.LLM_PROVIDER,
    cause?: unknown,
  ) {
    super(message);
    this.name = "NexusError";
    this.code = code;
    this.cause = cause;
  }
}

export class LLMError extends NexusError {
  constructor(message: string, cause?: unknown) {
    super(message, ErrorCode.LLM_PROVIDER, cause);
    this.name = "LLMError";
  }
}

export class LLMRateLimitError extends LLMError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "LLMRateLimitError";
    (this as { code: ErrorCode }).code = ErrorCode.LLM_RATE_LIMIT;
  }
}

export class LLMAuthError extends LLMError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "LLMAuthError";
    (this as { code: ErrorCode }).code = ErrorCode.LLM_AUTH;
  }
}

export class LLMContextLengthError extends LLMError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "LLMContextLengthError";
    (this as { code: ErrorCode }).code = ErrorCode.LLM_CONTEXT_LENGTH;
  }
}

export class LLMTimeoutError extends LLMError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "LLMTimeoutError";
    (this as { code: ErrorCode }).code = ErrorCode.LLM_TIMEOUT;
  }
}

export class ToolError extends NexusError {
  readonly toolName: string;

  constructor(
    message: string,
    options: { toolName?: string; cause?: unknown; code?: ErrorCode | string } = {},
  ) {
    super(message, options.code ?? ErrorCode.TOOL_EXECUTION, options.cause);
    this.name = "ToolError";
    this.toolName = options.toolName ?? "";
  }
}

export class ToolTimeoutError extends ToolError {
  constructor(message: string, options: { toolName?: string; cause?: unknown } = {}) {
    super(message, { ...options, code: ErrorCode.TOOL_TIMEOUT });
    this.name = "ToolTimeoutError";
  }
}

export class ToolApprovalRequiredError extends ToolError {
  constructor(message: string, options: { toolName?: string; cause?: unknown } = {}) {
    super(message, { ...options, code: ErrorCode.TOOL_APPROVAL_REQUIRED });
    this.name = "ToolApprovalRequiredError";
  }
}

export class GuardrailError extends NexusError {
  constructor(message: string, cause?: unknown) {
    super(message, ErrorCode.GUARDRAIL_BLOCKED, cause);
    this.name = "GuardrailError";
  }
}

export class BudgetExceededError extends NexusError {
  constructor(message: string, cause?: unknown) {
    super(message, ErrorCode.BUDGET_EXCEEDED, cause);
    this.name = "BudgetExceededError";
  }
}

export class RateLimitExceededError extends NexusError {
  constructor(message: string, cause?: unknown) {
    super(message, ErrorCode.RATE_LIMIT_EXCEEDED, cause);
    this.name = "RateLimitExceededError";
  }
}

export class ValidationError extends NexusError {
  constructor(message: string, cause?: unknown) {
    super(message, ErrorCode.VALIDATION, cause);
    this.name = "ValidationError";
  }
}

export class TurnTimeoutError extends NexusError {
  constructor(message: string, cause?: unknown) {
    super(message, ErrorCode.TURN_TIMEOUT, cause);
    this.name = "TurnTimeoutError";
  }
}

/** Map a provider (LiteLLM / OpenAI-compatible) error to a typed LLMError. */
export function classifyProviderError(exc: unknown): LLMError {
  const msg = String(exc instanceof Error ? exc.message : exc).toLowerCase();
  const excType = exc instanceof Error ? exc.constructor.name.toLowerCase() : "";

  if (msg.includes("rate") || msg.includes("429") || excType.includes("ratelimit")) {
    return new LLMRateLimitError(String(exc instanceof Error ? exc.message : exc), exc);
  }
  if (
    msg.includes("auth") ||
    msg.includes("401") ||
    msg.includes("403") ||
    msg.includes("api key")
  ) {
    return new LLMAuthError(String(exc instanceof Error ? exc.message : exc), exc);
  }
  if (
    msg.includes("context") ||
    (msg.includes("token") && msg.includes("limit")) ||
    msg.includes("too long")
  ) {
    return new LLMContextLengthError(String(exc instanceof Error ? exc.message : exc), exc);
  }
  if (msg.includes("timeout") || msg.includes("timed out")) {
    return new LLMTimeoutError(String(exc instanceof Error ? exc.message : exc), exc);
  }
  return new LLMError(String(exc instanceof Error ? exc.message : exc), exc);
}

/** Backward-compatible alias for older imports. */
export const classifyLitellmError = classifyProviderError;
