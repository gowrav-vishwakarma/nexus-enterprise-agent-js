/** Startup validation for voice agent language configuration (client-side). */

import type { RealtimeAgentConfig } from "./config.js";
import { effectiveInitialResponse, effectiveLanguages, effectiveLid, effectiveStt } from "./config.js";
import { LANGUAGES } from "./languages.js";

export type Severity = "error" | "warning";

export interface LanguageValidationIssue {
  severity: Severity;
  code: string;
  message: string;
}

function norm(code: string): string {
  return code.toLowerCase().split("-")[0]!;
}

function issue(severity: Severity, code: string, message: string): LanguageValidationIssue {
  return { severity, code, message };
}

export function validateVoiceLanguagesStatic(
  rtConfig: RealtimeAgentConfig,
): LanguageValidationIssue[] {
  const issues: LanguageValidationIssue[] = [];
  const langs = effectiveLanguages(rtConfig);
  const allowed = new Set(langs.allowed.map(norm));
  const defaultLang = norm(langs.default || effectiveStt(rtConfig).language || "hi");
  const stt = effectiveStt(rtConfig);
  const lid = effectiveLid(rtConfig);

  for (const code of allowed) {
    if (!(code in LANGUAGES)) {
      issues.push(issue("error", "unknown_language", `Unknown language code '${code}' in languages.allowed`));
    }
  }

  for (const [label, code] of [
    ["languages.default", defaultLang],
    ["stt.language", norm(stt.language)],
  ] as const) {
    if (!allowed.has(code)) {
      issues.push(
        issue("warning", "fallback_not_allowed", `${label}=${code} is not in languages.allowed`),
      );
    }
  }

  if (lid && !allowed.has(norm(lid.fallback_language))) {
    issues.push(
      issue(
        "warning",
        "lid_fallback_not_allowed",
        `lid.fallback_language=${lid.fallback_language} is not in languages.allowed`,
      ),
    );
  }

  if (allowed.has("en") && lid == null) {
    issues.push(
      issue(
        "warning",
        "en_requires_lid",
        "English in languages.allowed requires lid (or a Whisper STT instead of Indic-Conformer)",
      ),
    );
  }

  issues.push(...validateInitialResponse(rtConfig));
  return issues;
}

function validateInitialResponse(rtConfig: RealtimeAgentConfig): LanguageValidationIssue[] {
  const issues: LanguageValidationIssue[] = [];
  const ir = effectiveInitialResponse(rtConfig);
  if (ir.mode === "none") return issues;

  if (ir.mode === "proactive" && !ir.via_llm && !ir.text) {
    issues.push(
      issue(
        "error",
        "initial_response_missing_text",
        "initial_response mode proactive with via_llm: false requires text",
      ),
    );
  }

  if (ir.mode === "ivr") {
    if (rtConfig.duplex !== "half") {
      issues.push(
        issue(
          "warning",
          "initial_response_ivr_not_half_duplex",
          "initial_response mode ivr works best with duplex: half",
        ),
      );
    }
    if (ir.via_llm && !rtConfig.agent.tool_plugins.includes("ivr_menu")) {
      issues.push(
        issue(
          "warning",
          "initial_response_ivr_no_plugin",
          "initial_response mode ivr with via_llm: true requires ivr_menu tool plugin",
        ),
      );
    }
    if (!ir.via_llm && !ir.ivr_script?.length && !ir.text) {
      issues.push(
        issue(
          "error",
          "initial_response_missing_script",
          "initial_response mode ivr with via_llm: false requires ivr_script or text",
        ),
      );
    }
  }

  return issues;
}

function strictEnabled(strict?: boolean | null): boolean {
  if (strict != null) return strict;
  const raw = (process.env.NEXUS_VOICE_STRICT_LANG ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function logValidationIssues(
  issues: LanguageValidationIssue[],
  options: { rtConfig?: RealtimeAgentConfig | null; strict?: boolean | null } = {},
): void {
  const errors = issues.filter((i) => i.severity === "error");
  for (const issueItem of issues) {
    if (issueItem.severity === "error") {
      console.error(issueItem.message);
    } else if (issueItem.code === "en_lid_ok") {
      console.info(issueItem.message);
    } else {
      console.warn(issueItem.message);
    }
  }

  if (strictEnabled(options.strict) && errors.length) {
    throw new Error(`Voice language validation failed: ${errors.map((e) => e.message).join("; ")}`);
  }
}

export async function validateVoiceLanguages(
  rtConfig: RealtimeAgentConfig,
): Promise<LanguageValidationIssue[]> {
  return validateVoiceLanguagesStatic(rtConfig);
}

export async function runStartupLanguageValidation(
  rtConfig: RealtimeAgentConfig,
  options: { strict?: boolean | null } = {},
): Promise<LanguageValidationIssue[]> {
  const issues = await validateVoiceLanguages(rtConfig);
  logValidationIssues(issues, { rtConfig, strict: options.strict });
  return issues;
}
