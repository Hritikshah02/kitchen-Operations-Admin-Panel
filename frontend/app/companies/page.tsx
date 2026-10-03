"use client";

import { type FormEvent, useEffect, useState } from "react";
import { AppShell } from "../components/app-shell";
import { ProtectedPage } from "../components/protected-page";
import { ApiError, apiFetch } from "../lib/api";

type Company = { id: number; name: string; emailDomain: string };
function CompaniesContent() {
  const [companies, setCompanies] = useState<Company[]>([]); const [name, setName] = useState(""); const [emailDomain, setEmailDomain] = useState("");
  const [loading, setLoading] = useState(true); const [submitting, setSubmitting] = useState(false); const [error, setError] = useState("");
  async function fetchCompanies() { const response = await apiFetch("/companies"); setCompanies((await response.json()) as Company[]); }
  useEffect(() => {
    let cancelled = false;
    async function loadCompanies() {
      try {
        const response = await apiFetch("/companies");
        const data = (await response.json()) as Company[];
        if (!cancelled) setCompanies(data);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof ApiError ? caught.message : "Could not load companies.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadCompanies();
    return () => { cancelled = true; };
  }, []);
  async function addCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSubmitting(true);
    try { await apiFetch("/companies", { method: "POST", body: JSON.stringify({ name, emailDomain }) }); setName(""); setEmailDomain(""); await fetchCompanies(); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : "Could not add company."); }
    finally { setSubmitting(false); }
  }
  return <AppShell><main className="content-page">
    <div className="page-heading"><div><p className="eyebrow">Administration</p><h1>Companies</h1></div></div>
    <section className="company-form-section" aria-labelledby="add-company-heading"><h2 id="add-company-heading">Add company</h2>
      <form className="company-form" onSubmit={addCompany}>
        <label>Company name<input disabled={submitting} onChange={(event) => setName(event.target.value)} required value={name} /></label>
        <label>Email domain<input disabled={submitting} onChange={(event) => setEmailDomain(event.target.value)} placeholder="acme.com" required value={emailDomain} /></label>
        <button className="primary-button" disabled={submitting} type="submit">{submitting ? "Adding..." : "Add company"}</button>
      </form>{error ? <p aria-live="polite" className="form-error">{error}</p> : null}
    </section>
    <section aria-labelledby="company-list-heading"><h2 id="company-list-heading">Company list</h2>
      {loading ? <p className="muted">Loading companies...</p> : <div className="company-list">{companies.map((company) => <div className="company-row" key={company.id}><strong>{company.name}</strong><span>{company.emailDomain}</span></div>)}{!companies.length ? <p className="muted">No companies yet.</p> : null}</div>}
    </section>
  </main></AppShell>;
}
export default function CompaniesPage() { return <ProtectedPage allowedRoles={["ADMIN"]}><CompaniesContent /></ProtectedPage>; }
