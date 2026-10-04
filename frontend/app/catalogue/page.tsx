"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { AppShell } from "../components/app-shell";
import { ChipSelect, Pagination } from "../components/form-controls";
import { ProtectedPage } from "../components/protected-page";
import { apiJson, messageOf, sendJson } from "../lib/api";
import { Capability } from "../lib/capabilities";
import { centsToInput, formatCents, parseDollars } from "../lib/money";
import type { CatalogueOption, Dish, Option, OptionGroup, Page } from "../lib/types";
import { useResource } from "../lib/use-resource";

const TABS = ["Dishes", "Options", "Option groups"] as const;

function DishesTab() {
  const { data: stations } = useResource<Option[]>("/reference-data/stations");
  const [search, setSearch] = useState(""); const [stationId, setStationId] = useState(""); const [includeInactive, setIncludeInactive] = useState(false); const [page, setPage] = useState(1);
  const query = new URLSearchParams({ page: String(page), pageSize: "25", includeInactive: String(includeInactive), ...(search.trim() ? { search: search.trim() } : {}), ...(stationId ? { stationId } : {}) });
  const { data, error, loading } = useResource<Page<Dish>>(`/catalogue/dishes?${query}`);
  return <section className="panel">
    <div className="toolbar">
      <label>Search<input onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Name or SKU" value={search} /></label>
      <label>Station<select onChange={(event) => { setStationId(event.target.value); setPage(1); }} value={stationId}><option value="">All stations</option>{stations?.map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}</select></label>
      <label className="check"><input checked={includeInactive} onChange={(event) => { setIncludeInactive(event.target.checked); setPage(1); }} type="checkbox" />Show deactivated</label>
      <Link className="primary-button" href="/catalogue/dishes/new" style={{ marginLeft: "auto" }}>New dish</Link>
    </div>
    {error ? <p className="form-error">{error}</p> : null}
    {loading && !data ? <p className="muted">Loading dishes...</p> : <div className="table-wrap"><table className="data-table"><thead><tr><th>SKU</th><th>Dish</th><th>Station</th><th>Temp</th><th>Cost</th><th>Option groups</th><th>Status</th></tr></thead><tbody>
      {data?.items.map((dish) => <tr className={dish.isActive ? "" : "inactive"} key={dish.id}>
        <td>{dish.sku}</td><td><Link className="link" href={`/catalogue/dishes/${dish.id}`}>{dish.name}</Link></td>
        <td>{dish.station?.name ?? <span className="badge amber">Unassigned</span>}</td>
        <td>{dish.temperature === "HOT" ? "Hot" : "Cold"}</td><td>{formatCents(dish.costCents)}</td>
        <td>{dish.optionGroups.map((group) => group.name).join(", ") || "—"}</td>
        <td>{dish.isActive ? <span className="badge green">Active</span> : <span className="badge grey">Deactivated</span>}</td>
      </tr>)}
      {data && !data.items.length ? <tr><td className="muted" colSpan={7}>No dishes match.</td></tr> : null}
    </tbody></table></div>}
    {data ? <Pagination noun="dishes" onPage={setPage} page={data.page} pageSize={data.pageSize} total={data.total} /> : null}
  </section>;
}

