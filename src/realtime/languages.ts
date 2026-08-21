/** Indian-language routing for realtime voice agents. */

export interface Language {
  code: string;
  name: string;
  tts_description: string;
}

function desc(speaker: string): string {
  return (
    `${speaker} speaks in a clear, natural and expressive voice at a moderate ` +
    `pace, in a very quiet environment with high audio quality.`
  );
}

export const LANGUAGES: Record<string, Language> = {
  hi: { code: "hi", name: "Hindi", tts_description: desc("Divya") },
  en: { code: "en", name: "English", tts_description: desc("Divya") },
  ta: { code: "ta", name: "Tamil", tts_description: desc("Jaya") },
  te: { code: "te", name: "Telugu", tts_description: desc("Prakash") },
  bn: { code: "bn", name: "Bengali", tts_description: desc("Aditi") },
  mr: { code: "mr", name: "Marathi", tts_description: desc("Sanjay") },
  gu: { code: "gu", name: "Gujarati", tts_description: desc("Neha") },
};

export const DEFAULT_LANGUAGE = "hi";

export const LANG_NAME_ALIASES: Record<string, readonly string[]> = {
  hi: ["hindi", "हिंदी", "हिन्दी"],
  en: ["english", "इंग्लिश", "अंग्रेज़ी", "अंग्रेजी", "angrezi"],
  gu: ["gujarati", "gujrati", "ગુજરાતી", "गुजराती", "gujju"],
  ta: ["tamil", "தமிழ்", "तमिल", "தமிழ"],
  te: ["telugu", "తెలుగు", "तेलुगु", "तेलुगू"],
  bn: ["bengali", "bangla", "বাংলা", "बंगाली", "बांग्ला"],
  mr: ["marathi", "मराठी", "मराठि"],
};

const SWITCH_INTENT_TOKENS = [
  "talk",
  "speak",
  "reply",
  "answer",
  "say",
  "language",
  "switch",
  "change",
  "बात",
  "बोल",
  "बोलो",
  "जवाब",
  "भाषा",
  "बदल",
  "बताओ",
  "करो",
] as const;

export function resolve(code?: string | null): Language {
  if (!code) return LANGUAGES[DEFAULT_LANGUAGE]!;
  return LANGUAGES[code.toLowerCase().split("-")[0]!] ?? LANGUAGES[DEFAULT_LANGUAGE]!;
}

export function ttsVoiceFor(code?: string | null, defaultVoice?: string | null): string {
  if (defaultVoice && !code) return defaultVoice;
  return resolve(code).tts_description;
}

export function detectLanguageRequest(
  text?: string | null,
  options: { allowed?: ReadonlySet<string> | null } = {},
): string | null {
  if (!text) return null;
  const lowered = text.toLowerCase();
  const hasIntent = SWITCH_INTENT_TOKENS.some((tok) => lowered.includes(tok));
  if (!hasIntent) return null;
  for (const [code, aliases] of Object.entries(LANG_NAME_ALIASES)) {
    if (options.allowed != null && !options.allowed.has(code)) continue;
    if (aliases.some((alias) => lowered.includes(alias))) return code;
  }
  return null;
}
