// Single source of truth for supported locales. Mirror of the
// 13 languages in §1 of the Localisation Strategy. Used by both
// the i18n request config (server) and the language picker (client).

export const SUPPORTED_LOCALES = [
  "en", // English
  "hi", // Hindi
  "ta", // Tamil
  "te", // Telugu
  "kn", // Kannada
  "ml", // Malayalam
  "mr", // Marathi
  "gu", // Gujarati
  "pa", // Punjabi
  "or", // Odia
  "bn", // Bengali
  "as", // Assamese
  "ur", // Urdu — only RTL language
] as const;

export type LocaleCode = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: LocaleCode = "en";

export const RTL_LOCALES: ReadonlySet<LocaleCode> = new Set(["ur"]);

export function isSupportedLocale(value: string | undefined | null): value is LocaleCode {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function isRTL(code: LocaleCode | string | undefined | null): boolean {
  return typeof code === "string" && (RTL_LOCALES as ReadonlySet<string>).has(code);
}

// Native-script display name per the strategy doc §1 rule: each
// language is shown in its own script in the picker so a farmer
// who doesn't read English can still recognise their language.
// English is the only exception — always shown in Latin.
export const LOCALE_NATIVE_NAMES: Record<LocaleCode, string> = {
  en: "English",
  hi: "हिन्दी",
  ta: "தமிழ்",
  te: "తెలుగు",
  kn: "ಕನ್ನಡ",
  ml: "മലയാളം",
  mr: "मराठी",
  gu: "ગુજરાતી",
  pa: "ਪੰਜਾਬੀ",
  or: "ଓଡ଼ିଆ",
  bn: "বাংলা",
  as: "অসমীয়া",
  ur: "اردو",
};
