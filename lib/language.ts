// Language preference — stored separately from the user profile for
// instant access before auth completes. Persistence is three-layered:
//   1. localStorage — client-side reads (synchronous, no network).
//   2. Cookie       — server-side reads via i18n/request.ts.
//   3. users.language_code via PUT /auth/me/profile — durable across devices.
//
// The cookie + localStorage are written immediately on language change;
// the backend PATCH is fire-and-forget when the user is authenticated.

import api from "./api";
import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  isRTL as isRTLLocale,
  type LocaleCode,
} from "./locales";

const STORAGE_KEY = "rt_pwa_lang";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year

export function getLanguage(): LocaleCode {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  const stored = localStorage.getItem(STORAGE_KEY);
  return isSupportedLocale(stored) ? stored : DEFAULT_LOCALE;
}

export function setLanguage(code: string): void {
  if (typeof window === "undefined") return;
  const safe: LocaleCode = isSupportedLocale(code) ? code : DEFAULT_LOCALE;
  localStorage.setItem(STORAGE_KEY, safe);
  document.cookie = `${STORAGE_KEY}=${safe}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}

// Atomic language change — writes local state immediately so the UI can
// re-render, then best-effort syncs to the backend so the choice survives
// device changes. Failure on the backend persist is intentionally
// silent: the client state is authoritative for UX continuity.
export async function changeLanguage(code: string): Promise<void> {
  setLanguage(code);
  if (typeof window === "undefined") return;
  if (!localStorage.getItem("rt_pwa_token")) return;
  try {
    await api.put("/auth/me/profile", { language_code: code });
  } catch {
    // Backend persistence is best-effort. Client state already updated.
  }
}

// Direction for RTL support (Urdu only — see Localisation Strategy §6).
export function isRTL(code: string): boolean {
  return isRTLLocale(code);
}
