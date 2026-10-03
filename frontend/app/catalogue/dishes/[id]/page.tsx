"use client";

import { useParams, useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { AppShell } from "../../../components/app-shell";
import { BackLink } from "../../../components/back-link";
import { ChipSelect } from "../../../components/form-controls";
import { ProtectedPage } from "../../../components/protected-page";
import { apiJson, messageOf, sendJson } from "../../../lib/api";
import { Capability } from "../../../lib/capabilities";
import { centsToInput, parseDollars } from "../../../lib/money";
import type { Dish, Option, OptionGroup } from "../../../lib/types";
import { useResource } from "../../../lib/use-resource";

type Signature = { uploadUrl: string; apiKey: string; folder: string; timestamp: number; signature: string };

/** Uploads straight to Cloudinary with a short-lived signature from our API; returns the hosted URL. */
async function uploadImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) throw new Error("Choose an image under 5 MB.");
  const signed = await apiJson<Signature>("/catalogue/images/signature", sendJson("POST"));
  const form = new FormData();
  form.append("file", file); form.append("api_key", signed.apiKey); form.append("timestamp", String(signed.timestamp));
  form.append("signature", signed.signature); form.append("folder", signed.folder);
  const response = await fetch(signed.uploadUrl, { method: "POST", body: form });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.secure_url) throw new Error(body?.error?.message ?? "Upload failed.");
  return body.secure_url as string;
}

