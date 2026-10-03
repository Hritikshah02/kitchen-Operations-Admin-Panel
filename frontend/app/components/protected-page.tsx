"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth, type RoleName } from "./auth-provider";

export function ProtectedPage({ children, allowedRoles }: { children: React.ReactNode; allowedRoles?: RoleName[] }) {
  const router = useRouter();
  const { staff, status } = useAuth();
  const hasRole = !allowedRoles || (staff ? allowedRoles.includes(staff.role) : false);
  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
    if (status === "authenticated" && !hasRole) router.replace("/dashboard");
  }, [hasRole, router, status]);
  if (status === "loading" || !staff || !hasRole) return <main className="page-loader">Loading workspace...</main>;
  return <>{children}</>;
}
