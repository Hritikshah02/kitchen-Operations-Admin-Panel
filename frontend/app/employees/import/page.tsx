"use client";

import Link from "next/link";
import { useState } from "react";
import { AppShell } from "../../components/app-shell";
import { BackLink } from "../../components/back-link";
import { ProtectedPage } from "../../components/protected-page";
import { apiJson, messageOf, sendJson } from "../../lib/api";
import { Capability } from "../../lib/capabilities";
import type { CompanySummary, Page } from "../../lib/types";
import { useResource } from "../../lib/use-resource";

type Report = {
  company: string; dryRun: boolean; total: number; valid: number; imported: number; failed: number;
  failures: { line: number; email: string; name: string; errors: string[] }[]; fileErrors: string[]; ignoredColumns: string[];
};

const TEMPLATE = "name,email,phone,allergies,dietary preferences,can choose address,can change delivery time,can change packaging\nAsha Nair,asha.nair@example.com,+91 90000 01101,Peanuts;Milk,Jain,no,no,no\n";

function ImportContent() {
  const { data: companies } = useResource<Page<CompanySummary>>("/companies?pageSize=100");
  const [companyId, setCompanyId] = useState(""); const [fileName, setFileName] = useState(""); const [csv, setCsv] = useState("");
  const [report, setReport] = useState<Report | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState("");

  async function onFile(file: File | undefined) {
    setReport(null); setError("");
    if (!file) return;
    if (file.size > 90_000) { setError("That file is too large. Import up to 500 employees at a time (under 90 KB)."); return; }
    setFileName(file.name); setCsv(await file.text());
  }
  async function run(dryRun: boolean) {
    setBusy(true); setError("");
    try { setReport(await apiJson<Report>("/employees/import", sendJson("POST", { companyId: Number(companyId), csv, dryRun }))); }
    catch (caught) { setError(messageOf(caught, "Could not read the file.")); }
    finally { setBusy(false); }
  }
  const download = () => { const url = URL.createObjectURL(new Blob([TEMPLATE], { type: "text/csv" })); const link = document.createElement("a"); link.href = url; link.download = "employees-template.csv"; link.click(); URL.revokeObjectURL(url); };

  return <AppShell><main className="content-page">
    <BackLink href="/employees" label="Back to employees" />
    <h1>Import employees</h1>
    <section className="panel form-stack">
      <label>Company<select onChange={(event) => { setCompanyId(event.target.value); setReport(null); }} value={companyId}><option value="">Choose a company...</option>{companies?.items.filter((company) => company.isActive).map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
      <label>CSV file<input accept=".csv,text/csv" onChange={(event) => void onFile(event.target.files?.[0])} type="file" /></label>
      <p className="hint">Needs <strong>name</strong> and <strong>email</strong> columns (emails must use the company&apos;s domains). Optional: phone, allergies and dietary preferences (separate several with ;), and yes/no columns for can choose address, can change delivery time, can change packaging. <button className="link-button" onClick={download} type="button">Download a template</button></p>
      {error ? <p aria-live="polite" className="form-error">{error}</p> : null}
      <div className="form-actions">
        <button className="secondary-button" disabled={busy || !companyId || !csv} onClick={() => void run(true)} type="button">{busy ? "Checking..." : "Check file"}</button>
        {report && report.dryRun && report.valid > 0 ? <button className="primary-button" disabled={busy} onClick={() => void run(false)} type="button">Import {report.valid} valid row{report.valid === 1 ? "" : "s"}</button> : null}
        {fileName ? <span className="hint">{fileName}</span> : null}
      </div>
    </section>
    {report ? <section className="panel" aria-live="polite">
      {report.fileErrors.length ? <p className="form-error">{report.fileErrors.join(" ")}</p> : <>
        <h2>{report.dryRun ? "Check result" : "Import result"}: {report.company}</h2>
        <p>{report.dryRun ? <><strong>{report.valid}</strong> of {report.total} rows are ready to import</> : <><strong className="success-text">{report.imported} imported</strong>, {report.failed} skipped</>}{report.dryRun && report.failed ? <>, <strong>{report.failed}</strong> need fixing</> : null}.</p>
        {report.ignoredColumns.length ? <p className="hint">Ignored columns: {report.ignoredColumns.join(", ")}</p> : null}
        {report.failures.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Line</th><th>Row</th><th>Problem</th></tr></thead><tbody>
          {report.failures.map((failure) => <tr key={failure.line}><td>{failure.line}</td><td>{failure.name || "—"}<div className="hint">{failure.email}</div></td><td>{failure.errors.join(" ")}</td></tr>)}
        </tbody></table></div> : null}
        {!report.dryRun && report.imported ? <p><Link className="link" href="/employees">View employees</Link></p> : null}
      </>}
    </section> : null}
  </main></AppShell>;
}

export default function ImportEmployeesPage() { return <ProtectedPage requires={[Capability.COMPANIES_MANAGE]}><ImportContent /></ProtectedPage>; }
