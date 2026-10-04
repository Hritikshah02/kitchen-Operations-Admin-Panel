"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { type FormEvent, useState } from "react";
import { AppShell } from "../../components/app-shell";
import { BackLink } from "../../components/back-link";
import { can, useAuth } from "../../components/auth-provider";
import { ProtectedPage } from "../../components/protected-page";
import { apiJson, messageOf, sendJson } from "../../lib/api";
import { Capability } from "../../lib/capabilities";
import { formatDay, formatInstant, formatTime, titleCase } from "../../lib/format";
import { formatCents } from "../../lib/money";
import { STATUS_TONE, type CompanyDetail, type Option, type OrderDetail } from "../../lib/types";
import { useResource } from "../../lib/use-resource";

function DeliveryOverride({ order, onDone }: { order: OrderDetail; onDone: (message: string) => Promise<void> | void }) {
  const { data: company } = useResource<CompanyDetail>(`/companies/${order.company.id}`);
  const { data: packaging } = useResource<Option[]>("/reference-data/packaging-types");
  const [time, setTime] = useState(order.deliveryTime); const [addressId, setAddressId] = useState(String(order.addressId)); const [packagingId, setPackagingId] = useState(String(order.packagingTypeId ?? ""));
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await apiJson(`/orders/${order.id}/delivery`, sendJson("PATCH", { version: order.version, deliveryTime: time, addressId: Number(addressId), packagingTypeId: packagingId ? Number(packagingId) : null }));
      await onDone("Delivery details changed.");
    } catch (caught) { setError(messageOf(caught, "Could not change delivery details.")); }
    finally { setBusy(false); }
  }
  return <form className="panel" onSubmit={save}><fieldset className="panel-fieldset" disabled={busy}>
    <h2>Admin override: delivery details</h2>
    <p className="hint">Overrides ignore the employee&apos;s permissions. The kitchen and dispatch plans follow the new time.</p>
    <div className="form-grid">
      <label>Time<input onChange={(event) => setTime(event.target.value)} required type="time" value={time} /></label>
      <label>Address<select onChange={(event) => setAddressId(event.target.value)} value={addressId}>{company?.addresses.filter((address) => address.isActive || address.id === order.addressId).map((address) => <option key={address.id} value={address.id}>{address.label}</option>)}</select></label>
      <label>Packaging<select onChange={(event) => setPackagingId(event.target.value)} value={packagingId}><option value="">None</option>{packaging?.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
    </div>
    {error ? <p className="form-error">{error}</p> : null}
    <div className="form-actions"><button className="primary-button" type="submit">Save override</button></div>
  </fieldset></form>;
}

function InvoicingPanel({ order, onChanged }: { order: OrderDetail; onChanged: () => void }) {
  const { staff } = useAuth();
  const canBill = can(staff, Capability.BILLING_MANAGE);
  const [open, setOpen] = useState(false); const [missing, setMissing] = useState<Record<number, string>>({}); const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const combinations = order.lines.flatMap((line) => line.combinations.map((combination) => ({ ...combination, dish: line.dishName })));
  async function submit() {
    setBusy(true); setError("");
    try {
      await apiJson(`/billing/orders/${order.id}/short-delivery`, sendJson("POST", { reason, items: combinations.filter((combination) => Number(missing[combination.id!]) > 0).map((combination) => ({ combinationId: combination.id, missingQuantity: Number(missing[combination.id!]) })) }));
      setOpen(false); setMissing({}); setReason(""); onChanged();
    } catch (caught) { setError(messageOf(caught, "Could not record the credit.")); } finally { setBusy(false); }
  }
  return <section className="panel">
    <h2>Invoicing</h2>
    <p>{order.invoice ? <>On invoice {canBill ? <Link className="link" href={`/billing/invoices/${order.invoice.id}`}>{order.invoice.number}</Link> : order.invoice.number} <span className={`badge ${{ UNPAID: "amber", PAID: "green", VOID: "grey" }[order.invoice.status]}`}>{titleCase(order.invoice.status)}</span></> : <span className="muted">Not invoiced yet.</span>}</p>
    {order.credits.length ? <ul className="plain-list">{order.credits.map((credit) => <li key={credit.id}>Credit {formatCents(credit.amountCents)} · {titleCase(credit.kind.replace(/_/g, " "))}: {credit.reason} <span className="badge grey">{titleCase(credit.status)}</span></li>)}</ul> : null}
    {canBill && order.status === "DELIVERED" ? (open ? <div className="form-stack">
      <p className="hint">Enter how many of each item did not arrive; the credit is that quantity × the unit price.</p>
      {combinations.map((combination) => <label key={combination.id}>{combination.dish}{combination.choices.length ? ` (${combination.choices.map((choice) => choice.optionName).join(", ")})` : ""}: ordered {combination.quantity} at {formatCents(combination.unitPriceCents)}
        <input max={combination.quantity} min={0} onChange={(event) => setMissing({ ...missing, [combination.id!]: event.target.value })} placeholder="Missing" type="number" value={missing[combination.id!] ?? ""} /></label>)}
      <label>Reason<input maxLength={300} onChange={(event) => setReason(event.target.value)} placeholder="e.g. one box missing at delivery" value={reason} /></label>
      {error ? <p aria-live="polite" className="form-error">{error}</p> : null}
      <div className="form-actions"><button className="primary-button" disabled={busy || reason.trim().length < 3} onClick={() => void submit()} type="button">Issue credit</button><button className="secondary-button" onClick={() => setOpen(false)} type="button">Cancel</button></div>
    </div> : <div className="form-actions"><button className="secondary-button" onClick={() => setOpen(true)} type="button">Record a short delivery</button></div>) : null}
  </section>;
}

