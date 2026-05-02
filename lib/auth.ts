import api from "./api";

export interface PWAUser {
  id: string;
  phone: string | null;
  name: string | null;
  language_code: string;
  roles: { role_type: string; status: string }[];
}

export async function requestOtp(phone: string): Promise<{ dev_otp?: string }> {
  const { data } = await api.post("/auth/request-otp", { phone });
  return data;
}

export async function verifyOtp(phone: string, otp_code: string): Promise<void> {
  const { data } = await api.post("/auth/verify-otp", { phone, otp_code });
  localStorage.setItem("rt_pwa_token", data.access_token);
  // Fetch user profile separately — if this fails, the token is still stored
  // and the user IS logged in. Don't let a /me failure consume the OTP silently.
  try {
    const me = await api.get<PWAUser>("/auth/me");
    localStorage.setItem("rt_pwa_user", JSON.stringify(me.data));
  } catch {
    // Token stored; user data will reload on next visit
  }
}

export function logout(): void {
  localStorage.removeItem("rt_pwa_token");
  localStorage.removeItem("rt_pwa_user");
  window.location.href = "/";
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("rt_pwa_token");
}

export function getUser(): PWAUser | null {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(localStorage.getItem("rt_pwa_user") || ""); }
  catch { return null; }
}

export function getActiveRoles(user: PWAUser | null): string[] {
  if (!user) return [];
  return user.roles.filter(r => r.status === "ACTIVE").map(r => r.role_type);
}

export function hasRole(user: PWAUser | null, role: string): boolean {
  return getActiveRoles(user).includes(role);
}

// Role colour system from design documents
export const ROLE_COLOURS: Record<string, string> = {
  FARMER:       "#1A5C2A",
  DEALER:       "#085041",
  FACILITATOR:  "#7D4E00",
  FARM_PUNDIT:  "#3C3489",
};

export const ROLE_LABELS: Record<string, string> = {
  FARMER:       "Farmer",
  DEALER:       "Dealer",
  FACILITATOR:  "Facilitator",
  FARM_PUNDIT:  "FarmPundit",
};
