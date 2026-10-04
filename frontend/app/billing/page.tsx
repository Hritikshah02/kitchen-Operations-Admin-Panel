"use client";

import Link from "next/link";
import { useState } from "react";
import { AppShell } from "../components/app-shell";
import { Pagination } from "../components/form-controls";
import { ProtectedPage } from "../components/protected-page";
import { Capability } from "../lib/capabilities";
import { formatInstant, titleCase } from "../lib/format";
import { formatCents } from "../lib/money";
import type { BillingCompany, InvoiceStatus, InvoiceSummary, Page } from "../lib/types";
import { useResource } from "../lib/use-resource";

const INVOICE_TONE: Record<InvoiceStatus, string> = { UNPAID: "amber", PAID: "green", VOID: "grey" };

function BillingContent() {
  const { data: companies, error } = useResource<BillingCompany[]>("/billing/companies");
  const [status, setStatus] = useState(""); const [page, setPage] = useState(1);
  const { data: invoices } = useResource<Page<InvoiceSummary>>(`/billing/invoices?page=${page}&pageSize=10${status ? `&status=${status}` : ""}`);
  const owed = companies?.reduce((sum, company) => sum + company.uninvoicedCents, 0) ?? 0;
  const unpaid = companies?.reduce((sum, company) => sum + company.unpaidCents, 0) ?? 0;
  return <AppShell><main className="content-page wide">
    <div className="page-heading"><div><p className="eyebrow">Finance</p><h1>Billing</h1><p className="hint">Every confirmed order is owed in full by its company. Invoices are internal records; no tax is added.</p></div></div>
    {companies ? <div className="stat-row">
      <div className="stat"><span>Not yet invoiced</span><strong>{formatCents(owed)}</strong></div>
      <div className="stat"><span>Invoiced, unpaid</span><strong>{formatCents(unpaid)}</strong></div>
      <div className="stat"><span>Credits owed back</span><strong>{formatCents(companies.reduce((sum, company) => sum + company.openCreditCents, 0))}</strong></div>
    </div> : null}
    {error ? <p className="form-error">{error}</p> : null}
    <section className="panel"><h2>Companies</h2>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Company</th><th>Orders to invoice</th><th>Amount</th><th>Open credits</th><th>Unpaid invoices</th></tr></thead><tbody>
        {companies?.map((company) => <tr key={company.id}>
          <td><Link className="link" href={`/billing/companies/${company.id}`}>{company.name}</Link>{company.isActive ? null : <span className="badge grey"> inactive</span>}</td>
          <td>{company.uninvoicedOrders}</td><td>{formatCents(company.uninvoicedCents)}</td>
          <td>{company.openCredits ? `${company.openCredits} · ${formatCents(company.openCreditCents)}` : "—"}</td>
          <td>{company.unpaidInvoices ? `${company.unpaidInvoices} · ${formatCents(company.unpaidCents)}` : "—"}</td>
        </tr>)}
      </tbody></table></div>
    </section>
    <section className="panel"><div className="panel-heading"><h2>Invoices</h2>
      <label>Status<select onChange={(event) => { setStatus(event.target.value); setPage(1); }} value={status}><option value="">All</option><option value="UNPAID">Unpaid</option><option value="PAID">Paid</option><option value="VOID">Void</option></select></label></div>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Invoice</th><th>Company</th><th>Issued</th><th>Lines</th><th>Total</th><th>Status</th></tr></thead><tbody>
        {invoices?.items.map((invoice) => <tr key={invoice.id}>
          <td><Link className="link" href={`/billing/invoices/${invoice.id}`}>{invoice.number}</Link></td><td>{invoice.company.name}</td><td>{formatInstant(invoice.issuedAt)}</td><td>{invoice.lineCount}</td><td>{formatCents(invoice.totalCents)}</td>
          <td><span className={`badge ${INVOICE_TONE[invoice.status]}`}>{titleCase(invoice.status)}</span></td>
        </tr>)}
        {invoices && !invoices.items.length ? <tr><td className="muted" colSpan={6}>No invoices yet.</td></tr> : null}
      </tbody></table></div>
      {invoices ? <Pagination noun="invoices" onPage={setPage} page={invoices.page} pageSize={invoices.pageSize} total={invoices.total} /> : null}
    </section>
  </main></AppShell>;
}

export default function BillingPage() { return <ProtectedPage requires={[Capability.BILLING_MANAGE]}><BillingContent /></ProtectedPage>; }
