"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { type FormEvent, useState } from "react";
import { AppShell } from "../../components/app-shell";
import { BackLink } from "../../components/back-link";
import { formatDate, Pagination, WeekdayPicker } from "../../components/form-controls";
import { ProtectedPage } from "../../components/protected-page";
import { apiJson, messageOf, sendJson } from "../../lib/api";
import { Capability } from "../../lib/capabilities";
import type { CompanyDetail, Employee, Option, Page } from "../../lib/types";
import { useResource } from "../../lib/use-resource";

type Mutate = (action: () => Promise<unknown>, success?: string) => Promise<boolean>;
const emptyToNull = (value: string) => value.trim() || null;

/** One busy/error/notice state per page; every section mutates through it and the page reloads the company. */
function useMutations(onDone: () => void) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const mutate: Mutate = async (action, success) => {
    setBusy(true); setError(""); setNotice("");
    try { await action(); onDone(); if (success) setNotice(success); return true; }
    catch (caught) { setError(messageOf(caught, "Something went wrong.")); return false; }
    finally { setBusy(false); }
  };
  return { busy, error, notice, mutate };
}

function ProfileSection({ company, employees, mutate, busy }: { company: CompanyDetail; employees: Option[]; mutate: Mutate; busy: boolean }) {
  const [form, setForm] = useState({ name: company.name, billingContactName: company.billingContactName, billingContactEmail: company.billingContactEmail, billingContactPhone: company.billingContactPhone ?? "", ownerId: String(company.owner?.id ?? "") });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value });
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void mutate(() => apiJson(`/companies/${company.id}`, sendJson("PATCH", { ...form, billingContactPhone: emptyToNull(form.billingContactPhone), ...(form.ownerId ? { ownerId: Number(form.ownerId) } : { ownerId: undefined }) })), "Company details saved.");
  };
  return <form className="panel" onSubmit={save}><fieldset className="panel-fieldset" disabled={busy}>
    <h2>Profile &amp; billing</h2>
    <label>Company name<input maxLength={120} onChange={set("name")} required value={form.name} /></label>
    <label>Owner<select onChange={set("ownerId")} required value={form.ownerId}><option value="">Choose an employee</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select><span className="hint">Must be an active employee of this company</span></label>
    <label>Billing contact<input maxLength={80} onChange={set("billingContactName")} required value={form.billingContactName} /></label>
    <label>Billing email<input onChange={set("billingContactEmail")} required type="email" value={form.billingContactEmail} /></label>
    <label>Billing phone<input onChange={set("billingContactPhone")} value={form.billingContactPhone} /></label>
    <div className="form-actions"><button className="primary-button" type="submit">Save details</button></div>
  </fieldset></form>;
}

