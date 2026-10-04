"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { AppShell } from "../../components/app-shell";
import { BackLink } from "../../components/back-link";
import { ProtectedPage } from "../../components/protected-page";
import { apiJson, messageOf, sendJson } from "../../lib/api";
import { Capability } from "../../lib/capabilities";
import { centsToInput, formatCents, parseDollars } from "../../lib/money";
import { describeRule, type GridRow, type PriceSource, type PriceTier } from "../../lib/types";
import { useResource } from "../../lib/use-resource";

type Draft = { price: string; isUnavailable: boolean };
const SOURCE_BADGE: Record<PriceSource, [string, string]> = {
  manual: ["green", "Typed"], override: ["amber", "Override"], derived: ["grey", "Derived"], unavailable: ["grey", "Not sold"], missing: ["red", "No price"],
};

/** Whole-tier editor: every active dish or option, with unsaved edits tracked per row and saved in one request. */
function Grid({ tier, kind }: { tier: PriceTier; kind: "dishes" | "options" }) {
  const [search, setSearch] = useState(""); const [missingOnly, setMissingOnly] = useState(false);
  const query = new URLSearchParams({ kind, missingOnly: String(missingOnly), ...(search.trim() ? { search: search.trim() } : {}) });
  const { data, error: loadError, reload } = useResource<{ rows: GridRow[] }>(`/pricing/tiers/${tier.id}/grid?${query}`);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({}); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const derivedTier = tier.rule !== "MANUAL";
  const draftOf = (row: GridRow): Draft => drafts[row.id] ?? { price: centsToInput(row.typedCents), isUnavailable: row.isUnavailable };
  const edit = (row: GridRow, patch: Partial<Draft>) => setDrafts({ ...drafts, [row.id]: { ...draftOf(row), ...patch } });
  const dirty = Object.keys(drafts).length;

  async function save() {
    setError(""); setNotice("");
    const cells = Object.entries(drafts).map(([id, draft]) => ({ id: Number(id), isUnavailable: draft.isUnavailable, priceCents: draft.price.trim() === "" ? null : parseDollars(draft.price) }));
    const invalid = Object.entries(drafts).find(([, draft]) => draft.price.trim() !== "" && parseDollars(draft.price) === null);
    if (invalid) { setError("Prices must be dollar amounts such as 1.55."); return; }
    setBusy(true);
    try { await apiJson(`/pricing/tiers/${tier.id}/prices`, sendJson("PUT", { [kind]: cells })); setDrafts({}); setNotice(`${cells.length} price(s) saved.`); reload(); }
    catch (caught) { setError(messageOf(caught, "Could not save prices.")); }
    finally { setBusy(false); }
  }

  return <section className="panel">
    <div className="toolbar">
      <label>Search<input onChange={(event) => setSearch(event.target.value)} placeholder={kind === "dishes" ? "Name or SKU" : "Option name"} value={search} /></label>
      <label className="check"><input checked={missingOnly} onChange={(event) => setMissingOnly(event.target.checked)} type="checkbox" />Only items without a price</label>
      <div className="form-actions" style={{ marginLeft: "auto" }}>
        {dirty ? <span className="hint">{dirty} unsaved change(s)</span> : null}
        <button className="secondary-button" disabled={!dirty || busy} onClick={() => setDrafts({})} type="button">Discard</button>
        <button className="primary-button" disabled={!dirty || busy} onClick={() => void save()} type="button">{busy ? "Saving..." : "Save changes"}</button>
      </div>
    </div>
    <p className="hint">{derivedTier ? "Blank uses the derived price; type one to override." : "Type a price for every item sold on this tier."} Tick “Not sold” to hide an item.</p>
    {error || loadError ? <p aria-live="polite" className="form-error">{error || loadError}</p> : null}{notice ? <p className="success-text">{notice}</p> : null}
    <div className="table-wrap"><table className="data-table"><thead><tr>
      {kind === "dishes" ? <th>SKU</th> : null}<th>{kind === "dishes" ? "Dish" : "Option"}</th><th>Cost</th>{derivedTier ? <th>Derived</th> : null}
      <th>{derivedTier ? "Override ($)" : "Price ($)"}</th><th>Not sold</th><th>Applies</th><th>Margin</th>
    </tr></thead><tbody>
      {data?.rows.map((row) => { const draft = draftOf(row); const [tone, label] = SOURCE_BADGE[row.source]; return <tr className={drafts[row.id] ? "dirty" : row.priceCents === null ? "missing" : ""} key={row.id}>
        {kind === "dishes" ? <td>{row.sku}</td> : null}<td>{row.name}</td><td>{formatCents(row.costCents)}</td>
        {derivedTier ? <td>{formatCents(row.derivedCents)}</td> : null}
        <td><input aria-label={`Price for ${row.name}`} disabled={draft.isUnavailable} inputMode="decimal" onChange={(event) => edit(row, { price: event.target.value })} placeholder={derivedTier ? "use derived" : "no price"} style={{ width: 110 }} value={draft.price} /></td>
        <td><input aria-label={`Not sold: ${row.name}`} checked={draft.isUnavailable} onChange={(event) => edit(row, { isUnavailable: event.target.checked })} style={{ width: "auto" }} type="checkbox" /></td>
        <td><strong>{formatCents(row.priceCents)}</strong> <span className={`badge ${tone}`}>{label}</span></td>
        <td className="muted">{row.priceCents ? `${Math.round(((row.priceCents - row.costCents) / row.priceCents) * 100)}%` : "—"}</td>
      </tr>; })}
      {data && !data.rows.length ? <tr><td className="muted" colSpan={8}>{missingOnly ? "Everything on this tier has a price." : "Nothing matches."}</td></tr> : null}
    </tbody></table></div>
  </section>;
}

function TierContent() {
  const { id } = useParams<{ id: string }>();
  const { data: tiers, error } = useResource<PriceTier[]>("/pricing/tiers");
  const [kind, setKind] = useState<"dishes" | "options">("dishes");
  const tier = tiers?.find((entry) => String(entry.id) === id);
  return <AppShell><main className="content-page wide">
    <BackLink href="/pricing" label="Back to pricing" />
    {error ? <p className="form-error">{error}</p> : !tiers ? <p className="muted">Loading...</p> : !tier ? <p className="form-error">Tier not found.</p> : <>
      <div className="page-heading"><div><h1>{tier.name} {tier.isDefault ? <span className="badge green">Default</span> : null}</h1></div><span className="hint">{describeRule(tier)}</span></div>
      <div className="tabs" role="tablist">{(["dishes", "options"] as const).map((entry) => <button aria-selected={entry === kind} className={entry === kind ? "tab active" : "tab"} key={entry} onClick={() => setKind(entry)} role="tab" type="button">{entry === "dishes" ? `Dishes${tier.unpricedDishes ? ` (${tier.unpricedDishes} missing)` : ""}` : `Options${tier.unpricedOptions ? ` (${tier.unpricedOptions} missing)` : ""}`}</button>)}</div>
      <Grid key={`${tier.id}-${kind}`} kind={kind} tier={tier} />
    </>}
  </main></AppShell>;
}

export default function TierPage() { return <ProtectedPage requires={[Capability.CATALOGUE_MANAGE]}><TierContent /></ProtectedPage>; }
