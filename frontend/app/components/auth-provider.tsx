"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";
import type { Capability } from "../lib/capabilities";

export type Staff = { id: number; name: string; email: string; role: string; roleLabel: string; capabilities: Capability[] };
export const can = (staff: Staff | null, ...required: Capability[]) =>
  !!staff && required.every((capability) => staff.capabilities.includes(capability));
type AuthContextValue = {
  staff: Staff | null;
  status: "loading" | "authenticated" | "unauthenticated";
  login: (email: string, password: string) => Promise<Staff>;
  logout: () => Promise<void>;
};
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [staff, setStaff] = useState<Staff | null>(null);
  const [status, setStatus] = useState<AuthContextValue["status"]>("loading");
  const clearSession = useCallback(() => { setStaff(null); setStatus("unauthenticated"); }, []);

  useEffect(() => {
    apiFetch("/auth/me").then(async (response) => {
      setStaff((await response.json()) as Staff);
      setStatus("authenticated");
    }).catch(clearSession);
    window.addEventListener("kitchenops:unauthorized", clearSession);
    return () => window.removeEventListener("kitchenops:unauthorized", clearSession);
  }, [clearSession]);

  const value = useMemo<AuthContextValue>(() => ({
    staff, status,
    async login(email, password) {
      const response = await apiFetch("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      const authenticatedStaff = (await response.json()) as Staff;
      setStaff(authenticatedStaff); setStatus("authenticated");
      return authenticatedStaff;
    },
    async logout() { await apiFetch("/auth/logout", { method: "POST" }); clearSession(); },
  }), [clearSession, staff, status]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}