function DeliverySection({ company, mutate, busy }: { company: CompanyDetail; mutate: Mutate; busy: boolean }) {
  const { data: drivers } = useResource<Option[]>("/companies/driver-options");
  const { data: packaging } = useResource<Option[]>("/reference-data/packaging-types");
  const [form, setForm] = useState({
    workingDays: company.workingDays, deliveryWindowStart: company.deliveryWindowStart, deliveryWindowEnd: company.deliveryWindowEnd, defaultDeliveryTime: company.defaultDeliveryTime,
    dispatchLeadMinutes: String(company.dispatchLeadMinutes), defaultPackagingTypeId: String(company.defaultPackagingTypeId ?? ""), defaultDriverId: String(company.defaultDriverId ?? ""), driverInstructions: company.driverInstructions ?? "",
  });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value });
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void mutate(() => apiJson(`/companies/${company.id}`, sendJson("PATCH", {
      ...form, dispatchLeadMinutes: Number(form.dispatchLeadMinutes), driverInstructions: emptyToNull(form.driverInstructions),
      defaultPackagingTypeId: form.defaultPackagingTypeId ? Number(form.defaultPackagingTypeId) : null, defaultDriverId: form.defaultDriverId ? Number(form.defaultDriverId) : null,
    })), "Delivery defaults saved.");
  };
  return <form className="panel" onSubmit={save}><fieldset className="panel-fieldset" disabled={busy}>
    <h2>Delivery defaults</h2>
    <WeekdayPicker legend="Accepts deliveries on" onChange={(workingDays) => setForm({ ...form, workingDays })} value={form.workingDays} />
    <p className="hint">Orders can only be placed for days the kitchen is open and the company accepts deliveries. The company calendar never moves the cut-off.</p>
    <div className="form-grid">
      <label>Window from<input onChange={set("deliveryWindowStart")} required type="time" value={form.deliveryWindowStart} /></label>
      <label>Window to<input onChange={set("deliveryWindowEnd")} required type="time" value={form.deliveryWindowEnd} /></label>
      <label>Default time<input onChange={set("defaultDeliveryTime")} required type="time" value={form.defaultDeliveryTime} /></label>
      <label>Leaves kitchen (min before)<input min={0} max={480} onChange={set("dispatchLeadMinutes")} required type="number" value={form.dispatchLeadMinutes} /></label>
    </div>
    <p className="hint">Employees allowed to change the delivery time pick inside the window.</p>
    <div className="form-grid">
      <label>Default packaging<select onChange={set("defaultPackagingTypeId")} value={form.defaultPackagingTypeId}><option value="">None</option>{packaging?.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
      <label>Default driver<select onChange={set("defaultDriverId")} value={form.defaultDriverId}><option value="">None</option>{drivers?.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
    </div>
    {company.defaultDriver && !company.defaultDriver.isActive ? <p className="notice">The default driver {company.defaultDriver.name} has been deactivated. Pick another.</p> : null}
    <label>Standing instructions for the driver<textarea maxLength={500} onChange={set("driverInstructions")} value={form.driverInstructions} /></label>
    <div className="form-actions"><button className="primary-button" type="submit">Save delivery defaults</button></div>
  </fieldset></form>;
}

function DomainsSection({ company, mutate, busy }: { company: CompanyDetail; mutate: Mutate; busy: boolean }) {
  const [domain, setDomain] = useState("");
  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (await mutate(() => apiJson(`/companies/${company.id}/domains`, sendJson("POST", { domain: domain.replace(/^@/, "") })), `@${domain.replace(/^@/, "")} added.`)) setDomain("");
  };
  return <section className="panel">
    <h2>Email domains</h2>
    <p className="hint">Employee emails must use one of these. A domain can belong to only one company.</p>
    <div className="table-wrap"><table className="data-table"><tbody>
      {company.domains.map((entry) => <tr key={entry.id}><td>@{entry.domain}</td><td><div className="row-actions"><button className="danger-button" disabled={busy || company.domains.length < 2} onClick={() => void mutate(() => apiJson(`/companies/${company.id}/domains/${entry.id}`, sendJson("DELETE")), `@${entry.domain} removed.`)} type="button">Remove</button></div></td></tr>)}
    </tbody></table></div>
    <form className="form-actions" onSubmit={add}><input aria-label="New domain" disabled={busy} onChange={(event) => setDomain(event.target.value)} placeholder="acme.com" required value={domain} /><button className="secondary-button" disabled={busy} type="submit">Add domain</button></form>
  </section>;
}

function AddressesSection({ company, mutate, busy }: { company: CompanyDetail; mutate: Mutate; busy: boolean }) {
  const empty = { label: "", line1: "", line2: "", area: "", city: "Ahmedabad", pincode: "" };
  const [draft, setDraft] = useState(empty); const [adding, setAdding] = useState(false);
  const set = (key: keyof typeof empty) => (event: { target: { value: string } }) => setDraft({ ...draft, [key]: event.target.value });
  const patch = (addressId: number, body: object, success: string) => mutate(() => apiJson(`/companies/${company.id}/addresses/${addressId}`, sendJson("PATCH", body)), success);
  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (await mutate(() => apiJson(`/companies/${company.id}/addresses`, sendJson("POST", { ...draft, line2: emptyToNull(draft.line2), area: emptyToNull(draft.area) })), `${draft.label} added.`)) { setDraft(empty); setAdding(false); }
  };
  return <section className="panel">
    <div className="panel-heading"><h2>Delivery addresses</h2>{!adding ? <button className="secondary-button" onClick={() => setAdding(true)} type="button">Add address</button> : null}</div>
    <p className="hint">Orders go to the default address unless the employee may choose another active one. Addresses are deactivated, never deleted, so past orders keep theirs.</p>
    <div className="table-wrap"><table className="data-table"><thead><tr><th>Label</th><th>Address</th><th>Status</th><th /></tr></thead><tbody>
      {company.addresses.map((address) => <tr className={address.isActive ? "" : "inactive"} key={address.id}>
        <td><strong>{address.label}</strong></td>
        <td>{[address.line1, address.line2, address.area, `${address.city} ${address.pincode}`].filter(Boolean).join(", ")}</td>
        <td>{address.isDefault ? <span className="badge green">Default</span> : address.isActive ? <span className="badge grey">Active</span> : <span className="badge grey">Inactive</span>}</td>
        <td><div className="row-actions">
          {!address.isDefault && address.isActive ? <button className="secondary-button" disabled={busy} onClick={() => void patch(address.id, { isDefault: true }, `${address.label} is now the default.`)} type="button">Make default</button> : null}
          {!address.isDefault ? <button className={address.isActive ? "danger-button" : "secondary-button"} disabled={busy} onClick={() => void patch(address.id, { isActive: !address.isActive }, `${address.label} ${address.isActive ? "deactivated" : "reactivated"}.`)} type="button">{address.isActive ? "Deactivate" : "Reactivate"}</button> : null}
        </div></td>
      </tr>)}
    </tbody></table></div>
    {adding ? <form className="form-grid" onSubmit={add}>
      <label>Label<input disabled={busy} maxLength={40} onChange={set("label")} required value={draft.label} /></label>
      <label>Address line 1<input disabled={busy} maxLength={120} onChange={set("line1")} required value={draft.line1} /></label>
      <label>Address line 2<input disabled={busy} maxLength={120} onChange={set("line2")} value={draft.line2} /></label>
      <label>Area<input disabled={busy} maxLength={60} onChange={set("area")} value={draft.area} /></label>
      <label>City<input disabled={busy} maxLength={60} onChange={set("city")} required value={draft.city} /></label>
      <label>PIN code<input disabled={busy} inputMode="numeric" onChange={set("pincode")} pattern="[0-9]{6}" required value={draft.pincode} /></label>
      <div className="form-actions"><button className="primary-button" disabled={busy} type="submit">Save address</button><button className="secondary-button" onClick={() => setAdding(false)} type="button">Cancel</button></div>
    </form> : null}
  </section>;
}

