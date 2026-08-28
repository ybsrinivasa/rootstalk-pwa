import axios from "axios";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001",
});

api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("rt_pwa_token");
    if (token) config.headers.Authorization = `Bearer ${token}`;
    // Per Localisation Strategy §4.2: every authenticated request
    // carries the user's preferred language. Backend resolves Cosh
    // + expert-authored translations against this header.
    const lang = localStorage.getItem("rt_pwa_lang") || "en";
    config.headers["Accept-Language"] = lang;
  }
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (error) => {
    // 401 on an authenticated request means the session ended (token
    // expired, revoked, or logged in on another device) — clear
    // credentials + hard-redirect so the user sees the login screen.
    //
    // 401 on the OTP endpoints (`/auth/request-otp`, `/auth/verify-otp`)
    // is different — those are UNAUTHENTICATED endpoints where 401
    // means "wrong phone / wrong OTP", NOT session-expired. The
    // caller shows an inline error and lets the user retry in place.
    // Without this exclusion, a farmer who mistyped one OTP digit
    // was silently kicked out to landing, and (post install-gate) got
    // stuck at the "Add to Home Screen first" screen even though
    // they'd already installed. Anchor 2026-08-28.
    const url = error.config?.url || "";
    const isUnauthedAuthEndpoint =
      url.includes("/auth/request-otp") || url.includes("/auth/verify-otp");
    if (
      error.response?.status === 401 &&
      !isUnauthedAuthEndpoint &&
      typeof window !== "undefined"
    ) {
      const detail = error.response?.data?.detail || "";
      const isSessionEnded = detail.includes("another device");
      sessionStorage.setItem(
        "rt_pwa_session_ended",
        isSessionEnded ? "another_device" : "expired"
      );
      localStorage.removeItem("rt_pwa_token");
      localStorage.removeItem("rt_pwa_user");
      window.location.href = "/";
    }
    return Promise.reject(error);
  }
);

export default api;