function DishForm({ dish, onChanged, initialNotice = "" }: { dish: Dish | null; onChanged?: (message: string) => void; initialNotice?: string }) {
  const router = useRouter();
  const { data: stations } = useResource<Option[]>("/reference-data/stations");
  const { data: allergens } = useResource<Option[]>("/reference-data/allergens");
  const { data: tags } = useResource<Option[]>("/reference-data/dietary-tags");
  const { data: groups } = useResource<OptionGroup[]>("/catalogue/option-groups");
  const { data: images } = useResource<{ uploadsEnabled: boolean }>("/catalogue/images/status");
  const [form, setForm] = useState({
    sku: dish?.sku ?? "", name: dish?.name ?? "", description: dish?.description ?? "", imageUrl: dish?.imageUrl ?? "",
    temperature: dish?.temperature ?? "HOT", cost: centsToInput(dish?.costCents), stationId: String(dish?.stationId ?? ""), minOrderQty: String(dish?.minOrderQty ?? 1),
  });
  const [allergenIds, setAllergenIds] = useState(dish?.allergens.map((entry) => entry.id) ?? []);
  const [tagIds, setTagIds] = useState(dish?.dietaryTags.map((entry) => entry.id) ?? []);
  const [groupIds, setGroupIds] = useState(dish?.optionGroups.map((group) => group.id) ?? []); const [addingGroup, setAddingGroup] = useState("");
  const [busy, setBusy] = useState(false); const [uploading, setUploading] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState(initialNotice);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value });
  const groupName = (id: number) => groups?.find((group) => group.id === id)?.name ?? dish?.optionGroups.find((group) => group.id === id)?.name ?? `#${id}`;
  const moveGroup = (index: number, delta: number) => { const next = [...groupIds]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; setGroupIds(next); };

  async function onFile(file: File | undefined) {
    if (!file) return;
    setUploading(true); setError("");
    try { const url = await uploadImage(file); setForm((current) => ({ ...current, imageUrl: url })); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Upload failed."); }
    finally { setUploading(false); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice("");
    const costCents = parseDollars(form.cost);
    if (costCents === null) { setError("Enter the cost in dollars, e.g. 0.75."); return; }
    setBusy(true);
    const body = {
      sku: form.sku.trim().toUpperCase(), name: form.name, description: form.description, imageUrl: form.imageUrl.trim() || null,
      temperature: form.temperature, costCents, stationId: form.stationId ? Number(form.stationId) : null, minOrderQty: Number(form.minOrderQty),
      allergenIds, dietaryTagIds: tagIds,
    };
    try {
      const saved = await apiJson<Dish>(dish ? `/catalogue/dishes/${dish.id}` : "/catalogue/dishes", sendJson(dish ? "PATCH" : "POST", body));
      await apiJson(`/catalogue/dishes/${saved.id}/option-groups`, sendJson("PUT", { groupIds }));
      if (!dish) router.replace(`/catalogue/dishes/${saved.id}`); else onChanged?.("Dish saved.");
    } catch (caught) { setError(messageOf(caught, "Could not save dish.")); }
    finally { setBusy(false); }
  }

  async function toggleActive() {
    if (!dish) return;
    setBusy(true); setError("");
    try { await apiJson(`/catalogue/dishes/${dish.id}`, sendJson("PATCH", { isActive: !dish.isActive })); onChanged?.(dish.isActive ? "Dish deactivated." : "Dish reactivated."); }
    catch (caught) { setError(messageOf(caught, "Could not update dish.")); }
    finally { setBusy(false); }
  }

  return <form className="form-stack" onSubmit={save}>
    <div className="page-heading">
      <div><p className="eyebrow">Catalogue</p><h1>{dish ? dish.name : "New dish"}</h1></div>
      {dish ? <div className="form-actions">{dish.isActive ? <span className="badge green">Active</span> : <span className="badge grey">Deactivated</span>}<button className={dish.isActive ? "danger-button" : "secondary-button"} disabled={busy} onClick={() => void toggleActive()} type="button">{dish.isActive ? "Deactivate" : "Reactivate"}</button></div> : null}
    </div>
    {dish && !dish.isActive ? <p className="notice">Deactivated dishes stay on past orders but can&apos;t be ordered.</p> : null}
    <div className="section-grid">
      <fieldset className="panel" disabled={busy}>
        <h2>Details</h2>
        <div className="form-grid">
          <label>SKU<input maxLength={20} onChange={set("sku")} placeholder="GUJ-001" required value={form.sku} /></label>
          <label>Temperature<select onChange={set("temperature")} value={form.temperature}><option value="HOT">Hot</option><option value="COLD">Cold</option></select></label>
        </div>
        <label>Name<input maxLength={120} onChange={set("name")} required value={form.name} /></label>
        <label>Description<textarea maxLength={500} onChange={set("description")} value={form.description} /></label>
        <div className="form-grid">
          <label>Cost price ($)<input inputMode="decimal" onChange={set("cost")} placeholder="0.75" required value={form.cost} /><span className="hint">Ingredients + labour; derived tiers can price from this</span></label>
          <label>Kitchen station<select onChange={set("stationId")} value={form.stationId}><option value="">Unassigned</option>{stations?.map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}</select></label>
          <label>Minimum order qty<input max={500} min={1} onChange={set("minOrderQty")} required type="number" value={form.minOrderQty} /><span className="hint">Per order line</span></label>
        </div>
      </fieldset>
      <fieldset className="panel" disabled={busy}>
        <h2>Image</h2>
        {/* eslint-disable-next-line @next/next/no-img-element -- remote Cloudinary/stock URLs entered by staff */}
        {form.imageUrl ? <img alt={form.name} src={form.imageUrl} style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 6 }} /> : <p className="muted">No image yet.</p>}
        <label>Image URL<input onChange={set("imageUrl")} placeholder="https://..." type="url" value={form.imageUrl} /></label>
        {images?.uploadsEnabled ? <label>Upload<input accept="image/*" disabled={uploading} onChange={(event) => void onFile(event.target.files?.[0])} type="file" /><span className="hint">{uploading ? "Uploading..." : "JPG/PNG/WebP under 5 MB, stored on Cloudinary"}</span></label>
          : <p className="hint">Uploads are off until CLOUDINARY_URL is configured on the server; paste a URL meanwhile.</p>}
        <ChipSelect legend="Allergens" onChange={setAllergenIds} options={allergens ?? []} value={allergenIds} />
        <ChipSelect legend="Dietary tags" onChange={setTagIds} options={tags ?? []} value={tagIds} />
      </fieldset>
    </div>
    <fieldset className="panel" disabled={busy}>
      <h2>Option groups</h2>
      <p className="hint">Shown to the customer in this order. Groups are shared: edit their options on the Catalogue → Option groups tab.</p>
      <div className="table-wrap"><table className="data-table"><tbody>
        {groupIds.map((id, index) => { const group = groups?.find((entry) => entry.id === id); return <tr key={id}>
          <td>{index + 1}. <strong>{groupName(id)}</strong> {group ? (group.required ? <span className="badge amber">Required</span> : <span className="badge grey">Optional</span>) : null}</td>
          <td className="muted">{group?.options.map((option) => option.name).join(", ")}</td>
          <td><div className="row-actions">
            <button className="secondary-button" disabled={index === 0} onClick={() => moveGroup(index, -1)} type="button">↑</button>
            <button className="secondary-button" disabled={index === groupIds.length - 1} onClick={() => moveGroup(index, 1)} type="button">↓</button>
            <button className="danger-button" onClick={() => setGroupIds(groupIds.filter((value) => value !== id))} type="button">Remove</button>
          </div></td>
        </tr>; })}
        {!groupIds.length ? <tr><td className="muted">No option groups: the dish is ordered as-is.</td></tr> : null}
      </tbody></table></div>
      <div className="form-actions">
        <select aria-label="Add group" onChange={(event) => setAddingGroup(event.target.value)} value={addingGroup}><option value="">Add a group...</option>{groups?.filter((group) => !groupIds.includes(group.id)).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select>
        <button className="secondary-button" disabled={!addingGroup} onClick={() => { setGroupIds([...groupIds, Number(addingGroup)]); setAddingGroup(""); }} type="button">Add</button>
      </div>
    </fieldset>
    {error ? <p aria-live="polite" className="form-error">{error}</p> : null}
    {notice ? <p aria-live="polite" className="success-text">{notice}</p> : null}
    <div className="form-actions"><button className="primary-button" disabled={busy || uploading} type="submit">{busy ? "Saving..." : dish ? "Save dish" : "Create dish"}</button></div>
  </form>;
}

function DishContent() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const { data: dish, error, reload } = useResource<Dish>(isNew ? null : `/catalogue/dishes/${id}`);
  const [notice, setNotice] = useState("");
  return <AppShell><main className="content-page wide">
    <BackLink href="/catalogue" label="Back to catalogue" />
    {error ? <p className="form-error">{error}</p> : isNew ? <DishForm dish={null} /> : dish ? <DishForm dish={dish} initialNotice={notice} key={dish.updatedAt} onChanged={(message) => { setNotice(message); reload(); }} /> : <p className="muted">Loading dish...</p>}
  </main></AppShell>;
}

export default function DishPage() { return <ProtectedPage requires={[Capability.CATALOGUE_MANAGE]}><DishContent /></ProtectedPage>; }
