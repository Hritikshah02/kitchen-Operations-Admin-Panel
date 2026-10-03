"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { AppShell } from "../components/app-shell";
import { ProtectedPage } from "../components/protected-page";
import { apiJson, messageOf, sendJson } from "../lib/api";
import { Capability } from "../lib/capabilities";
import { describeRule, type PriceRule, type PriceTier } from "../lib/types";
import { useResource } from "../lib/use-resource";

/** Rule editor shared by "new tier" and "edit tier". Values are entered as a multiplier (2.4) or percent (15, -8). */
function TierForm({ tier, tiers, onDone }: { tier: PriceTier | null; tiers: PriceTier[]; onDone: (message: string) => void }) {
  const [name, setName] = useState(tier?.name ?? ""); const [rule, setRule] = useState<PriceRule>(tier?.rule ?? "MANUAL");
  const [value, setValue] = useState(tier?.ruleValueBps === null || tier?.ruleValueBps === undefined ? "" : String(tier.rule === "COST_MULTIPLIER" ? tier.ruleValueBps / 10000 : tier.ruleValueBps / 100));
  const [baseTierId, setBaseTierId] = useState(String(tier?.baseTierId ?? "")); const [busy, setBusy] = useState(false); const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const number = Number(value);
    if (rule !== "MANUAL" && (value.trim() === "" || !Number.isFinite(number))) { setError("Enter a number for the rule."); return; }
    const ruleValueBps = rule === "MANUAL" ? null : Math.round(number * (rule === "COST_MULTIPLIER" ? 10000 : 100));
    setBusy(true);
    try {
      const body = { name, rule, ruleValueBps, baseTierId: rule === "TIER_PERCENT" ? Number(baseTierId) || null : null };
      await apiJson(tier ? `/pricing/tiers/${tier.id}` : "/pricing/tiers", sendJson(tier ? "PATCH" : "POST", body));
      onDone(`${name} saved.`);
    } catch (caught) { setError(messageOf(caught, "Could not save tier.")); }
    finally { setBusy(false); }
  }

  return <form className="panel" onSubmit={save}><fieldset className="panel-fieldset" disabled={busy}>
    <h2>{tier ? `Edit ${tier.name}` : "New price tier"}</h2>
    <div className="form-grid">
      <label>Name<input maxLength={40} onChange={(event) => setName(event.target.value)} placeholder="Enterprise" required value={name} /></label>
      <label>Pricing<select onChange={(event) => setRule(event.target.value as PriceRule)} value={rule}>
        <option value="MANUAL">Type every price</option><option value="COST_MULTIPLIER">Derive: cost × multiplier</option><option value="TIER_PERCENT">Derive: another tier ± %</option>
      </select></label>
      {rule === "COST_MULTIPLIER" ? <label>Multiplier<input inputMode="decimal" onChange={(event) => setValue(event.target.value)} placeholder="2.4" required value={value} /></label> : null}
      {rule === "TIER_PERCENT" ? <>
        <label>Based on<select onChange={(event) => setBaseTierId(event.target.value)} required value={baseTierId}><option value="">Choose a tier</option>{tiers.filter((entry) => entry.id !== tier?.id).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
        <label>Adjust by (%)<input inputMode="decimal" onChange={(event) => setValue(event.target.value)} placeholder="15 or -8" required value={value} /></label>
      </> : null}
    </div>
    <p className="hint">Derived prices round up to the next 5 cents ($2.11 → $2.15). Individual prices can still be overridden or marked not sold on the tier grid. Price changes only affect orders placed afterwards.</p>
    {error ? <p aria-live="polite" className="form-error">{error}</p> : null}
    <div className="form-actions"><button className="primary-button" type="submit">Save tier</button><button className="secondary-button" onClick={() => onDone("")} type="button">Cancel</button></div>
  </fieldset></form>;
}

function PricingContent() {
  const { data: tiers, error, reload } = useResource<PriceTier[]>("/pricing/tiers");
  const [editing, setEditing] = useState<PriceTier | "new" | null>(null); const [notice, setNotice] = useState(""); const [actionError, setActionError] = useState("");
  const done = (message: string) => { setEditing(null); setNotice(message); reload(); };
  async function makeDefault(tier: PriceTier) {
    setActionError("");
    try { await apiJson(`/pricing/tiers/${tier.id}/make-default`, sendJson("POST")); done(`${tier.name} is now the default tier.`); }
    catch (caught) { setActionError(messageOf(caught, "Could not change the default tier.")); }
  }
  return <AppShell><main className="content-page wide">
    <div className="page-heading"><div><p className="eyebrow">Administration</p><h1>Pricing</h1></div><button className="primary-button" onClick={() => setEditing("new")} type="button">New tier</button></div>
    <p className="hint">Each company is on a tier (or the default tier). A dish with no price on an employee&apos;s tier does not appear on their menu at all.</p>
    {editing && tiers ? <TierForm key={editing === "new" ? "new" : editing.id} onDone={done} tier={editing === "new" ? null : editing} tiers={tiers} /> : null}
    {error || actionError ? <p className="form-error">{error || actionError}</p> : null}{notice ? <p className="success-text">{notice}</p> : null}
    <div className="table-wrap"><table className="data-table"><thead><tr><th>Tier</th><th>Pricing</th><th>Companies</th><th>Dishes without a price</th><th>Options without a price</th><th /></tr></thead><tbody>
      {tiers?.map((tier) => <tr key={tier.id}>
        <td><Link className="link" href={`/pricing/${tier.id}`}>{tier.name}</Link> {tier.isDefault ? <span className="badge green">Default</span> : null}</td>
        <td>{describeRule(tier)}</td>
        <td>{tier.companyCount}{tier.isDefault ? " + companies without a tier" : ""}</td>
        <td>{tier.unpricedDishes ? <span className="badge red">{tier.unpricedDishes} missing</span> : <span className="badge green">All priced</span>}</td>
        <td>{tier.unpricedOptions ? <span className="badge red">{tier.unpricedOptions} missing</span> : <span className="badge green">All priced</span>}</td>
        <td><div className="row-actions">
          <Link className="secondary-button" href={`/pricing/${tier.id}`}>Edit prices</Link>
          <button className="secondary-button" onClick={() => setEditing(tier)} type="button">Edit rule</button>
          {!tier.isDefault ? <button className="secondary-button" onClick={() => void makeDefault(tier)} type="button">Make default</button> : null}
        </div></td>
      </tr>)}
    </tbody></table></div>
  </main></AppShell>;
}

export default function PricingPage() { return <ProtectedPage requires={[Capability.CATALOGUE_MANAGE]}><PricingContent /></ProtectedPage>; }