function OptionForm({ option, onDone }: { option: CatalogueOption | null; onDone: (message: string) => void }) {
  const { data: allergens } = useResource<Option[]>("/reference-data/allergens");
  const { data: tags } = useResource<Option[]>("/reference-data/dietary-tags");
  const { data: sizes } = useResource<Option[]>("/reference-data/portion-sizes");
  const [name, setName] = useState(option?.name ?? ""); const [cost, setCost] = useState(centsToInput(option?.costCents));
  const [allergenIds, setAllergenIds] = useState(option?.allergens.map((entry) => entry.id) ?? []); const [tagIds, setTagIds] = useState(option?.dietaryTags.map((entry) => entry.id) ?? []);
  const [surcharges, setSurcharges] = useState<Record<number, string>>(Object.fromEntries(option?.surcharges.map((entry) => [entry.portionSizeId, centsToInput(entry.surchargeCents)]) ?? []));
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const costCents = parseDollars(cost);
    const surchargeList = Object.entries(surcharges).filter(([, value]) => value.trim() !== "").map(([portionSizeId, value]) => ({ portionSizeId: Number(portionSizeId), surchargeCents: parseDollars(value) }));
    if (costCents === null || surchargeList.some((entry) => entry.surchargeCents === null)) { setError("Enter amounts in dollars, e.g. 0.45."); return; }
    setBusy(true);
    try {
      const body = { name, costCents, allergenIds, dietaryTagIds: tagIds, surcharges: surchargeList };
      await apiJson(option ? `/catalogue/options/${option.id}` : "/catalogue/options", sendJson(option ? "PATCH" : "POST", body));
      onDone(`${name} saved.`);
    } catch (caught) { setError(messageOf(caught, "Could not save option.")); }
    finally { setBusy(false); }
  }

  return <form className="panel" onSubmit={save}><fieldset className="panel-fieldset" disabled={busy}>
    <h2>{option ? `Edit ${option.name}` : "New option"}</h2>
    <div className="form-grid">
      <label>Name<input maxLength={80} onChange={(event) => setName(event.target.value)} required value={name} /></label>
      <label>Cost ($)<input inputMode="decimal" onChange={(event) => setCost(event.target.value)} placeholder="0.45" required value={cost} /></label>
      {sizes?.map((size) => <label key={size.id}>{size.name} surcharge ($)<input inputMode="decimal" onChange={(event) => setSurcharges({ ...surcharges, [size.id]: event.target.value })} placeholder="not sold" value={surcharges[size.id] ?? ""} /></label>)}
    </div>
    <p className="hint">Surcharge per size, added to the option price on every tier. Portioned groups need every size.</p>
    <ChipSelect legend="Allergens" onChange={setAllergenIds} options={allergens ?? []} value={allergenIds} />
    <ChipSelect legend="Dietary tags" onChange={setTagIds} options={tags ?? []} value={tagIds} />
    {error ? <p aria-live="polite" className="form-error">{error}</p> : null}
    <div className="form-actions"><button className="primary-button" type="submit">Save option</button><button className="secondary-button" onClick={() => onDone("")} type="button">Cancel</button></div>
  </fieldset></form>;
}

function OptionsTab() {
  const [includeInactive, setIncludeInactive] = useState(false); const [search, setSearch] = useState(""); const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<CatalogueOption | "new" | null>(null); const [notice, setNotice] = useState(""); const [error, setError] = useState("");
  const query = new URLSearchParams({ page: String(page), pageSize: "50", includeInactive: String(includeInactive), ...(search.trim() ? { search: search.trim() } : {}) });
  const { data, reload } = useResource<Page<CatalogueOption>>(`/catalogue/options?${query}`);
  const done = (message: string) => { setEditing(null); setNotice(message); reload(); };
  async function toggle(option: CatalogueOption) {
    setError("");
    try { await apiJson(`/catalogue/options/${option.id}`, sendJson("PATCH", { isActive: !option.isActive })); done(`${option.name} ${option.isActive ? "deactivated" : "reactivated"}.`); }
    catch (caught) { setError(messageOf(caught, "Could not update option.")); }
  }
  return <>
    {editing ? <OptionForm key={editing === "new" ? "new" : editing.id} onDone={done} option={editing === "new" ? null : editing} /> : null}
    <section className="panel">
      <div className="toolbar">
        <label>Search<input onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Option name" value={search} /></label>
        <label className="check"><input checked={includeInactive} onChange={(event) => setIncludeInactive(event.target.checked)} type="checkbox" />Show deactivated</label>
        <button className="primary-button" onClick={() => setEditing("new")} style={{ marginLeft: "auto" }} type="button">New option</button>
      </div>
      {notice ? <p className="success-text">{notice}</p> : null}{error ? <p className="form-error">{error}</p> : null}
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Option</th><th>Cost</th><th>Size surcharges</th><th>Allergens</th><th>In groups</th><th>Status</th><th /></tr></thead><tbody>
        {data?.items.map((option) => <tr className={option.isActive ? "" : "inactive"} key={option.id}>
          <td><strong>{option.name}</strong></td><td>{formatCents(option.costCents)}</td>
          <td>{option.surcharges.map((entry) => `${entry.portionSize.name} +${formatCents(entry.surchargeCents)}`).join(", ") || "—"}</td>
          <td>{option.allergens.map((entry) => entry.name).join(", ") || "—"}</td>
          <td>{option.groups.map((entry) => entry.name).join(", ") || "—"}</td>
          <td>{option.isActive ? <span className="badge green">Active</span> : <span className="badge grey">Deactivated</span>}</td>
          <td><div className="row-actions"><button className="secondary-button" onClick={() => setEditing(option)} type="button">Edit</button><button className={option.isActive ? "danger-button" : "secondary-button"} onClick={() => void toggle(option)} type="button">{option.isActive ? "Deactivate" : "Reactivate"}</button></div></td>
        </tr>)}
      </tbody></table></div>
      {data ? <Pagination noun="options" onPage={setPage} page={data.page} pageSize={data.pageSize} total={data.total} /> : null}
    </section>
  </>;
}

