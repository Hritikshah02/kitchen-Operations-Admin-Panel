"use client";

import Link from "next/link";
import { useState } from "react";
import { AppShell } from "../components/app-shell";
import { Pagination } from "../components/form-controls";
import { ProtectedPage } from "../components/protected-page";
import { Capability } from "../lib/capabilities";
import type { CompanySummary, Employee, Page } from "../lib/types";
import { useResource } from "../lib/use-resource";

const PAGE_SIZE = 25;

function EmployeesContent() {
  const { data: companies } = useResource<Page<CompanySummary>>("/companies?pageSize=100&includeInactive=true");
  const [search, setSearch] = useState(""); const [companyId, setCompanyId] = useState(""); const [includeInactive, setIncludeInactive] = useState(false); const [page, setPage] = useState(1);
  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), includeInactive: String(includeInactive), ...(search.trim() ? { search: search.trim() } : {}), ...(companyId ? { companyId } : {}) });
  const { data, error, loading } = useResource<Page<Employee>>(`/employees?${query}`);
  const flags = (employee: Employee) => [employee.canChooseAddress && "address", employee.canChangeDeliveryTime && "time", employee.canChangePackaging && "packaging"].filter(Boolean).join(", ") || "—";

  return <AppShell><main className="content-page wide">
    <div className="page-heading"><div><p className="eyebrow">Administration</p><h1>Employees</h1></div></div>
    <p className="hint">Employees are added from their company&apos;s page, so their email always matches a company domain.</p>
    <section className="panel">
      <div className="toolbar">
        <label>Search<input onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Name or email" value={search} /></label>
        <label>Company<select onChange={(event) => { setCompanyId(event.target.value); setPage(1); }} value={companyId}><option value="">All companies</option>{companies?.items.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
        <label className="check"><input checked={includeInactive} onChange={(event) => { setIncludeInactive(event.target.checked); setPage(1); }} type="checkbox" />Show deactivated</label>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      {loading && !data ? <p className="muted">Loading employees...</p> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Name</th><th>Company</th><th>Email</th><th>May change</th><th>Allergies</th><th>Preferences</th></tr></thead><tbody>
        {data?.items.map((employee) => <tr className={employee.isActive ? "" : "inactive"} key={employee.id}>
          <td><Link className="link" href={`/employees/${employee.id}`}>{employee.name}</Link>{employee.isOwner ? <span className="badge green" style={{ marginLeft: 6 }}>Owner</span> : null}</td>
          <td><Link className="link" href={`/companies/${employee.company.id}`}>{employee.company.name}</Link></td>
          <td>{employee.email}</td><td>{flags(employee)}</td>
          <td>{employee.allergens.map((entry) => entry.name).join(", ") || "—"}</td>
          <td>{employee.dietaryTags.map((entry) => entry.name).join(", ") || "—"}</td>
        </tr>)}
        {data && !data.items.length ? <tr><td className="muted" colSpan={6}>No employees match.</td></tr> : null}
      </tbody></table></div>}
      {data ? <Pagination noun="employees" onPage={setPage} page={data.page} pageSize={data.pageSize} total={data.total} /> : null}
    </section>
  </main></AppShell>;
}

export default function EmployeesPage() { return <ProtectedPage requires={[Capability.COMPANIES_MANAGE]}><EmployeesContent /></ProtectedPage>; }
