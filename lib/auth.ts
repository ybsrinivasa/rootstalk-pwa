import api from "./api";

export interface PWAUser {
  id: string;
  phone: string | null;
  name: string | null;
  language_code: string;
  roles: { role_type: string; status: string }[];
  portal_role?: string | null;
  pwa_roles?: string[];
  // 2026-05-20 — surfaced on /auth/me so Profile + farmer-context
  // screens can read location/GPS without a second hop. All
  // optional; fresh accounts won't have them populated yet.
  state_cosh_id?: string | null;
  district_cosh_id?: string | null;
  sub_district_cosh_id?: string | null;
  gps_lat?: number | null;
  gps_lng?: number | null;
  photo_url?: string | null;
  // 2026-05-21 — drives the /facilitator/home gate. Non-null
  // means the user confirmed the declaration on
  // /facilitator/profile. Self-claiming the FACILITATOR role
  // alone doesn't unlock /facilitator/home.
  facilitator_declared_at?: string | null;
  // 2026-05-21 — drives the /dealer/home gate AND the right
  // drawer's "Set up →" vs "Switch to" label for the DEALER
  // row. False until every required shop field is filled.
  dealer_profile_complete?: boolean;
  // 2026-06-24 — Server-driven Razorpay amounts so the PWA can render
  // ₹{price} templates from the catalog instead of hardcoding "Rs. 199".
  // Defaults match production (₹199 / ₹20) on legacy payloads.
  subscription_amount_inr?: number;
  query_amount_inr?: number;
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

/** Re-fetch /auth/me and overwrite the cached user. Used after a
 * client-side action changes the user's state (e.g. claiming a
 * Dealer or Facilitator role) so the role-driven nav and gates
 * pick it up without a full reload. */
export async function refreshUser(): Promise<PWAUser | null> {
  try {
    const { data } = await api.get<PWAUser>("/auth/me");
    localStorage.setItem("rt_pwa_user", JSON.stringify(data));
    return data;
  } catch {
    return null;
  }
}

export function getActiveRoles(user: PWAUser | null): string[] {
  if (!user) return [];
  const neytiriRoles = user.roles.filter(r => r.status === "ACTIVE").map(r => r.role_type);
  const pwaRoles = user.pwa_roles || [];
  return [...neytiriRoles, ...pwaRoles];
}

export function hasRole(user: PWAUser | null, role: string): boolean {
  return getActiveRoles(user).includes(role);
}

// Role colour system from design documents
export const ROLE_COLOURS: Record<string, string> = {
  FARMER:       "#1A5C2A",
  DEALER:       "#7D4196",
  FACILITATOR:  "#7D4E00",
  FARM_PUNDIT:  "#3C3489",
};

export const ROLE_LABELS: Record<string, string> = {
  FARMER:       "Farmer",
  DEALER:       "Dealer",
  FACILITATOR:  "Facilitator",
  FARM_PUNDIT:  "FarmPundit",
};
