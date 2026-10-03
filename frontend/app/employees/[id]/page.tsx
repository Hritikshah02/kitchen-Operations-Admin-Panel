"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { type FormEvent, useState } from "react";
import { AppShell } from "../../components/app-shell";
import { BackLink } from "../../components/back-link";
import { ChipSelect } from "../../components/form-controls";
import { ProtectedPage } from "../../components/protected-page";
import { apiJson, messageOf, sendJson } from "../../lib/api";
import { Capability } from "../../lib/capabilities";
import type { CompanySummary, Employee, Option, Page } from "../../lib/types";
import { useResource } from "../../lib/use-resource";

function EditForm({ employee, onSaved }: { employee: Employee; onSaved: (message: string) => void }) {
  const { data: allergens } = useResource<Option[]>("/reference-data/allergens");
  const { data: tags } = useResource<Option[]>("/reference-data/dietary-tags");
  const [form, setForm] = useState({
    name: employee.name, email: employee.email, phone: employee.phone ?? "",
    canChooseAddress: employee.canChooseAddress, canChangeDeliveryTime: employee.canChangeDeliveryTime, canChangePackaging: employee.canChangePackaging,
    allergenIds: employee.allergens.map((entry) => entry.id), dietaryTagIds: employee.dietaryTags.map((entry) => entry.id),
  });
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const flag = (key: "canChooseAddress" | "canChangeDeliveryTime" | "canChangePackaging") => (event: { target: { checked: boolean } }) => setForm({ ...form, [key]: event.target.checked });

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try { await apiJson(`/employees/${employee.id}`, sendJson("PATCH", { ...form, phone: form.phone.trim() || null })); onSaved("Employee saved."); }
    catch (caught) { setError(messageOf(caught, "Could not save employee.")); }
    finally { setBusy(false); }
  }

  return <form className="panel" onSubmit={save}><fieldset className="panel-fieldset" disabled={busy}>
    <h2>Details</h2>
    <div className="form-grid">
      <label>Name<input maxLength={80} onChange={(event) => setForm({ ...form, name: event.target.value })} required value={form.name} /></label>
      <label>Email<input onChange={(event) => setForm({ ...form, email: event.target.value })} required type="email" value={form.email} /></label>
      <label>Phone<input onChange={(event) => setForm({ ...form, phone: event.target.value })} value={form.phone} /></label>
    </div>
    <fieldset className="chip-group"><legend>When ordering, this employee may</legend>
      <label className="chip"><input checked={form.canChooseAddress} onChange={flag("canChooseAddress")} type="checkbox" />Choose delivery address</label>
      <label className="chip"><input checked={form.canChangeDeliveryTime} onChange={flag("canChangeDeliveryTime")} type="checkbox" />Change delivery time</label>
      <label className="chip"><input checked={form.canChangePackaging} onChange={flag("canChangePackaging")} type="checkbox" />Change packaging</label>
    </fieldset>
    <ChipSelect legend="Allergies" onChange={(allergenIds) => setForm({ ...form, allergenIds })} options={allergens ?? []} value={form.allergenIds} />
    <ChipSelect legend="Dietary preferences" onChange={(dietaryTagIds) => setForm({ ...form, dietaryTagIds })} options={tags ?? []} value={form.dietaryTagIds} />
    {error ? <p aria-live="polite" className="form-error">{error}</p> : null}
    <div className="form-actions"><button className="primary-button" type="submit">{busy ? "Saving..." : "Save employee"}</button></div>
  </fieldset></form>;
}

type MoveResult = Employee & { cancelledOrders: number; lockedOrdersKept: number };
const NO_FLAGS = { canChooseAddress: false, canChangeDeliveryTime: false, canChangePackaging: false };

