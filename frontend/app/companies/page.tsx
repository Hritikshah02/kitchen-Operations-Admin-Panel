"use client";

import Link from "next/link";
import { useState } from "react";
import { AppShell } from "../components/app-shell";
import { Avatar, Pagination } from "../components/form-controls";
import { ProtectedPage } from "../components/protected-page";
import { Capability } from "../lib/capabilities";
import type { CompanySummary, Page } from "../lib/types";
import { useResource } from "../lib/use-resource";

const PAGE_SIZE = 20;

function CompaniesContent() {
  const [search, setSearch] = useState(""); const [includeInactive, setIncludeInactive] = useState(false); const [page, setPage] = useState(1);
  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), includeInactive: String(includeInactive), ...(search.trim() ? { search: search.trim() } : {}) });
  const { data, error, loading } = useResource<Page<CompanySummary>>(`/companies?${query}`);

  return <AppShell><main className="content-page wide">
    <div className="page-heading"><h1>Companies</h1><Link className="primary-button" href="/companies/new">New company</Link></div>
    <section className="panel">
      <div className="toolbar">
        <label>Search<input onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Name or email domain" value={search} /></label>
        <label className="check"><input checked={includeInactive} onChange={(event) => { setIncludeInactive(event.target.checked); setPage(1); }} type="checkbox" />Show deactivated</label>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      {loading && !data ? <p className="muted">Loading companies...</p> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Company</th><th>Email domains</th><th>Owner</th><th>Default address</th><th>Employees</th><th>Delivery</th><th>Status</th></tr></thead><tbody>
        {data?.items.map((company) => <tr className={company.isActive ? "" : "inactive"} key={company.id}>
          <td><div className="cell-person"><Avatar name={company.name} small /><Link className="link" href={`/companies/${company.id}`}>{company.name}</Link></div></td>
          <td>{company.domains.map((domain) => `@${domain}`).join(", ")}</td>
          <td>{company.owner?.name ?? <span className="badge amber">No owner</span>}</td>
          <td>{company.defaultAddress ? `${company.defaultAddress.label}${company.defaultAddress.area ? `, ${company.defaultAddress.area}` : ""}` : <span className="badge amber">None</span>}</td>
          <td>{company.activeEmployees}</td>
          <td>{company.defaultDeliveryTime}</td>
          <td>{company.isActive ? <span className="badge green">Active</span> : <span className="badge grey">Deactivated</span>}</td>
        </tr>)}
        {data && !data.items.length ? <tr><td className="muted" colSpan={7}>No companies match.</td></tr> : null}
      </tbody></table></div>}
      {data ? <Pagination noun="companies" onPage={setPage} page={data.page} pageSize={data.pageSize} total={data.total} /> : null}
    </section>
  </main></AppShell>;
}

export default function CompaniesPage() { return <ProtectedPage requires={[Capability.COMPANIES_MANAGE]}><CompaniesContent /></ProtectedPage>; }
