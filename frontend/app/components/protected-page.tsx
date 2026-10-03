"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Capability } from "../lib/capabilities";
import { can, useAuth } from "./auth-provider";

export function ProtectedPage({ children, requires = [] }: { children: React.ReactNode; requires?: Capability[] }) {
  const router = useRouter();
  const { staff, status } = useAuth();
  const allowed = can(staff, ...requires);
  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
    if (status === "authenticated" && !allowed) router.replace("/dashboard");
  }, [allowed, router, status]);
  if (status === "loading" || !staff || !allowed) return <main className="page-loader">Loading workspace...</main>;
  return <>{children}</>;
}
