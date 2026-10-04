"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { AppShell } from "../../components/app-shell";
import { BackLink } from "../../components/back-link";
import { WeekdayPicker } from "../../components/form-controls";
import { ProtectedPage } from "../../components/protected-page";
import { apiJson, messageOf, sendJson } from "../../lib/api";
import { Capability } from "../../lib/capabilities";
import type { CompanyDetail, Option } from "../../lib/types";
import { useResource } from "../../lib/use-resource";

const emptyToNull = (value: string) => value.trim() || null;

function NewCompanyContent() {
  const router = useRouter();
  const { data: settings } = useResource<{ defaultDispatchLeadMinutes: number }>("/settings");
  const { data: drivers } = useResource<Option[]>("/companies/driver-options");
  const { data: packaging } = useResource<Option[]>("/reference-data/packaging-types");
  const [form, setForm] = useState({
    name: "", domains: "", billingContactName: "", billingContactEmail: "", billingContactPhone: "",
    ownerName: "", ownerEmail: "", label: "Head office", line1: "", line2: "", area: "", city: "Ahmedabad", pincode: "",
    workingDays: [1, 2, 3, 4, 5], deliveryWindowStart: "12:00", deliveryWindowEnd: "14:00", defaultDeliveryTime: "12:30",
    dispatchLeadMinutes: "", defaultPackagingTypeId: "", defaultDriverId: "", driverInstructions: "",
  });
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const body = {
      name: form.name,
      domains: form.domains.split(/[\s,]+/).map((domain) => domain.replace(/^@/, "")).filter(Boolean),
      billingContactName: form.billingContactName, billingContactEmail: form.billingContactEmail, billingContactPhone: emptyToNull(form.billingContactPhone),
      owner: { name: form.ownerName, email: form.ownerEmail },
      address: { label: form.label, line1: form.line1, line2: emptyToNull(form.line2), area: emptyToNull(form.area), city: form.city, pincode: form.pincode },
      workingDays: form.workingDays, deliveryWindowStart: form.deliveryWindowStart, deliveryWindowEnd: form.deliveryWindowEnd, defaultDeliveryTime: form.defaultDeliveryTime,
      ...(form.dispatchLeadMinutes ? { dispatchLeadMinutes: Number(form.dispatchLeadMinutes) } : {}),
      defaultPackagingTypeId: form.defaultPackagingTypeId ? Number(form.defaultPackagingTypeId) : null,
      defaultDriverId: form.defaultDriverId ? Number(form.defaultDriverId) : null,
      driverInstructions: emptyToNull(form.driverInstructions),
    };
    try { const company = await apiJson<CompanyDetail>("/companies", sendJson("POST", body)); router.push(`/companies/${company.id}`); }
    catch (caught) { setError(messageOf(caught, "Could not create company.")); setBusy(false); }
  }

  return <AppShell><main className="content-page wide">
    <BackLink href="/companies" label="Back to companies" />
    <h1>New company</h1>
    <form className="form-stack" onSubmit={submit}><div className="section-grid">
      <fieldset className="panel" disabled={busy}>
        <h2>Company</h2>
        <label>Name<input maxLength={120} onChange={set("name")} required value={form.name} /></label>
        <label>Email domains<input onChange={set("domains")} placeholder="acme.in, acme.com" required value={form.domains} /><span className="hint">Comma-separated; unique to this company, no public providers.</span></label>
        <h2>Billing contact</h2>
        <label>Name<input maxLength={80} onChange={set("billingContactName")} required value={form.billingContactName} /></label>
        <label>Email<input onChange={set("billingContactEmail")} required type="email" value={form.billingContactEmail} /></label>
        <label>Phone<input onChange={set("billingContactPhone")} placeholder="+91 90000 01101" value={form.billingContactPhone} /></label>
        <h2>Owner</h2>
        <p className="hint">Created as the first employee; email must use a domain above.</p>
        <label>Name<input maxLength={80} onChange={set("ownerName")} required value={form.ownerName} /></label>
        <label>Email<input onChange={set("ownerEmail")} required type="email" value={form.ownerEmail} /></label>
      </fieldset>
      <fieldset className="panel" disabled={busy}>
        <h2>Default delivery address</h2>
        <label>Label<input maxLength={40} onChange={set("label")} required value={form.label} /></label>
        <label>Address line 1<input maxLength={120} onChange={set("line1")} placeholder="7th Floor, Tower name" required value={form.line1} /></label>
        <label>Address line 2<input maxLength={120} onChange={set("line2")} placeholder="Road" value={form.line2} /></label>
        <div className="form-grid">
          <label>Area<input maxLength={60} onChange={set("area")} placeholder="Bodakdev" value={form.area} /></label>
          <label>City<input maxLength={60} onChange={set("city")} required value={form.city} /></label>
          <label>PIN code<input inputMode="numeric" onChange={set("pincode")} pattern="[0-9]{6}" required value={form.pincode} /></label>
        </div>
        <h2>Delivery defaults</h2>
        <WeekdayPicker legend="Accepts deliveries on" onChange={(workingDays) => setForm({ ...form, workingDays })} value={form.workingDays} />
        <div className="form-grid">
          <label>Window from<input onChange={set("deliveryWindowStart")} required type="time" value={form.deliveryWindowStart} /></label>
          <label>Window to<input onChange={set("deliveryWindowEnd")} required type="time" value={form.deliveryWindowEnd} /></label>
          <label>Default time<input onChange={set("defaultDeliveryTime")} required type="time" value={form.defaultDeliveryTime} /></label>
          <label>Leaves kitchen (min before)<input min={0} max={480} onChange={set("dispatchLeadMinutes")} placeholder={String(settings?.defaultDispatchLeadMinutes ?? 60)} type="number" value={form.dispatchLeadMinutes} /></label>
        </div>
        <div className="form-grid">
          <label>Default packaging<select onChange={set("defaultPackagingTypeId")} value={form.defaultPackagingTypeId}><option value="">None</option>{packaging?.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
          <label>Default driver<select onChange={set("defaultDriverId")} value={form.defaultDriverId}><option value="">None</option>{drivers?.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
        </div>
        <label>Standing instructions for the driver<textarea maxLength={500} onChange={set("driverInstructions")} value={form.driverInstructions} /></label>
      </fieldset>
      </div>
      <div className="form-actions">
        {error ? <p aria-live="polite" className="form-error">{error}</p> : null}
        <button className="primary-button" disabled={busy} type="submit">{busy ? "Creating..." : "Create company"}</button>
      </div>
    </form>
  </main></AppShell>;
}

export default function NewCompanyPage() { return <ProtectedPage requires={[Capability.COMPANIES_MANAGE]}><NewCompanyContent /></ProtectedPage>; }
