"use client";

import { useParams } from "next/navigation";
import { AppShell } from "../../../components/app-shell";
import { BackLink } from "../../../components/back-link";
import { linesFromOrder, OrderBuilder } from "../../../components/order-builder";
import { ProtectedPage } from "../../../components/protected-page";
import { Capability } from "../../../lib/capabilities";
import type { EmployeeMenu, MenuDishView, OrderDetail } from "../../../lib/types";
import { useResource } from "../../../lib/use-resource";

function EditContent() {
  const { id } = useParams<{ id: string }>();
  const { data: order, error } = useResource<OrderDetail>(`/orders/${id}`);
  // Current definitions of the dishes on the order (including secret ones), to rebuild editable lines.
  const { data: menu } = useResource<EmployeeMenu & { requested: MenuDishView[] }>(order ? `/menu/preview?employeeId=${order.employee.id}&dishIds=${order.lines.map((line) => line.dishId).join(",")}` : null);
  return <AppShell><main className="content-page wide">
    <BackLink href={`/orders/${id}`} label="Back to order" />
    <div className="page-heading"><div><p className="eyebrow">Orders</p><h1>Edit order #{id}</h1></div></div>
    {error ? <p className="form-error">{error}</p> : !order ? <p className="muted">Loading order...</p>
      : !order.permissions.edit ? <p className="notice">This order can no longer be edited ({order.status.toLowerCase()}{order.pastCutoff ? ", past its cut-off" : ""}).</p>
      : <>{order.status === "PLACED" ? <p className="hint">This order is placed: items you keep stay at the prices it was placed with; anything new is priced at today&apos;s prices.</p> : null}{menu ? <OrderBuilder initialLines={linesFromOrder(order, menu.requested)} key={order.version} order={order} /> : <p className="muted">Loading menu...</p>}</>}
  </main></AppShell>;
}

export default function EditOrderPage() { return <ProtectedPage requires={[Capability.ORDERS_MANAGE]}><EditContent /></ProtectedPage>; }
