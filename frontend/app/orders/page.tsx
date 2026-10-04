"use client";

import Link from "next/link";
import { useState } from "react";
import { AppShell } from "../components/app-shell";
import { can, useAuth } from "../components/auth-provider";
import { Pagination } from "../components/form-controls";
import { ProtectedPage } from "../components/protected-page";
import { apiJson, messageOf, sendJson } from "../lib/api";
import { Capability } from "../lib/capabilities";
import { formatDay, formatInstant, titleCase } from "../lib/format";
import { formatCents } from "../lib/money";
import { ORDER_STATUSES, STATUS_TONE, type CompanySummary, type OrderStatus, type OrderSummary, type Page } from "../lib/types";
import { useResource } from "../lib/use-resource";

type CutoffDay = {
  deliveryDate: string; weekday: string; cutoffAt: string; cutoffPassed: boolean;
  draft: number; placed: number; confirmed: number; delivered: number; cancelled: number; rejected: number;
  lastRun: { ranAt: string; trigger: string; confirmed: number; cancelled: number } | null;
};

/** 4.6: shows each date's cut-off and lets an admin process a past one now instead of waiting for the scheduler. */
function CutoffPanel({ onProcessed }: { onProcessed: () => void }) {
  const { staff } = useAuth();
  const { data, reload } = useResource<CutoffDay[]>("/orders/cutoff");
  const [busy, setBusy] = useState(""); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  async function runNow(date: string) {
    setBusy(date); setMessage(""); setError("");
    try {
      const result = await apiJson<{ confirmed: number; cancelled: number }>("/orders/cutoff/run", sendJson("POST", { deliveryDate: date }));
      setMessage(`${formatDay(date)}: ${result.confirmed} confirmed, ${result.cancelled} draft(s) cancelled.${result.confirmed + result.cancelled === 0 ? " (Already processed: running it again changes nothing.)" : ""}`);
      reload(); onProcessed();
    } catch (caught) { setError(messageOf(caught, "Could not process the cut-off.")); }
    finally { setBusy(""); }
  }
  return <details className="panel">
    <summary><strong>Cut-off processing</strong> <span className="hint">— drafts are cancelled and placed orders confirmed when a date&apos;s cut-off passes (automatic every minute)</span></summary>
    {message ? <p className="success-text" style={{ marginTop: 12 }}>{message}</p> : null}{error ? <p className="form-error" style={{ marginTop: 12 }}>{error}</p> : null}
    <div className="table-wrap" style={{ marginTop: 12 }}><table className="data-table"><thead><tr><th>Delivery</th><th>Cut-off</th><th>Draft</th><th>Placed</th><th>Confirmed</th><th>Delivered</th><th>Cancelled / rejected</th><th>Last run</th><th /></tr></thead><tbody>
      {data?.map((day) => <tr key={day.deliveryDate}>
        <td>{formatDay(day.deliveryDate)}</td>
        <td>{formatInstant(day.cutoffAt)} {day.cutoffPassed ? <span className="badge grey">passed</span> : <span className="badge amber">open</span>}</td>
        <td>{day.draft}</td><td>{day.placed}</td><td>{day.confirmed}</td><td>{day.delivered}</td><td>{day.cancelled} / {day.rejected}</td>
        <td className="hint">{day.lastRun ? `${formatInstant(day.lastRun.ranAt)} (${day.lastRun.trigger})` : "—"}</td>
        <td>{day.cutoffPassed && can(staff, Capability.ORDERS_OVERRIDE) ? <button className="secondary-button" disabled={Boolean(busy)} onClick={() => void runNow(day.deliveryDate)} type="button">{busy === day.deliveryDate ? "Running..." : "Run now"}</button> : null}</td>
      </tr>)}
      {data && !data.length ? <tr><td className="muted" colSpan={9}>No orders in the last week or the next two weeks.</td></tr> : null}
    </tbody></table></div>
  </details>;
}

