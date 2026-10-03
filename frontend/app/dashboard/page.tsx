"use client";

import { AppShell } from "../components/app-shell";
import { useAuth } from "../components/auth-provider";
import { ProtectedPage } from "../components/protected-page";

const dashboardCopy = {
  ADMIN: { title: "Operations overview", detail: "Companies, menus, orders, and billing will be managed here." },
  KITCHEN: { title: "Kitchen board", detail: "Today’s preparation queue will appear here." },
  DISPATCH: { title: "Dispatch board", detail: "Today’s delivery drops will appear here." },
  DRIVER: { title: "My deliveries", detail: "Your deliveries for today will appear here." },
};
function DashboardContent() {
  const { staff } = useAuth(); if (!staff) return null;
  const dashboard = dashboardCopy[staff.role];
  return <AppShell><main className="content-page"><p className="eyebrow">{staff.role}</p><h1>{dashboard.title}</h1><p className="muted">{dashboard.detail}</p></main></AppShell>;
}
export default function DashboardPage() { return <ProtectedPage><DashboardContent /></ProtectedPage>; }
