"use client";

import { useState } from "react";
import type { CompanySummary, Employee, Page } from "../lib/types";
import { useResource } from "../lib/use-resource";

/** Company → employee picker used by the menu preview and the order builder. */
export function EmployeePicker({ value, onChange, disabled }: { value: number | null; onChange: (employee: Employee | null) => void; disabled?: boolean }) {
  const { data: companies } = useResource<Page<CompanySummary>>("/companies?pageSize=100");
  const [companyId, setCompanyId] = useState(""); const [search, setSearch] = useState("");
  const query = new URLSearchParams({ pageSize: "100", ...(companyId ? { companyId } : {}), ...(search.trim() ? { search: search.trim() } : {}) });
  const { data: employees } = useResource<Page<Employee>>(companyId || search.trim() ? `/employees?${query}` : null);
  return <div className="form-grid">
    <label>Company<select disabled={disabled} onChange={(event) => { setCompanyId(event.target.value); onChange(null); }} value={companyId}><option value="">Any company</option>{companies?.items.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
    <label>Find employee<input disabled={disabled} onChange={(event) => setSearch(event.target.value)} placeholder="Name or email" value={search} /></label>
    <label>Employee<select disabled={disabled || !employees} onChange={(event) => onChange(employees?.items.find((employee) => employee.id === Number(event.target.value)) ?? null)} value={value ?? ""}>
      <option value="">{employees ? `Choose (${employees.total})` : "Pick a company or search"}</option>
      {employees?.items.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} — {employee.company.name}</option>)}
    </select></label>
  </div>;
}
