"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { AppShell } from "../../../components/app-shell";
import { BackLink } from "../../../components/back-link";
import { Pagination } from "../../../components/form-controls";
import { ProtectedPage } from "../../../components/protected-page";
import { apiJson, messageOf, sendJson } from "../../../lib/api";
import { Capability } from "../../../lib/capabilities";
import { formatDay, titleCase } from "../../../lib/format";
import { formatCents } from "../../../lib/money";
import { STATUS_TONE, type CompanyDetail, type InvoiceStatus, type InvoiceSummary, type Page, type Uninvoiced } from "../../../lib/types";
import { useResource } from "../../../lib/use-resource";

const TONE: Record<InvoiceStatus, string> = { UNPAID: "amber", PAID: "green", VOID: "grey" };

function CompanyBilling() {
  const { id } = useParams<{ id: string }>(); const router = useRouter();
  const { data: company } = useResource<CompanyDetail>(`/companies/${id}`);
  const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [page, setPage] = useState(1); const [refresh, setRefresh] = useState(0);
  const query = new URLSearchParams({ page: String(page), pageSize: "50", ...(from ? { from } : {}), ...(to ? { to } : {}) });
  const { data, error, reload } = useResource<Uninvoiced>(`/billing/companies/${id}/uninvoiced?${query}`, refresh);
  const { data: invoices } = useResource<Page<InvoiceSummary>>(`/billing/invoices?companyId=${id}&pageSize=20`, refresh);
  const [selected, setSelected] = useState<number[]>([]); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const pageIds = data?.items.map((order) => order.id) ?? [];
  const allSelected = pageIds.length > 0 && pageIds.every((orderId) => selected.includes(orderId));
  const selectedTotal = data?.items.filter((order) => selected.includes(order.id)).reduce((sum, order) => sum + order.amountCents, 0) ?? 0;

  async function create() {
    setBusy(true); setMessage("");
    try {
      const invoice = await apiJson<{ id: number }>("/billing/invoices", sendJson("POST", { companyId: Number(id), orderIds: selected }));
      router.push(`/billing/invoices/${invoice.id}`);
    } catch (caught) { setMessage(messageOf(caught, "Could not create the invoice.")); setSelected([]); setRefresh((value) => value + 1); reload(); }
    finally { setBusy(false); }
  }

  return <AppShell><main className="content-page wide">
    <BackLink href="/billing" label="Back to billing" />
    <div className="page-heading"><div><p className="eyebrow">Billing</p><h1>{company?.name ?? "Company"}</h1></div></div>
    {error ? <p className="form-error">{error}</p> : null}{message ? <p aria-live="polite" className="form-error">{message}</p> : null}
    <section className="panel">
      <h2>Confirmed orders not yet invoiced</h2>
      <div className="toolbar">
        <label>Delivery from<input onChange={(event) => { setFrom(event.target.value); setPage(1); }} type="date" value={from} /></label>
        <label>to<input onChange={(event) => { setTo(event.target.value); setPage(1); }} type="date" value={to} /></label>
      </div>
      {data?.openCredits.length ? <p className="notice">Credits owed to this company ({formatCents(data.openCredits.reduce((sum, credit) => sum + credit.amountCents, 0))}) will be taken off the next invoice automatically, without taking it below zero.</p> : null}
      <div className="table-wrap"><table className="data-table"><thead><tr>
        <th><input aria-label="Select all" checked={allSelected} onChange={() => setSelected(allSelected ? selected.filter((orderId) => !pageIds.includes(orderId)) : [...new Set([...selected, ...pageIds])])} type="checkbox" /></th>
        <th>Order</th><th>Delivery</th><th>Employee</th><th>Status</th><th>Total</th><th>Credited</th><th>To invoice</th></tr></thead><tbody>
        {data?.items.map((order) => <tr key={order.id}>
          <td><input aria-label={`Select order ${order.id}`} checked={selected.includes(order.id)} onChange={() => setSelected(selected.includes(order.id) ? selected.filter((value) => value !== order.id) : [...selected, order.id])} type="checkbox" /></td>
          <td><Link className="link" href={`/orders/${order.id}`}>#{order.id}</Link></td><td>{formatDay(order.deliveryDate)}</td><td>{order.employee}</td>
          <td><span className={`badge ${STATUS_TONE[order.status]}`}>{titleCase(order.status)}</span></td><td>{formatCents(order.totalCents)}</td><td>{order.creditedCents ? formatCents(-order.creditedCents) : "—"}</td><td><strong>{formatCents(order.amountCents)}</strong></td>
        </tr>)}
        {data && !data.items.length ? <tr><td className="muted" colSpan={8}>Nothing to invoice.</td></tr> : null}
      </tbody></table></div>
      {data ? <Pagination noun="orders" onPage={setPage} page={data.page} pageSize={data.pageSize} total={data.total} /> : null}
      <div className="form-actions"><button className="primary-button" disabled={busy || !selected.length} onClick={() => void create()} type="button">{busy ? "Creating..." : `Create invoice from ${selected.length} order${selected.length === 1 ? "" : "s"}`}</button><span className="hint">{selected.length ? `Selected on this page: ${formatCents(selectedTotal)}` : "Tick the orders to group into one invoice"}</span></div>
    </section>
    <section className="panel"><h2>Invoices</h2>
      <div className="table-wrap"><table className="data-table"><tbody>
        {invoices?.items.map((invoice) => <tr key={invoice.id}><td><Link className="link" href={`/billing/invoices/${invoice.id}`}>{invoice.number}</Link></td><td>{formatCents(invoice.totalCents)}</td><td><span className={`badge ${TONE[invoice.status]}`}>{titleCase(invoice.status)}</span></td></tr>)}
        {invoices && !invoices.items.length ? <tr><td className="muted">No invoices for this company yet.</td></tr> : null}
      </tbody></table></div>
    </section>
  </main></AppShell>;
}

export default function CompanyBillingPage() { return <ProtectedPage requires={[Capability.BILLING_MANAGE]}><CompanyBilling /></ProtectedPage>; }