function HolidaysSection({ company, mutate, busy }: { company: CompanyDetail; mutate: Mutate; busy: boolean }) {
  const [date, setDate] = useState(""); const [name, setName] = useState("");
  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (await mutate(() => apiJson(`/companies/${company.id}/holidays`, sendJson("POST", { date, name })), `${name} added.`)) { setDate(""); setName(""); }
  };
  return <section className="panel">
    <h2>Company holidays</h2>
    <p className="hint">No deliveries to this company on these dates. Kitchen holidays are managed in Settings.</p>
    {company.holidays.length ? <div className="table-wrap"><table className="data-table"><tbody>
      {company.holidays.map((holiday) => <tr key={holiday.id}><td>{formatDate(holiday.date)}</td><td>{holiday.name}</td><td><div className="row-actions"><button className="danger-button" disabled={busy} onClick={() => void mutate(() => apiJson(`/companies/${company.id}/holidays/${holiday.id}`, sendJson("DELETE")), `${holiday.name} removed.`)} type="button">Remove</button></div></td></tr>)}
    </tbody></table></div> : <p className="muted">No company holidays.</p>}
    <form className="form-grid" onSubmit={add}>
      <label>Date<input disabled={busy} onChange={(event) => setDate(event.target.value)} required type="date" value={date} /></label>
      <label>Name<input disabled={busy} maxLength={80} onChange={(event) => setName(event.target.value)} required value={name} /></label>
      <div className="form-actions"><button className="secondary-button" disabled={busy} type="submit">Add holiday</button></div>
    </form>
  </section>;
}

function EmployeesSection({ company, version, mutate, busy }: { company: CompanyDetail; version: string; mutate: Mutate; busy: boolean }) {
  const [page, setPage] = useState(1);
  const { data } = useResource<Page<Employee>>(`/employees?companyId=${company.id}&page=${page}&pageSize=15&includeInactive=true`, version);
  const [draft, setDraft] = useState({ name: "", email: "" });
  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (await mutate(() => apiJson("/employees", sendJson("POST", { companyId: company.id, ...draft })), `${draft.name} added.`)) setDraft({ name: "", email: "" });
  };
  const flags = (employee: Employee) => [employee.canChooseAddress && "address", employee.canChangeDeliveryTime && "time", employee.canChangePackaging && "packaging"].filter(Boolean).join(", ") || "—";
  return <section className="panel">
    <div className="panel-heading"><h2>Employees</h2><span className="hint">{company.activeEmployees} active</span></div>
    {company.isActive ? <form className="form-grid" onSubmit={add}>
      <label>Name<input disabled={busy} maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required value={draft.name} /></label>
      <label>Email<input disabled={busy} onChange={(event) => setDraft({ ...draft, email: event.target.value })} placeholder={`name@${company.domains[0]?.domain ?? "company.com"}`} required type="email" value={draft.email} /></label>
      <div className="form-actions"><button className="secondary-button" disabled={busy} type="submit">Add employee</button></div>
    </form> : null}
    <div className="table-wrap"><table className="data-table"><thead><tr><th>Name</th><th>Email</th><th>May change</th><th>Allergies</th><th>Preferences</th></tr></thead><tbody>
      {data?.items.map((employee) => <tr className={employee.isActive ? "" : "inactive"} key={employee.id}>
        <td><Link className="link" href={`/employees/${employee.id}`}>{employee.name}</Link>{employee.isOwner ? <span className="badge green" style={{ marginLeft: 6 }}>Owner</span> : null}{!employee.isActive ? <span className="badge grey" style={{ marginLeft: 6 }}>Inactive</span> : null}</td>
        <td>{employee.email}</td><td>{flags(employee)}</td>
        <td>{employee.allergens.map((entry) => entry.name).join(", ") || "—"}</td>
        <td>{employee.dietaryTags.map((entry) => entry.name).join(", ") || "—"}</td>
      </tr>)}
      {data && !data.items.length ? <tr><td className="muted" colSpan={5}>No employees yet.</td></tr> : null}
    </tbody></table></div>
    {data ? <Pagination noun="employees" onPage={setPage} page={data.page} pageSize={data.pageSize} total={data.total} /> : null}
  </section>;
}