function MoveForm({ employee, onMoved }: { employee: Employee; onMoved: (message: string) => void }) {
  const { data: companies } = useResource<Page<CompanySummary>>("/companies?pageSize=100");
  const [companyId, setCompanyId] = useState(""); const [email, setEmail] = useState(""); const [flags, setFlags] = useState(NO_FLAGS);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const target = companies?.items.find((company) => String(company.id) === companyId);
  const pickCompany = (id: string) => {
    setCompanyId(id);
    const domain = companies?.items.find((company) => String(company.id) === id)?.domains[0];
    if (domain) setEmail(`${employee.email.split("@")[0]}@${domain}`);
  };
  const flag = (key: keyof typeof NO_FLAGS) => (event: { target: { checked: boolean } }) => setFlags({ ...flags, [key]: event.target.checked });

  async function move(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.confirm(`Move ${employee.name} to ${target?.name}?\n\nTheir draft and placed orders that are still before cut-off will be cancelled. Orders already past cut-off or confirmed stay with ${employee.company.name}.`)) return;
    setBusy(true); setError("");
    try {
      const result = await apiJson<MoveResult>(`/employees/${employee.id}/move`, sendJson("POST", { companyId: Number(companyId), email, ...flags }));
      const kept = result.lockedOrdersKept ? `, ${result.lockedOrdersKept} past cut-off kept on ${employee.company.name}` : "";
      onMoved(`${employee.name} moved to ${target?.name} — ${result.cancelledOrders} open order(s) cancelled${kept}.`);
    }
    catch (caught) { setError(messageOf(caught, "Could not move employee.")); }
    finally { setBusy(false); }
  }

  return <form className="panel" onSubmit={move}><fieldset className="panel-fieldset" disabled={busy || employee.isOwner || !employee.isActive}>
    <h2>Move to another company</h2>
    <p className="hint">The new company&apos;s domains, calendar, prices and menu apply from then on. Draft and placed orders still before cut-off are cancelled; orders past cut-off or confirmed stay billed to {employee.company.name}.</p>
    {employee.isOwner ? <p className="notice">{employee.name} owns {employee.company.name}. Choose another owner on the company page first.</p> : null}
    <div className="form-grid">
      <label>New company<select onChange={(event) => pickCompany(event.target.value)} required value={companyId}><option value="">Choose a company</option>{companies?.items.filter((company) => company.id !== employee.company.id).map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
      <label>New email<input onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />{target ? <span className="hint">Must end in {target.domains.map((domain) => `@${domain}`).join(" or ")}</span> : null}</label>
    </div>
    <fieldset className="chip-group"><legend>Permissions at the new company (start unticked)</legend>
      <label className="chip"><input checked={flags.canChooseAddress} onChange={flag("canChooseAddress")} type="checkbox" />Choose delivery address</label>
      <label className="chip"><input checked={flags.canChangeDeliveryTime} onChange={flag("canChangeDeliveryTime")} type="checkbox" />Change delivery time</label>
      <label className="chip"><input checked={flags.canChangePackaging} onChange={flag("canChangePackaging")} type="checkbox" />Change packaging</label>
    </fieldset>
    <div className="form-actions"><button className="secondary-button" type="submit">Move employee</button></div>
    {error ? <p aria-live="polite" className="form-error">{error}</p> : null}
  </fieldset></form>;
}

function EmployeeContent() {
  const { id } = useParams<{ id: string }>();
  const { data: employee, error: loadError, reload } = useResource<Employee>(`/employees/${id}`);
  const [notice, setNotice] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const done = (message: string) => { setNotice(message); setError(""); reload(); };

  if (loadError) return <AppShell><main className="content-page"><p className="form-error">{loadError}</p><Link className="link" href="/employees">Back to employees</Link></main></AppShell>;
  if (!employee) return <AppShell><main className="content-page"><p className="muted">Loading employee...</p></main></AppShell>;

  async function toggleActive() {
    if (!employee) return;
    setBusy(true); setError(""); setNotice("");
    try { await apiJson(`/employees/${employee.id}`, sendJson("PATCH", { isActive: !employee.isActive })); done(employee.isActive ? `${employee.name} deactivated.` : `${employee.name} reactivated.`); }
    catch (caught) { setError(messageOf(caught, "Could not update employee.")); }
    finally { setBusy(false); }
  }

  return <AppShell><main className="content-page">
    <BackLink href="/employees" label="Back" />
    <div className="page-heading">
      <div><p className="eyebrow"><Link className="link" href={`/companies/${employee.company.id}`}>{employee.company.name}</Link></p><h1>{employee.name}</h1></div>
      <div className="form-actions">
        {employee.isOwner ? <span className="badge green">Company owner</span> : null}
        {employee.isActive ? <span className="badge green">Active</span> : <span className="badge grey">Deactivated</span>}
        <button className={employee.isActive ? "danger-button" : "secondary-button"} disabled={busy || (employee.isActive && employee.isOwner)} onClick={() => void toggleActive()} type="button">{employee.isActive ? "Deactivate" : "Reactivate"}</button>
      </div>
    </div>
    {error ? <p aria-live="polite" className="form-error">{error}</p> : null}
    {notice ? <p aria-live="polite" className="success-text">{notice}</p> : null}
    {/* Re-keyed on updatedAt so the forms reset to the saved values once the reload arrives. */}
    <EditForm employee={employee} key={`edit-${employee.updatedAt}`} onSaved={done} />
    <MoveForm employee={employee} key={`move-${employee.updatedAt}`} onMoved={done} />
  </main></AppShell>;
}

export default function EmployeePage() { return <ProtectedPage requires={[Capability.COMPANIES_MANAGE]}><EmployeeContent /></ProtectedPage>; }
