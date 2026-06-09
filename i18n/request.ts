import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, isSupportedLocale, type LocaleCode } from "@/lib/locales";

// Non-routing i18n. Per the RootsTalk Localisation Strategy (§4.1, §9.2)
// the locale is per-user, stored in `users.language_code` server-side and
// in localStorage + a cookie client-side. We resolve it here from the
// `rt_pwa_lang` cookie so server components can render in the right
// language without a [locale] URL segment.
//
// Fallback chain: cookie → DEFAULT_LOCALE (en). The strategy explicitly
// forbids inferring from the browser's `Accept-Language` header.

async function loadMessages(locale: LocaleCode): Promise<Record<string, unknown>> {
  return (await import(`../messages/${locale}.json`)).default as Record<string, unknown>;
}

// Shallow-merge English under the active locale so missing keys fall
// back cleanly. Per the strategy doc §5.2 we never enable a language
// until its file is fully translated, but during development we want
// English-fallback rather than the "MISSING_MESSAGE" warning.
function mergeMessages(
  fallback: Record<string, unknown>,
  active: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...fallback };
  for (const [key, value] of Object.entries(active)) {
    const fb = fallback[key];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      fb &&
      typeof fb === "object" &&
      !Array.isArray(fb)
    ) {
      out[key] = mergeMessages(
        fb as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      out[key] = value;
    }
  }
  return out;
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const raw = cookieStore.get("rt_pwa_lang")?.value;
  const locale: LocaleCode = isSupportedLocale(raw) ? raw : DEFAULT_LOCALE;

  const enMessages = await loadMessages(DEFAULT_LOCALE);
  let messages = enMessages;
  if (locale !== DEFAULT_LOCALE) {
    try {
      const localeMessages = await loadMessages(locale);
      messages = mergeMessages(enMessages, localeMessages);
    } catch {
      // Locale file doesn't exist yet — serve English. Will only happen
      // before per-language rollout in Phase D.
    }
  }

  return { locale, messages };
});