function CompanyContent() {
  const { id } = useParams<{ id: string }>();
  const { data: company, error: loadError, reload } = useResource<CompanyDetail>(`/companies/${id}`);
  const { data: employeeOptions } = useResource<Page<Employee>>(company ? `/employees?companyId=${id}&pageSize=100` : null, `${company?.updatedAt}-${company?.activeEmployees}`);
  const { busy, error, notice, mutate } = useMutations(reload);

  if (loadError) return <AppShell><main className="content-page"><p className="form-error">{loadError}</p><Link className="link" href="/companies">Back to companies</Link></main></AppShell>;
  if (!company) return <AppShell><main className="content-page"><p className="muted">Loading company...</p></main></AppShell>;

  async function toggleActive() {
    if (!company) return;
    if (company.isActive && !window.confirm(`Deactivate ${company.name}?\n\nIt will be hidden from ordering. Draft and placed orders still before cut-off will be cancelled. Orders past cut-off are locked: they will still be confirmed and billed to the company.`)) return;
    await mutate(async () => {
      const result = await apiJson<CompanyDetail>(`/companies/${company.id}/${company.isActive ? "deactivate" : "reactivate"}`, sendJson("POST"));
      if (!result.isActive) window.alert(`${company.name} deactivated — ${result.cancelledOrders ?? 0} open order(s) cancelled${result.lockedOrdersKept ? `, ${result.lockedOrdersKept} past cut-off kept and still billable` : ""}.`);
    }, company.isActive ? `${company.name} deactivated.` : `${company.name} reactivated.`);
  }

  // Re-key the editable sections on updatedAt so they pick up saved values without effect-driven state sync.
  const key = company.updatedAt;
  return <AppShell><main className="content-page wide">
    <BackLink href="/companies" label="Back to companies" />
    <div className="page-heading">
      <div><p className="eyebrow"><Link className="link" href="/companies">Companies</Link></p><h1>{company.name}</h1></div>
      <div className="form-actions">{company.isActive ? <span className="badge green">Active</span> : <span className="badge grey">Deactivated</span>}<button className={company.isActive ? "danger-button" : "secondary-button"} disabled={busy} onClick={() => void toggleActive()} type="button">{company.isActive ? "Deactivate company" : "Reactivate company"}</button></div>
    </div>
    {!company.owner ? <p className="notice">This company has no owner yet. Add an employee, then pick them as owner.</p> : null}
    {error ? <p aria-live="polite" className="form-error">{error}</p> : null}
    {notice ? <p aria-live="polite" className="success-text">{notice}</p> : null}
    <div className="section-grid">
      <ProfileSection busy={busy} company={company} employees={employeeOptions?.items ?? []} key={`profile-${key}-${employeeOptions?.total ?? 0}`} mutate={mutate} />
      <DeliverySection busy={busy} company={company} key={`delivery-${key}`} mutate={mutate} />
    </div>
    <div className="section-grid">
      <DomainsSection busy={busy} company={company} mutate={mutate} />
      <HolidaysSection busy={busy} company={company} mutate={mutate} />
    </div>
    <AddressesSection busy={busy} company={company} mutate={mutate} />
    <EmployeesSection busy={busy} company={company} mutate={mutate} version={`${key}-${company.activeEmployees}`} />
  </main></AppShell>;
}

export default function CompanyPage() { return <ProtectedPage requires={[Capability.COMPANIES_MANAGE]}><CompanyContent /></ProtectedPage>; }
