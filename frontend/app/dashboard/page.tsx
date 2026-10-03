"use client";

import { AppShell } from "../components/app-shell";
import { can, useAuth } from "../components/auth-provider";
import { ProtectedPage } from "../components/protected-page";
import { Capability } from "../lib/capabilities";

// Placeholder copy until the role dashboards (phase 10); chosen by capability, not role name.
const dashboards = [
  { requires: Capability.STAFF_MANAGE, title: "Operations overview", detail: "Companies, menus, orders, and billing will be managed here." },
  { requires: Capability.KITCHEN_BOARD_VIEW, title: "Kitchen board", detail: "Today’s preparation queue will appear here." },
  { requires: Capability.DISPATCH_BOARD_VIEW, title: "Dispatch board", detail: "Today’s delivery drops will appear here." },
  { requires: Capability.DRIVER_DROPS_VIEW, title: "My deliveries", detail: "Your deliveries for today will appear here." },
];
function DashboardContent() {
  const { staff } = useAuth(); if (!staff) return null;
  const dashboard = dashboards.find((entry) => can(staff, entry.requires)) ?? { title: "Welcome", detail: "Your workspace is ready." };
  return <AppShell><main className="content-page"><p className="eyebrow">{staff.roleLabel}</p><h1>{dashboard.title}</h1><p className="muted">{dashboard.detail}</p></main></AppShell>;
}
export default function DashboardPage() { return <ProtectedPage requires={[Capability.DASHBOARD_VIEW]}><DashboardContent /></ProtectedPage>; }
