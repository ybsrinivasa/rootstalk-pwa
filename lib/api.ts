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
    if (error.response?.status === 401 && typeof window !== "undefined") {
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
