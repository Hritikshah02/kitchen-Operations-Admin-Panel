"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { MenuPreviewButton } from "../components/menu-preview-drawer";
import { AppShell } from "../components/app-shell";
import { ProtectedPage } from "../components/protected-page";
import { apiJson, messageOf, sendJson } from "../lib/api";
import { Capability } from "../lib/capabilities";
import type { Dish, MenuCategory, Page } from "../lib/types";
import { useResource } from "../lib/use-resource";

function swap<T>(list: T[], index: number, delta: number) { const next = [...list]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; return next; }

function MenuContent() {
  const { data: categories, error: loadError, reload } = useResource<MenuCategory[]>("/menu/categories");
  const { data: dishes } = useResource<Page<Dish>>("/catalogue/dishes?pageSize=100");
  const [selectedId, setSelectedId] = useState<number | null>(null); const [newName, setNewName] = useState(""); const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const selected = categories?.find((category) => category.id === selectedId) ?? categories?.[0] ?? null;

  async function run(action: () => Promise<unknown>, success = "") {
    setBusy(true); setError(""); setNotice("");
    try { await action(); reload(); setNotice(success); return true; }
    catch (caught) { setError(messageOf(caught, "Something went wrong.")); return false; }
    finally { setBusy(false); }
  }
  const patchCategory = (category: MenuCategory, body: object, success: string) => run(() => apiJson(`/menu/categories/${category.id}`, sendJson("PATCH", body)), success);
  const moveCategory = (index: number, delta: number) => categories && run(() => apiJson("/menu/categories/order", sendJson("PUT", { ids: swap(categories, index, delta).map((category) => category.id) })));
  const setItems = (dishIds: number[], success = "") => selected && run(() => apiJson(`/menu/categories/${selected.id}/items`, sendJson("PUT", { ids: dishIds })), success);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await run(() => apiJson("/menu/categories", sendJson("POST", { name: newName })), `${newName} added.`)) setNewName("");
  }

  return <AppShell><main className="content-page wide">
    <div className="page-heading"><h1>Menu</h1><MenuPreviewButton /></div>
    <p className="muted">Categories and dishes appear in this order. Hide items per company from the company page.</p>
    {error || loadError ? <p aria-live="polite" className="form-error">{error || loadError}</p> : null}{notice ? <p className="success-text">{notice}</p> : null}
    <div className="section-grid" style={{ gridTemplateColumns: "minmax(300px, 1fr) minmax(360px, 1.4fr)" }}>
      <section className="panel">
        <h2>Categories</h2>
        <div className="table-wrap"><table className="data-table"><tbody>
          {categories?.map((category, index) => <tr className={category.isActive ? (category.id === selected?.id ? "dirty" : "") : "inactive"} key={category.id}>
            <td><button className="link" onClick={() => setSelectedId(category.id)} style={{ background: "none", border: 0, padding: 0 }} type="button">{category.name}</button>
              <div className="chip-list" style={{ marginTop: 4 }}>{category.isSecret ? <span className="badge amber">Secret</span> : null}{!category.isActive ? <span className="badge grey">Off</span> : null}{category.hiddenForCompanies ? <span className="badge grey">Hidden for {category.hiddenForCompanies}</span> : null}<span className="hint">{category.items.length} dishes</span></div></td>
            <td><div className="row-actions">
              <button aria-label="Move up" className="secondary-button" disabled={busy || index === 0} onClick={() => void moveCategory(index, -1)} type="button">↑</button>
              <button aria-label="Move down" className="secondary-button" disabled={busy || index === categories.length - 1} onClick={() => void moveCategory(index, 1)} type="button">↓</button>
            </div></td>
          </tr>)}
        </tbody></table></div>
        <form className="form-actions" onSubmit={create}><input aria-label="New category" disabled={busy} maxLength={60} onChange={(event) => setNewName(event.target.value)} placeholder="New category name" required value={newName} /><button className="secondary-button" disabled={busy} type="submit">Add</button></form>
      </section>

      {selected ? <section className="panel" key={selected.id}>
        <div className="panel-heading"><h2>{selected.name}</h2><div className="form-actions">
          <label className="check chip"><input checked={selected.isSecret} disabled={busy} onChange={(event) => void patchCategory(selected, { isSecret: event.target.checked }, event.target.checked ? "Category is now secret." : "Category is now listed.")} type="checkbox" />Secret</label>
          <button className={selected.isActive ? "danger-button" : "secondary-button"} disabled={busy} onClick={() => void patchCategory(selected, { isActive: !selected.isActive }, selected.isActive ? "Category switched off." : "Category switched on.")} type="button">{selected.isActive ? "Switch off" : "Switch on"}</button>
        </div></div>
        <div className="table-wrap"><table className="data-table"><tbody>
          {selected.items.map((item, index) => <tr className={item.isActive && item.dish.isActive ? "" : "inactive"} key={item.id}>
            <td>{index + 1}. <Link className="link" href={`/catalogue/dishes/${item.dish.id}`}>{item.dish.name}</Link> <span className="hint">{item.dish.sku}</span>{!item.dish.isActive ? <span className="badge grey" style={{ marginLeft: 6 }}>Dish deactivated</span> : null}</td>
            <td><div className="row-actions">
              <button aria-label="Move up" className="secondary-button" disabled={busy || index === 0} onClick={() => void setItems(swap(selected.items, index, -1).map((entry) => entry.dishId))} type="button">↑</button>
              <button aria-label="Move down" className="secondary-button" disabled={busy || index === selected.items.length - 1} onClick={() => void setItems(swap(selected.items, index, 1).map((entry) => entry.dishId))} type="button">↓</button>
              <button className="secondary-button" disabled={busy} onClick={() => void run(() => apiJson(`/menu/items/${item.id}`, sendJson("PATCH", { isActive: !item.isActive })))} type="button">{item.isActive ? "Switch off" : "Switch on"}</button>
              <button className="danger-button" disabled={busy} onClick={() => void setItems(selected.items.filter((entry) => entry.id !== item.id).map((entry) => entry.dishId), `${item.dish.name} removed from ${selected.name}.`)} type="button">Remove</button>
            </div></td>
          </tr>)}
          {!selected.items.length ? <tr><td className="muted">No dishes yet.</td></tr> : null}
        </tbody></table></div>
        <div className="form-actions">
          <select aria-label="Add dish" onChange={(event) => setAdding(event.target.value)} value={adding}><option value="">Add a dish...</option>{dishes?.items.filter((dish) => !selected.items.some((item) => item.dishId === dish.id)).map((dish) => <option key={dish.id} value={dish.id}>{dish.sku} · {dish.name}</option>)}</select>
          <button className="secondary-button" disabled={!adding || busy} onClick={() => { void setItems([...selected.items.map((item) => item.dishId), Number(adding)], "Dish added."); setAdding(""); }} type="button">Add</button>
        </div>
      </section> : null}
    </div>
  </main></AppShell>;
}

export default function MenuPage() { return <ProtectedPage requires={[Capability.CATALOGUE_MANAGE]}><MenuContent /></ProtectedPage>; }
