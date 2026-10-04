"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Capability } from "../lib/capabilities";
import { can, useAuth } from "./auth-provider";
import { useTrackPageViews } from "./back-link";
import { Avatar } from "./form-controls";
import { Icon, type IconName } from "./icons";

// Navigation is driven by capabilities, so a new role needs no change here.
type NavItem = { href: string; label: string; requires: Capability; icon: IconName };
const sections: { title: string; items: NavItem[] }[] = [
  { title: "Operations", items: [
    { href: "/dashboard", label: "Overview", requires: Capability.DASHBOARD_VIEW, icon: "home" },
    { href: "/orders", label: "Orders", requires: Capability.ORDERS_MANAGE, icon: "orders" },
    { href: "/kitchen", label: "Kitchen", requires: Capability.KITCHEN_BOARD_VIEW, icon: "kitchen" },
    { href: "/dispatch", label: "Dispatch", requires: Capability.DISPATCH_BOARD_VIEW, icon: "dispatch" },
    { href: "/driver", label: "My drops", requires: Capability.DRIVER_DROPS_VIEW, icon: "pin" },
  ] },
  { title: "Customers", items: [
    { href: "/companies", label: "Companies", requires: Capability.COMPANIES_MANAGE, icon: "building" },
    { href: "/employees", label: "Employees", requires: Capability.COMPANIES_MANAGE, icon: "users" },
  ] },
  { title: "Catalogue", items: [
    { href: "/catalogue", label: "Catalogue", requires: Capability.CATALOGUE_MANAGE, icon: "bowl" },
    { href: "/pricing", label: "Pricing", requires: Capability.CATALOGUE_MANAGE, icon: "tag" },
    { href: "/menu", label: "Menu", requires: Capability.CATALOGUE_MANAGE, icon: "list" },
  ] },
  { title: "Finance", items: [{ href: "/billing", label: "Billing", requires: Capability.BILLING_MANAGE, icon: "receipt" }] },
  { title: "Admin", items: [
    { href: "/staff", label: "Staff", requires: Capability.STAFF_MANAGE, icon: "shield" },
    { href: "/reference-data", label: "Reference data", requires: Capability.REFERENCE_DATA_MANAGE, icon: "layers" },
    { href: "/settings", label: "Settings", requires: Capability.SETTINGS_MANAGE, icon: "sliders" },
  ] },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname(); const router = useRouter(); const { staff, logout } = useAuth();
  useTrackPageViews();
  if (!staff) return null;
  async function handleLogout() { await logout(); router.replace("/login"); }
  const visible = sections.map((section) => ({ ...section, items: section.items.filter((item) => can(staff, item.requires)) })).filter((section) => section.items.length);
  return <div className="app-frame"><aside className="sidebar">
    <Link className="wordmark" href="/dashboard"><span aria-hidden="true" className="brand-mark"><Icon name="bowl" size={20} /></span>Fernleaf Kitchen</Link>
    <nav aria-label="Primary navigation" className="navigation">{visible.map((section) => <div className="nav-section" key={section.title}>
      <span className="nav-heading">{section.title}</span>
      {section.items.map((item) => { const active = pathname.startsWith(item.href); return <Link aria-current={active ? "page" : undefined} className={active ? "nav-link active" : "nav-link"} href={item.href} key={item.href}><Icon name={item.icon} />{item.label}</Link>; })}
    </div>)}</nav>
    <div className="staff-summary"><Avatar name={staff.name} /><strong>{staff.name}</strong><span>{staff.roleLabel}</span><button className="quiet-button" onClick={handleLogout} type="button"><Icon name="logout" size={15} />Sign out</button></div>
  </aside><div className="workspace">{children}</div></div>;
}
