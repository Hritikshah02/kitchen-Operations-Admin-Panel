"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Capability } from "../lib/capabilities";
import { can, useAuth } from "./auth-provider";
import { useTrackPageViews } from "./back-link";

// Navigation is driven by capabilities, so a new role needs no change here.
const navigation: { href: string; label: string; requires: Capability }[] = [
  { href: "/dashboard", label: "Overview", requires: Capability.DASHBOARD_VIEW },
  { href: "/companies", label: "Companies", requires: Capability.COMPANIES_MANAGE },
  { href: "/employees", label: "Employees", requires: Capability.COMPANIES_MANAGE },
  { href: "/staff", label: "Staff", requires: Capability.STAFF_MANAGE },
  { href: "/reference-data", label: "Reference data", requires: Capability.REFERENCE_DATA_MANAGE },
  { href: "/settings", label: "Settings", requires: Capability.SETTINGS_MANAGE },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname(); const router = useRouter(); const { staff, logout } = useAuth();
  useTrackPageViews();
  if (!staff) return null;
  async function handleLogout() { await logout(); router.replace("/login"); }
  return <div className="app-frame"><aside className="sidebar">
    <Link className="wordmark" href="/dashboard">Kitchen</Link>
    <nav aria-label="Primary navigation" className="navigation">{navigation.filter((item) => can(staff, item.requires)).map((item) => <Link className={pathname.startsWith(item.href) ? "nav-link active" : "nav-link"} href={item.href} key={item.href}>{item.label}</Link>)}</nav>
    <div className="staff-summary"><strong>{staff.name}</strong><span>{staff.roleLabel}</span><button className="quiet-button" onClick={handleLogout} type="button">Sign out</button></div>
  </aside><div className="workspace">{children}</div></div>;
}
