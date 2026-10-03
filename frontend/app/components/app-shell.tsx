"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "./auth-provider";

const navigation = {
  ADMIN: [{ href: "/dashboard", label: "Overview" }, { href: "/companies", label: "Companies" }],
  KITCHEN: [{ href: "/dashboard", label: "Kitchen board" }],
  DISPATCH: [{ href: "/dashboard", label: "Dispatch board" }],
  DRIVER: [{ href: "/dashboard", label: "My deliveries" }],
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname(); const router = useRouter(); const { staff, logout } = useAuth();
  if (!staff) return null;
  async function handleLogout() { await logout(); router.replace("/login"); }
  return <div className="app-frame"><aside className="sidebar">
    <Link className="wordmark" href="/dashboard">Fernleaf <span>Kitchen</span></Link>
    <nav aria-label="Primary navigation" className="navigation">{navigation[staff.role].map((item) => <Link className={pathname === item.href ? "nav-link active" : "nav-link"} href={item.href} key={item.href}>{item.label}</Link>)}</nav>
    <div className="staff-summary"><strong>{staff.name}</strong><span>{staff.role.toLowerCase()}</span><button className="quiet-button" onClick={handleLogout} type="button">Sign out</button></div>
  </aside><div className="workspace">{children}</div></div>;
}