function OrderContent() {
  const { id } = useParams<{ id: string }>();
  const { data: order, error: loadError, reload } = useResource<OrderDetail>(`/orders/${id}`);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [overriding, setOverriding] = useState(false);
  if (loadError) return <AppShell><main className="content-page"><p className="form-error">{loadError}</p></main></AppShell>;
  if (!order) return <AppShell><main className="content-page"><p className="muted">Loading order...</p></main></AppShell>;

  async function act(path: string, body: object, success: string) {
    if (!order) return;
    setBusy(true); setError(""); setNotice("");
    try { await apiJson(`/orders/${order.id}/${path}`, sendJson("POST", { version: order.version, ...body })); setNotice(success); reload(); }
    catch (caught) { setError(messageOf(caught, "Something went wrong.")); }
    finally { setBusy(false); }
  }
  const place = () => {
    const conflicts = order.employee.allergens.length && !order.allergyAcknowledged;
    if (conflicts && !window.confirm(`${order.employee.name} has allergies (${order.employee.allergens.map((allergen) => allergen.name).join(", ")}). If the order contains any of them, confirm you've checked with the employee.`)) return;
    void act("place", { allergyAcknowledged: Boolean(conflicts) || order.allergyAcknowledged }, "Order placed.");
  };
  const cancel = () => { const reason = window.prompt("Reason for cancelling (optional):"); if (reason !== null) void act("cancel", { reason: reason.trim() || undefined }, "Order cancelled."); };
  const reject = () => { const reason = window.prompt("Why can't the kitchen fulfil this order? (required)"); if (reason?.trim()) void act("reject", { reason: reason.trim() }, "Order rejected."); };
  const boxes = order.lines.reduce((sum, line) => sum + line.quantity, 0);

  return <AppShell><main className="content-page wide">
    <BackLink href="/orders" label="Back to orders" />
    <div className="page-heading">
      <div><p className="eyebrow">Order #{order.id}</p><h1>{order.employee.name} <span className={`badge ${STATUS_TONE[order.status]}`}>{titleCase(order.status)}</span></h1></div>
      <div className="form-actions">
        {order.permissions.edit ? <Link className="secondary-button" href={`/orders/${order.id}/edit`}>Edit</Link> : null}
        {order.permissions.place ? <button className="primary-button" disabled={busy} onClick={place} type="button">Place order</button> : null}
        {order.permissions.overrideDelivery ? <button className="secondary-button" disabled={busy} onClick={() => setOverriding(!overriding)} type="button">Override delivery</button> : null}
        {order.permissions.reject ? <button className="danger-button" disabled={busy} onClick={reject} type="button">Reject</button> : null}
        {order.permissions.cancel ? <button className="danger-button" disabled={busy} onClick={cancel} type="button">Cancel</button> : null}
      </div>
    </div>
    {error ? <p aria-live="polite" className="form-error">{error}</p> : null}{notice ? <p aria-live="polite" className="success-text">{notice}</p> : null}
    {order.status === "REJECTED" ? <p className="notice">Rejected: {order.rejectionReason}</p> : null}
    {order.status === "CANCELLED" && order.cancellationReason ? <p className="notice">Cancelled: {order.cancellationReason}</p> : null}
    {overriding ? <DeliveryOverride key={order.version} onDone={(message) => { setOverriding(false); setNotice(message); reload(); }} order={order} /> : null}

    <div className="section-grid">
      <section className="panel"><h2>Delivery</h2><dl className="kv">
        <dt>Date</dt><dd>{formatDay(order.deliveryDate)} at <strong>{order.deliveryTime}</strong></dd>
        <dt>Company</dt><dd><Link className="link" href={`/companies/${order.company.id}`}>{order.company.name}</Link></dd>
        <dt>Address</dt><dd>{order.address.label}: {[order.address.line1, order.address.line2, order.address.area, `${order.address.city} ${order.address.pincode}`].filter(Boolean).join(", ")}</dd>
        <dt>Packaging</dt><dd>{order.packagingType?.name ?? "—"}</dd>
        <dt>Cut-off</dt><dd>{formatInstant(order.cutoffAt)} {order.pastCutoff ? <span className="badge grey">passed</span> : <span className="badge amber">open</span>}</dd>
        {order.notes ? <><dt>Notes</dt><dd>{order.notes}</dd></> : null}
      </dl></section>
      <section className="panel"><h2>Money</h2><dl className="kv">
        <dt>Price tier</dt><dd>{order.priceTier.name}</dd>
        <dt>Boxes</dt><dd>{boxes}</dd>
        <dt>Total</dt><dd><strong>{formatCents(order.totalCents)}</strong> <span className="hint">(pre-tax, no delivery fee)</span></dd>
        <dt>Employee</dt><dd>{order.employee.email}{order.employee.allergens.length ? <> · <span className="badge red">allergic: {order.employee.allergens.map((allergen) => allergen.name).join(", ")}</span></> : null}</dd>
        {order.allergyAcknowledged ? <><dt>Allergy</dt><dd><span className="badge amber">Acknowledged with employee</span></dd></> : null}
        <dt>Created by</dt><dd>{order.createdBy.name}</dd>
      </dl></section>
    </div>

    <section className="panel">
      <h2>Lines</h2>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Dish</th><th>Combination</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead><tbody>
        {order.lines.flatMap((line) => line.combinations.map((combination, index) => <tr key={`${line.id}-${combination.signature}`}>
          {index === 0 ? <td rowSpan={line.combinations.length}><strong>{line.dishName}</strong><div className="hint">{line.dishSku} · {line.quantity} × dish {formatCents(line.unitPriceCents)}</div></td> : null}
          <td>{combination.choices.length ? combination.choices.map((choice) => `${choice.groupName.replace(/^(Choose your|Add a) /i, "")}: ${choice.optionName}${choice.portionName ? ` (${choice.portionName})` : ""} +${formatCents(choice.unitPriceCents)}`).join(" · ") : <span className="muted">As is</span>}</td>
          <td>{combination.quantity}</td><td>{formatCents(combination.unitPriceCents)}</td><td>{formatCents(combination.totalCents)}</td>
        </tr>))}
        <tr><td colSpan={4}><strong>Order total</strong></td><td><strong>{formatCents(order.totalCents)}</strong></td></tr>
      </tbody></table></div>
    </section>

    {order.status === "CONFIRMED" || order.kitchenStartedAt ? <section className="panel">
      <h2>Kitchen plan</h2>
      <p className="hint">Worked back from the delivery time ({order.deliveryTime}); it moves if the time is overridden.</p>
      <p>Dispatch-ready by <strong>{formatTime(order.kitchen.plannedDispatchReadyAt)}</strong> · kitchen-ready by <strong>{formatTime(order.kitchen.plannedKitchenReadyAt)}</strong>
        {order.kitchen.timing ? <> <span className={`badge ${{ LATE: "red", AT_RISK: "amber", ON_TRACK: "grey", DONE: "green" }[order.kitchen.timing]}`}>{{ LATE: "Late", AT_RISK: "At risk", ON_TRACK: "On track", DONE: "Kitchen ready" }[order.kitchen.timing]}</span></> : null}</p>
      <p className="hint">Kitchen started {formatInstant(order.kitchenStartedAt)} · kitchen ready {formatInstant(order.kitchenReadyAt)}</p>
      <p className="hint">Dispatch ready {formatInstant(order.dispatchReadyAt)} · out for delivery {formatInstant(order.outForDeliveryAt)}{order.driver ? ` · driver ${order.driver.name}` : ""}</p>
    </section> : null}

    {order.invoice || order.credits.length || order.status === "DELIVERED" ? <InvoicingPanel order={order} onChanged={reload} /> : null}

    {order.status === "DELIVERED" ? <section className="panel">
      <h2>Delivery</h2>
      <p>Delivered {formatInstant(order.deliveredAt)}{order.driver ? ` by ${order.driver.name}` : ""} {order.deliveredOnTime === null ? null : order.deliveredOnTime ? <span className="badge green">On time{order.deliveryLateMinutes ? ` (+${order.deliveryLateMinutes} min, within grace)` : ""}</span> : <span className="badge red">Late by {order.deliveryLateMinutes} min</span>}</p>
      {order.deliveryNote ? <p>Driver note: {order.deliveryNote}</p> : null}
      {order.deliveryPhotoUrl ? <p><a className="link" href={order.deliveryPhotoUrl} rel="noreferrer" target="_blank">View delivery photo</a></p> : null}
    </section> : null}

    <section className="panel">
      <h2>Timeline</h2>
      <ol className="timeline">{order.events.map((event) => <li key={event.id}><span className="hint">{formatInstant(event.createdAt)}</span> <span className="badge grey">{titleCase(event.type.replace(/_/g, " "))}</span> {event.message} <span className="hint">— {event.actor?.name ?? "System"}</span></li>)}</ol>
    </section>
  </main></AppShell>;
}

export default function OrderPage() { return <ProtectedPage requires={[Capability.ORDERS_MANAGE]}><OrderContent /></ProtectedPage>; }
