"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./components/auth-provider";

export default function Home() {
  const router = useRouter();
  const { status } = useAuth();
  useEffect(() => {
    if (status === "authenticated") router.replace("/dashboard");
    if (status === "unauthenticated") router.replace("/login");
  }, [router, status]);
  return <main className="page-loader">Checking your session...</main>;
}
