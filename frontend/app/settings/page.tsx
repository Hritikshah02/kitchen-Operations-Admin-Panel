"use client";

import { type FormEvent, useState } from "react";
import { AppShell } from "../components/app-shell";
import { ProtectedPage } from "../components/protected-page";
import { apiJson, messageOf, sendJson } from "../lib/api";
import { Capability } from "../lib/capabilities";
import { useResource } from "../lib/use-resource";

type Settings = {
  timezone: string; currency: string; workingDays: number[]; cutoffTime: string; cutoffWorkingDays: number;
  kitchenReadyBufferMinutes: number; onTimeGraceMinutes: number; defaultDispatchLeadMinutes: number; today: string; updatedAt: string;
};
type PreviewDay = { deliveryDate: string; weekday: string; isKitchenWorkingDay: boolean; holiday: string | null; cutoffAt: string | null; isLocked: boolean | null };
type Holiday = { id: number; date: string; name: string };
type EditableSettings = Pick<Settings, "workingDays" | "cutoffTime" | "cutoffWorkingDays" | "kitchenReadyBufferMinutes" | "onTimeGraceMinutes" | "defaultDispatchLeadMinutes">;

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatInZone(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-IN", { timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}
function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${date}T00:00:00Z`));
}

function CalendarRules({ settings, onSaved, justSaved }: { settings: Settings; onSaved: () => void; justSaved: boolean }) {
  const [form, setForm] = useState<EditableSettings>(() => ({
    workingDays: settings.workingDays, cutoffTime: settings.cutoffTime, cutoffWorkingDays: settings.cutoffWorkingDays,
    kitchenReadyBufferMinutes: settings.kitchenReadyBufferMinutes, onTimeGraceMinutes: settings.onTimeGraceMinutes, defaultDispatchLeadMinutes: settings.defaultDispatchLeadMinutes,
  }));
  const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const [saved, setSaved] = useState(justSaved);
  const set = <K extends keyof EditableSettings>(key: K, value: EditableSettings[K]) => { setForm((current) => ({ ...current, [key]: value })); setSaved(false); };
  const toggleDay = (day: number) => set("workingDays", form.workingDays.includes(day) ? form.workingDays.filter((value) => value !== day) : [...form.workingDays, day].sort((a, b) => a - b));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    try { await apiJson("/settings", sendJson("PATCH", form)); onSaved(); }
    catch (caught) { setError(messageOf(caught, "Could not save settings.")); }
    finally { setSaving(false); }
  }

  return <form className="panel" onSubmit={save}>
    <div className="panel-heading"><h2>Kitchen calendar &amp; cut-off</h2><span className="hint">Timezone {settings.timezone} · prices in {settings.currency} · today is {formatDate(settings.today)}</span></div>
    <fieldset className="chip-group"><legend>Kitchen working days</legend>
      {WEEKDAYS.map((label, index) => <label className="chip" key={label}><input checked={form.workingDays.includes(index + 1)} onChange={() => toggleDay(index + 1)} type="checkbox" />{label}</label>)}
    </fieldset>
    <div className="form-grid">
      <label>Cut-off time<input onChange={(event) => set("cutoffTime", event.target.value)} required type="time" value={form.cutoffTime} /><span className="hint">Kitchen local time</span></label>
      <label>Cut-off working days before<input min={0} max={14} onChange={(event) => set("cutoffWorkingDays", Number(event.target.value))} required type="number" value={form.cutoffWorkingDays} /><span className="hint">Holidays and non-working days are skipped</span></label>
      <label>Kitchen-ready buffer (min)<input min={0} max={240} onChange={(event) => set("kitchenReadyBufferMinutes", Number(event.target.value))} required type="number" value={form.kitchenReadyBufferMinutes} /><span className="hint">Kitchen-ready = dispatch-ready − this</span></label>
      <label>On-time grace (min)<input min={0} max={120} onChange={(event) => set("onTimeGraceMinutes", Number(event.target.value))} required type="number" value={form.onTimeGraceMinutes} /><span className="hint">Up to this late still counts as on time</span></label>
      <label>Default dispatch lead (min)<input min={0} max={480} onChange={(event) => set("defaultDispatchLeadMinutes", Number(event.target.value))} required type="number" value={form.defaultDispatchLeadMinutes} /><span className="hint">Default for new companies</span></label>
    </div>
    {error ? <p aria-live="polite" className="form-error">{error}</p> : null}
    <div className="form-actions"><button className="primary-button" disabled={saving} type="submit">{saving ? "Saving..." : "Save settings"}</button>{saved ? <span className="success-text">Saved.</span> : null}</div>
  </form>;
}

// Re-keyed by the parent whenever settings or holidays change, which reloads it.
function CutoffPreview({ timezone }: { timezone: string }) {
  const { data, error, loading } = useResource<PreviewDay[]>("/settings/cutoff-preview?days=14");
  return <section className="panel">
    <div className="panel-heading"><h2>Upcoming delivery dates</h2><span className="hint">When orders for each date lock, using the rules above</span></div>
    {error ? <p className="form-error">{error}</p> : null}
    {loading && !data ? <p className="muted">Loading...</p> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Delivery date</th><th>Kitchen</th><th>Orders lock at</th><th>Status</th></tr></thead><tbody>
      {data?.map((day) => <tr className={day.isKitchenWorkingDay ? "" : "inactive"} key={day.deliveryDate}>
        <td>{formatDate(day.deliveryDate)}</td>
        <td>{day.isKitchenWorkingDay ? <span className="badge green">Open</span> : <span className="badge grey">{day.holiday ?? "Closed"}</span>}</td>
        <td>{day.cutoffAt ? formatInZone(day.cutoffAt, timezone) : "—"}</td>
        <td>{day.isLocked === null ? "No deliveries" : day.isLocked ? <span className="badge red">Locked</span> : <span className="badge amber">Open for orders</span>}</td>
      </tr>)}
    </tbody></table></div>}
  </section>;
}

function Holidays({ today, onChanged }: { today: string; onChanged: () => void }) {
  const currentYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const { data, error: loadError, loading, reload } = useResource<Holiday[]>(`/settings/holidays?year=${year}`);
  const [date, setDate] = useState(""); const [name, setName] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");

  async function run(action: () => Promise<unknown>, fallback: string) {
    setBusy(true); setError("");
    try { await action(); reload(); onChanged(); return true; }
    catch (caught) { setError(messageOf(caught, fallback)); return false; }
    finally { setBusy(false); }
  }
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await run(() => apiJson("/settings/holidays", sendJson("POST", { date, name })), "Could not add holiday.")) { setDate(""); setName(""); }
  }

  return <section className="panel">
    <div className="panel-heading"><h2>Kitchen holidays</h2>
      <div className="form-actions">{[currentYear, currentYear + 1].map((option) => <button className={option === year ? "primary-button" : "secondary-button"} key={option} onClick={() => setYear(option)} type="button">{option}</button>)}</div>
    </div>
    <p className="hint">Kitchen closed: no deliveries, skipped when counting back to the cut-off. “Tentative” dates are not yet confirmed.</p>
    <form className="form-grid" onSubmit={add}>
      <label>Date<input disabled={busy} onChange={(event) => setDate(event.target.value)} required type="date" value={date} /></label>
      <label>Name<input disabled={busy} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="e.g. Uttarayan" required value={name} /></label>
      <div className="form-actions"><button className="primary-button" disabled={busy} type="submit">Add holiday</button></div>
    </form>
    {error || loadError ? <p aria-live="polite" className="form-error">{error || loadError}</p> : null}
    {loading && !data ? <p className="muted">Loading...</p> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Holiday</th><th /></tr></thead><tbody>
      {data?.map((holiday) => <tr className={holiday.date < today ? "inactive" : ""} key={holiday.id}><td>{formatDate(holiday.date)}</td><td>{holiday.name}</td>
        <td><div className="row-actions"><button className="danger-button" disabled={busy} onClick={() => { if (window.confirm(`Remove ${holiday.name}? The kitchen will be treated as open on ${holiday.date}.`)) void run(() => apiJson(`/settings/holidays/${holiday.id}`, sendJson("DELETE")), "Could not remove holiday."); }} type="button">Remove</button></div></td></tr>)}
      {data && !data.length ? <tr><td className="muted" colSpan={3}>No holidays in {year}.</td></tr> : null}
    </tbody></table></div>}
  </section>;
}

function SettingsContent() {
  const { data: settings, error, reload } = useResource<Settings>("/settings");
  const [previewVersion, setPreviewVersion] = useState(0); const [justSaved, setJustSaved] = useState(false);
  const refreshPreview = () => setPreviewVersion((value) => value + 1);
  return <AppShell><main className="content-page wide">
    <h1>Settings</h1>
    {error ? <p className="form-error">{error}</p> : null}
    {settings ? <>
      <CalendarRules justSaved={justSaved} key={settings.updatedAt} onSaved={() => { setJustSaved(true); reload(); refreshPreview(); }} settings={settings} />
      <CutoffPreview key={previewVersion} timezone={settings.timezone} />
      <Holidays onChanged={refreshPreview} today={settings.today} />
    </> : !error ? <p className="muted">Loading settings...</p> : null}
  </main></AppShell>;
}

export default function SettingsPage() { return <ProtectedPage requires={[Capability.SETTINGS_MANAGE]}><SettingsContent /></ProtectedPage>; }