function OrdersContent() {
  const { data: companies } = useResource<Page<CompanySummary>>("/companies?pageSize=100&includeInactive=true");
  const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [statuses, setStatuses] = useState<OrderStatus[]>([]);
  const [companyId, setCompanyId] = useState(""); const [invoiced, setInvoiced] = useState(""); const [search, setSearch] = useState(""); const [page, setPage] = useState(1); const [refresh, setRefresh] = useState(0);
  const query = new URLSearchParams({
    page: String(page), pageSize: "25",
    ...(from ? { from } : {}), ...(to ? { to } : {}), ...(statuses.length ? { status: statuses.join(",") } : {}),
    ...(companyId ? { companyId } : {}), ...(invoiced ? { invoiced } : {}), ...(search.trim() ? { search: search.trim() } : {}),
  });
  const { data, error, loading } = useResource<Page<OrderSummary>>(`/orders?${query}`, refresh);
  const reset = (fn: () => void) => { fn(); setPage(1); };
  const toggleStatus = (status: OrderStatus) => reset(() => setStatuses(statuses.includes(status) ? statuses.filter((entry) => entry !== status) : [...statuses, status]));

  return <AppShell><main className="content-page wide">
    <div className="page-heading"><div><p className="eyebrow">Operations</p><h1>Orders</h1></div><Link className="primary-button" href="/orders/new">New order</Link></div>
    <CutoffPanel onProcessed={() => setRefresh((value) => value + 1)} />
    <section className="panel">
      <div className="toolbar">
        <label>Delivery from<input onChange={(event) => reset(() => setFrom(event.target.value))} type="date" value={from} /></label>
        <label>to<input onChange={(event) => reset(() => setTo(event.target.value))} type="date" value={to} /></label>
        <label>Company<select onChange={(event) => reset(() => setCompanyId(event.target.value))} value={companyId}><option value="">All companies</option>{companies?.items.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
        <label>Invoiced<select onChange={(event) => reset(() => setInvoiced(event.target.value))} value={invoiced}><option value="">Any</option><option value="true">On an invoice</option><option value="false">Not invoiced</option></select></label>
        <label>Search<input onChange={(event) => reset(() => setSearch(event.target.value))} placeholder="Employee or #order" value={search} /></label>
      </div>
      <div className="chip-group">{ORDER_STATUSES.map((status) => <label className="chip" key={status}><input checked={statuses.includes(status)} onChange={() => toggleStatus(status)} type="checkbox" />{titleCase(status)}</label>)}</div>
      {error ? <p className="form-error">{error}</p> : null}
      {loading && !data ? <p className="muted">Loading orders...</p> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Order</th><th>Delivery</th><th>Employee</th><th>Company</th><th>Boxes</th><th>Total</th><th>Status</th></tr></thead><tbody>
        {data?.items.map((order) => <tr key={order.id}>
          <td><Link className="link" href={`/orders/${order.id}`}>#{order.id}</Link></td>
          <td>{formatDay(order.deliveryDate)} · {order.deliveryTime}</td>
          <td>{order.employee.name}</td><td>{order.company.name}</td>
          <td>{order.boxCount} <span className="hint">({order.lineCount} line{order.lineCount === 1 ? "" : "s"})</span></td>
          <td>{formatCents(order.totalCents)}</td>
          <td><span className={`badge ${STATUS_TONE[order.status]}`}>{titleCase(order.status)}</span></td>
        </tr>)}
        {data && !data.items.length ? <tr><td className="muted" colSpan={7}>No orders match these filters.</td></tr> : null}
      </tbody></table></div>}
      {data ? <Pagination noun="orders" onPage={setPage} page={data.page} pageSize={data.pageSize} total={data.total} /> : null}
    </section>
  </main></AppShell>;
}

export default function OrdersPage() { return <ProtectedPage requires={[Capability.ORDERS_MANAGE]}><OrdersContent /></ProtectedPage>; }