function GroupForm({ group, onDone }: { group: OptionGroup | null; onDone: (message: string) => void }) {
  const { data: allOptions } = useResource<Page<CatalogueOption>>("/catalogue/options?pageSize=100");
  const { data: sizes } = useResource<Option[]>("/reference-data/portion-sizes");
  const [name, setName] = useState(group?.name ?? ""); const [minSelect, setMinSelect] = useState(String(group?.minSelect ?? 1)); const [maxSelect, setMaxSelect] = useState(String(group?.maxSelect ?? 1));
  const [usesPortions, setUsesPortions] = useState(group?.usesPortions ?? false); const [sizeIds, setSizeIds] = useState(group?.portionSizes.map((size) => size.id) ?? []);
  const [optionIds, setOptionIds] = useState(group?.options.map((option) => option.id) ?? []); const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const optionName = (id: number) => allOptions?.items.find((option) => option.id === id)?.name ?? group?.options.find((option) => option.id === id)?.name ?? `#${id}`;
  const move = (index: number, delta: number) => { const next = [...optionIds]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; setOptionIds(next); };

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const body = { name, minSelect: Number(minSelect), maxSelect: Number(maxSelect), usesPortions, portionSizeIds: usesPortions ? sizeIds : [], optionIds };
      await apiJson(group ? `/catalogue/option-groups/${group.id}` : "/catalogue/option-groups", sendJson(group ? "PATCH" : "POST", body));
      onDone(`${name} saved.`);
    } catch (caught) { setError(messageOf(caught, "Could not save group.")); }
    finally { setBusy(false); }
  }

  return <form className="panel" onSubmit={save}><fieldset className="panel-fieldset" disabled={busy}>
    <h2>{group ? `Edit ${group.name}` : "New option group"}</h2>
    {group?.dishCount ? <p className="hint">Used by {group.dishCount} dish(es); changes apply to all.</p> : null}
    <div className="form-grid">
      <label>Name<input maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="Choose your protein" required value={name} /></label>
      <label>Minimum choices<input max={10} min={0} onChange={(event) => setMinSelect(event.target.value)} required type="number" value={minSelect} /><span className="hint">0 = optional, 1+ = required</span></label>
      <label>Maximum choices<input max={10} min={1} onChange={(event) => setMaxSelect(event.target.value)} required type="number" value={maxSelect} /></label>
    </div>
    <label className="check chip" style={{ justifySelf: "start" }}><input checked={usesPortions} onChange={(event) => setUsesPortions(event.target.checked)} type="checkbox" />Sold in portion sizes</label>
    {usesPortions ? <ChipSelect legend="Sizes offered" onChange={setSizeIds} options={sizes ?? []} value={sizeIds} /> : null}
    <div><p className="hint" style={{ marginBottom: 8 }}>Options in display order</p>
      <div className="table-wrap"><table className="data-table"><tbody>
        {optionIds.map((id, index) => <tr key={id}><td>{index + 1}. {optionName(id)}</td><td><div className="row-actions">
          <button className="secondary-button" disabled={index === 0} onClick={() => move(index, -1)} type="button">↑</button>
          <button className="secondary-button" disabled={index === optionIds.length - 1} onClick={() => move(index, 1)} type="button">↓</button>
          <button className="danger-button" onClick={() => setOptionIds(optionIds.filter((value) => value !== id))} type="button">Remove</button>
        </div></td></tr>)}
        {!optionIds.length ? <tr><td className="muted">No options yet.</td></tr> : null}
      </tbody></table></div>
      <div className="form-actions" style={{ marginTop: 10 }}>
        <select aria-label="Add option" onChange={(event) => setAdding(event.target.value)} value={adding}><option value="">Add an option...</option>{allOptions?.items.filter((option) => !optionIds.includes(option.id)).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select>
        <button className="secondary-button" disabled={!adding} onClick={() => { setOptionIds([...optionIds, Number(adding)]); setAdding(""); }} type="button">Add</button>
      </div>
    </div>
    {error ? <p aria-live="polite" className="form-error">{error}</p> : null}
    <div className="form-actions"><button className="primary-button" type="submit">Save group</button><button className="secondary-button" onClick={() => onDone("")} type="button">Cancel</button></div>
  </fieldset></form>;
}

