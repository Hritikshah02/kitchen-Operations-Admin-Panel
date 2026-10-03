"use client";

import { type FormEvent, useState } from "react";
import { AppShell } from "../components/app-shell";
import { ProtectedPage } from "../components/protected-page";
import { apiJson, messageOf, sendJson } from "../lib/api";
import { Capability } from "../lib/capabilities";
import { useResource } from "../lib/use-resource";

type Item = { id: number; name: string; description: string | null; sortOrder: number; isActive: boolean };
type Draft = { name: string; description: string; sortOrder: number };

const KINDS = [
  { kind: "allergens", label: "Allergens", hint: "Declared on dishes and options; matched against employee allergies." },
  { kind: "dietary-tags", label: "Dietary tags", hint: "Jain, Swaminarayan, vegan... shown on the menu and used for employee preferences." },
  { kind: "stations", label: "Kitchen stations", hint: "Where a dish is cooked. The kitchen board groups prep units by station." },
  { kind: "portion-sizes", label: "Portion sizes", hint: "Sizes an option group can sell (e.g. Regular, Large)." },
  { kind: "packaging-types", label: "Packaging types", hint: "How meals are packed; each company has a default and some employees may choose." },
] as const;

function ReferenceList({ kind, hint }: { kind: string; hint: string }) {
  const { data, error: loadError, loading, reload } = useResource<Item[]>(`/reference-data/${kind}?includeInactive=true`);
  const [draft, setDraft] = useState<Draft>({ name: "", description: "", sortOrder: 0 });
  const [editing, setEditing] = useState<{ id: number } & Draft | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");

  async function run(action: () => Promise<unknown>, fallback: string) {
    setBusy(true); setError("");
    try { await action(); reload(); return true; }
    catch (caught) { setError(messageOf(caught, fallback)); return false; }
    finally { setBusy(false); }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const sortOrder = draft.sortOrder || ((data?.at(-1)?.sortOrder ?? 0) + 10);
    if (await run(() => apiJson(`/reference-data/${kind}`, sendJson("POST", { ...draft, sortOrder })), "Could not add item.")) setDraft({ name: "", description: "", sortOrder: 0 });
  }
  async function saveEdit() {
    if (!editing) return;
    const { id, ...body } = editing;
    if (await run(() => apiJson(`/reference-data/${kind}/${id}`, sendJson("PATCH", body)), "Could not save item.")) setEditing(null);
  }
  const setActive = (item: Item, isActive: boolean) => run(() => apiJson(`/reference-data/${kind}/${item.id}`, sendJson("PATCH", { isActive })), "Could not update item.");

  return <section className="panel">
    <p className="hint">{hint} Items are never deleted, only deactivated, so past orders keep their meaning.</p>
    <form className="form-grid" onSubmit={create}>
      <label>Name<input disabled={busy} maxLength={60} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required value={draft.name} /></label>
      <label>Description<input disabled={busy} maxLength={240} onChange={(event) => setDraft({ ...draft, description: event.target.value })} value={draft.description} /></label>
      <div className="form-actions"><button className="primary-button" disabled={busy} type="submit">Add</button></div>
    </form>
    {error || loadError ? <p aria-live="polite" className="form-error">{error || loadError}</p> : null}
    {loading && !data ? <p className="muted">Loading...</p> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Order</th><th>Name</th><th>Description</th><th>Status</th><th /></tr></thead><tbody>
      {data?.map((item) => editing?.id === item.id ? <tr key={item.id}>
        <td><input aria-label="Sort order" min={0} onChange={(event) => setEditing({ ...editing, sortOrder: Number(event.target.value) })} style={{ width: 80 }} type="number" value={editing.sortOrder} /></td>
        <td><input aria-label="Name" maxLength={60} onChange={(event) => setEditing({ ...editing, name: event.target.value })} value={editing.name} /></td>
        <td><input aria-label="Description" maxLength={240} onChange={(event) => setEditing({ ...editing, description: event.target.value })} value={editing.description} /></td>
        <td />
        <td><div className="row-actions"><button className="primary-button" disabled={busy} onClick={() => void saveEdit()} type="button">Save</button><button className="secondary-button" onClick={() => setEditing(null)} type="button">Cancel</button></div></td>
      </tr> : <tr className={item.isActive ? "" : "inactive"} key={item.id}>
        <td>{item.sortOrder}</td><td><strong>{item.name}</strong></td><td className="muted">{item.description ?? "—"}</td>
        <td>{item.isActive ? <span className="badge green">Active</span> : <span className="badge grey">Inactive</span>}</td>
        <td><div className="row-actions">
          <button className="secondary-button" disabled={busy} onClick={() => setEditing({ id: item.id, name: item.name, description: item.description ?? "", sortOrder: item.sortOrder })} type="button">Edit</button>
          {item.isActive ? <button className="danger-button" disabled={busy} onClick={() => void setActive(item, false)} type="button">Deactivate</button> : <button className="secondary-button" disabled={busy} onClick={() => void setActive(item, true)} type="button">Reactivate</button>}
        </div></td>
      </tr>)}
      {data && !data.length ? <tr><td className="muted" colSpan={5}>Nothing here yet.</td></tr> : null}
    </tbody></table></div>}
  </section>;
}

function ReferenceDataContent() {
  const [active, setActive] = useState<(typeof KINDS)[number]>(KINDS[0]);
  return <AppShell><main className="content-page wide">
    <div className="page-heading"><div><p className="eyebrow">Administration</p><h1>Reference data</h1></div></div>
    <div className="tabs" role="tablist">{KINDS.map((entry) => <button aria-selected={entry.kind === active.kind} className={entry.kind === active.kind ? "tab active" : "tab"} key={entry.kind} onClick={() => setActive(entry)} role="tab" type="button">{entry.label}</button>)}</div>
    <ReferenceList hint={active.hint} key={active.kind} kind={active.kind} />
  </main></AppShell>;
}

export default function ReferenceDataPage() { return <ProtectedPage requires={[Capability.REFERENCE_DATA_MANAGE]}><ReferenceDataContent /></ProtectedPage>; }
