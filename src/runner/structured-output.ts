import type { z } from "zod";
import { ValidationError } from "../errors.js";

export type StructuredResultSchema = z.ZodTypeAny;

export function validateStructuredResult(
  content: string | null | undefined,
  resultType: StructuredResultSchema,
): Record<string, unknown> {
  if (!content?.trim()) {
    throw new ValidationError("Structured output expected but assistant returned empty content");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (error) {
    throw new ValidationError(`Structured output is not valid JSON: ${String(error)}`, error);
  }
  const parsed = resultType.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(`Structured output validation failed: ${parsed.error.message}`, parsed.error);
  }
  if (typeof parsed.data !== "object" || parsed.data === null || Array.isArray(parsed.data)) {
    throw new ValidationError("Structured output must be a JSON object");
  }
  return parsed.data as Record<string, unknown>;
}

export function formatValidationRetryMessage(error: ValidationError): string {
  return (
    "Your previous response did not match the required output schema. " +
    `Validation error: ${error.message}. ` +
    "Respond again with valid JSON matching the schema."
  );
}