function GroupsTab() {
  const [editing, setEditing] = useState<OptionGroup | "new" | null>(null); const [notice, setNotice] = useState("");
  const { data, reload } = useResource<OptionGroup[]>("/catalogue/option-groups?includeInactive=true");
  const done = (message: string) => { setEditing(null); setNotice(message); reload(); };
  const rule = (group: OptionGroup) => group.minSelect === group.maxSelect ? `exactly ${group.minSelect}` : group.minSelect === 0 ? `up to ${group.maxSelect}` : `${group.minSelect}–${group.maxSelect}`;
  return <>
    {editing ? <GroupForm group={editing === "new" ? null : editing} key={editing === "new" ? "new" : editing.id} onDone={done} /> : null}
    <section className="panel">
      <div className="toolbar"><p className="hint">Reusable option groups.</p><button className="primary-button" onClick={() => setEditing("new")} style={{ marginLeft: "auto" }} type="button">New group</button></div>
      {notice ? <p className="success-text">{notice}</p> : null}
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Group</th><th>Choose</th><th>Portions</th><th>Options</th><th>Dishes</th><th /></tr></thead><tbody>
        {data?.map((group) => <tr className={group.isActive ? "" : "inactive"} key={group.id}>
          <td><strong>{group.name}</strong> {group.required ? <span className="badge amber">Required</span> : <span className="badge grey">Optional</span>}</td>
          <td>{rule(group)}</td><td>{group.usesPortions ? group.portionSizes.map((size) => size.name).join(", ") : "—"}</td>
          <td>{group.options.map((option) => option.name).join(", ")}</td><td>{group.dishCount}</td>
          <td><div className="row-actions"><button className="secondary-button" onClick={() => setEditing(group)} type="button">Edit</button></div></td>
        </tr>)}
      </tbody></table></div>
    </section>
  </>;
}

function CatalogueContent() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Dishes");
  return <AppShell><main className="content-page wide">
    <div className="page-heading"><h1>Catalogue</h1><Link className="secondary-button" href="/menu/preview">Preview as an employee</Link></div>
    <div className="tabs" role="tablist">{TABS.map((entry) => <button aria-selected={entry === tab} className={entry === tab ? "tab active" : "tab"} key={entry} onClick={() => setTab(entry)} role="tab" type="button">{entry}</button>)}</div>
    {tab === "Dishes" ? <DishesTab /> : tab === "Options" ? <OptionsTab /> : <GroupsTab />}
  </main></AppShell>;
}

export default function CataloguePage() { return <ProtectedPage requires={[Capability.CATALOGUE_MANAGE]}><CatalogueContent /></ProtectedPage>; }
