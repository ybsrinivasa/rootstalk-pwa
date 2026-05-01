// Language preference — stored separately from the user profile
// for instant access before auth completes

export function getLanguage(): string {
  if (typeof window === "undefined") return "en";
  return localStorage.getItem("rt_pwa_lang") || "en";
}

export function setLanguage(code: string): void {
  localStorage.setItem("rt_pwa_lang", code);
}

// Direction for RTL support (Urdu only)
export function isRTL(code: string): boolean {
  return code === "ur";
}
