"use client";

import { AppShell } from "../../components/app-shell";
import { BackLink } from "../../components/back-link";
import { OrderBuilder } from "../../components/order-builder";
import { ProtectedPage } from "../../components/protected-page";
import { Capability } from "../../lib/capabilities";

export default function NewOrderPage() {
  return <ProtectedPage requires={[Capability.ORDERS_MANAGE]}><AppShell><main className="content-page wide">
    <BackLink href="/orders" label="Back to orders" />
    <h1>New order</h1>
    <OrderBuilder />
  </main></AppShell></ProtectedPage>;
}
