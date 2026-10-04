"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { AppShell } from "../../../components/app-shell";
import { BackLink } from "../../../components/back-link";
import { ProtectedPage } from "../../../components/protected-page";
import { apiJson, messageOf, sendJson } from "../../../lib/api";
import { Capability } from "../../../lib/capabilities";
import { formatInstant, titleCase } from "../../../lib/format";
import { formatCents } from "../../../lib/money";
import type { InvoiceDetail, InvoiceStatus } from "../../../lib/types";
import { useResource } from "../../../lib/use-resource";

const TONE: Record<InvoiceStatus, string> = { UNPAID: "amber", PAID: "green", VOID: "grey" };

function InvoiceContent() {
  const { id } = useParams<{ id: string }>();
  const { data: invoice, error: loadError, reload } = useResource<InvoiceDetail>(`/billing/invoices/${id}`);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function act(path: string, body?: object) {
    setBusy(true); setError("");
    try { await apiJson(`/billing/invoices/${id}/${path}`, sendJson("POST", body)); reload(); } catch (caught) { setError(messageOf(caught, "Could not update the invoice.")); reload(); } finally { setBusy(false); }
  }
  if (loadError) return <AppShell><main className="content-page"><p className="form-error">{loadError}</p></main></AppShell>;
  if (!invoice) return <AppShell><main className="content-page"><p className="muted">Loading invoice...</p></main></AppShell>;
  const voidIt = () => { const reason = window.prompt("Why is this invoice being voided? Its orders become invoiceable again. (required)"); if (reason?.trim()) void act("void", { reason: reason.trim() }); };
  return <AppShell><main className="content-page wide">
    <BackLink href={`/billing/companies/${invoice.company.id}`} label={`Back to ${invoice.company.name}`} />
    <div className="page-heading">
      <div><p className="eyebrow">Invoice</p><h1>{invoice.number} <span className={`badge ${TONE[invoice.status]}`}>{titleCase(invoice.status)}</span></h1><p className="hint">{invoice.company.name} · billing contact {invoice.company.billingContactName} ({invoice.company.billingContactEmail}) · issued {formatInstant(invoice.issuedAt)} by {invoice.createdBy.name}</p></div>
      {invoice.status === "UNPAID" ? <div className="form-actions"><button className="primary-button" disabled={busy} onClick={() => void act("pay")} type="button">Mark paid</button><button className="danger-button" disabled={busy} onClick={voidIt} type="button">Void</button></div> : null}
    </div>
    {error ? <p aria-live="polite" className="form-error">{error}</p> : null}
    {invoice.status === "PAID" ? <p className="notice">Paid {formatInstant(invoice.paidAt)}{invoice.paidBy ? ` (recorded by ${invoice.paidBy.name})` : ""}. A paid invoice is final: later cancellations, rejections or short deliveries are credited on the company&apos;s next invoice.</p> : null}
    {invoice.status === "VOID" ? <p className="notice">Voided {formatInstant(invoice.voidedAt)}{invoice.voidedBy ? ` by ${invoice.voidedBy.name}` : ""}: {invoice.voidReason}. Its orders can be invoiced again.</p> : null}
    <section className="panel"><div className="table-wrap"><table className="data-table"><thead><tr><th>Line</th><th>Amount</th></tr></thead><tbody>
      {invoice.lines.map((line) => <tr key={line.id}><td>{line.orderId && line.type === "ORDER" ? <Link className="link" href={`/orders/${line.orderId}`}>{line.description}</Link> : line.description}</td><td className={line.amountCents < 0 ? "success-text" : ""}>{formatCents(line.amountCents)}</td></tr>)}
      <tr><td><strong>Total</strong></td><td><strong>{formatCents(invoice.totalCents)}</strong></td></tr>
    </tbody></table></div>
    <p className="hint">The total always equals the sum of its lines ({formatCents(invoice.linesTotalCents)}). Order lines are never edited after issue; changes appear as credit lines.</p></section>
  </main></AppShell>;
}

export default function InvoicePage() { return <ProtectedPage requires={[Capability.BILLING_MANAGE]}><InvoiceContent /></ProtectedPage>; }
