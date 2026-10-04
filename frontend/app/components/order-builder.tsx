"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { apiJson, messageOf, sendJson } from "../lib/api";
import { formatDay, formatInstant, kitchenToday, shiftDay } from "../lib/format";
import { formatCents } from "../lib/money";
import type { CompanyDetail, Employee, EmployeeMenu, MenuDishView, MenuGroupView, Option, OrderDetail, Quote } from "../lib/types";
import { useResource } from "../lib/use-resource";
import { EmployeePicker } from "./employee-picker";

type GroupPick = { optionIds: number[]; sizeId: number | null };
type ComboDraft = { quantity: number; picks: Record<number, GroupPick> };
export type LineDraft = { dish: MenuDishView; quantity: number; combinations: ComboDraft[] };

// "Tomorrow" in the kitchen's time zone, not the browser's.
const tomorrow = () => shiftDay(kitchenToday(), 1);

/** Fast default for a new combination: first option (and first size) in every required group. */
const defaultPicks = (dish: MenuDishView): Record<number, GroupPick> =>
  Object.fromEntries(dish.groups.map((group) => [group.id, { optionIds: group.required ? group.options.slice(0, group.minSelect).map((option) => option.id) : [], sizeId: group.usesPortions ? group.sizes[0]?.id ?? null : null }]));

const toApiLines = (lines: LineDraft[]) => lines.map((line) => ({
  dishId: line.dish.id,
  quantity: line.quantity,
  combinations: line.combinations.map((combination) => ({
    quantity: combination.quantity,
    choices: line.dish.groups.flatMap((group) => (combination.picks[group.id]?.optionIds ?? []).map((optionId) => ({ groupId: group.id, optionId, ...(group.usesPortions ? { portionSizeId: combination.picks[group.id]?.sizeId } : {}) }))),
  })),
}));

function GroupInput({ group, pick, onChange }: { group: MenuGroupView; pick: GroupPick; onChange: (pick: GroupPick) => void }) {
  const single = group.maxSelect === 1;
  return <div className="combo-group">
    <span className="hint">{group.name}{group.required ? " *" : ""}</span>
    {single ? <select onChange={(event) => onChange({ ...pick, optionIds: event.target.value ? [Number(event.target.value)] : [] })} value={pick.optionIds[0] ?? ""}>
      {!group.required ? <option value="">None</option> : <option disabled value="">Choose...</option>}
      {group.options.map((option) => <option key={option.id} value={option.id}>{option.name} (+{formatCents(option.priceCents)}){option.allergyConflicts.length ? " ⚠" : ""}</option>)}
    </select> : <div className="chip-list">{group.options.map((option) => <label className="chip" key={option.id}><input checked={pick.optionIds.includes(option.id)} onChange={(event) => onChange({ ...pick, optionIds: event.target.checked ? [...pick.optionIds, option.id] : pick.optionIds.filter((id) => id !== option.id) })} type="checkbox" />{option.name}{option.allergyConflicts.length ? " ⚠" : ""}</label>)}</div>}
    {group.usesPortions ? <select aria-label={`${group.name} size`} onChange={(event) => onChange({ ...pick, sizeId: Number(event.target.value) })} value={pick.sizeId ?? ""}>
      {group.sizes.map((size) => <option key={size.id} value={size.id}>{size.name}</option>)}
    </select> : null}
  </div>;
}

/** Rebuilds editable line drafts from a saved order, using the dishes' current definitions. */
export function linesFromOrder(order: OrderDetail, dishes: MenuDishView[]): LineDraft[] {
  const definitions = new Map(dishes.map((dish) => [dish.id, dish]));
  return order.lines.flatMap((line) => {
    const dish = definitions.get(line.dishId);
    if (!dish) return [];
    return [{ dish, quantity: line.quantity, combinations: line.combinations.map((combination) => ({
      quantity: combination.quantity,
      picks: Object.fromEntries(dish.groups.map((group) => {
        const chosen = combination.choices.filter((choice) => choice.groupId === group.id);
        return [group.id, { optionIds: chosen.map((choice) => choice.optionId), sizeId: chosen[0]?.portionSizeId ?? (group.usesPortions ? group.sizes[0]?.id ?? null : null) }];
      })),
    })) }];
  });
}

export function OrderBuilder({ order, initialLines = [] }: { order?: OrderDetail; initialLines?: LineDraft[] }) {
  const router = useRouter();
  const [employee, setEmployee] = useState<Pick<Employee, "id" | "name" | "canChooseAddress" | "canChangeDeliveryTime" | "canChangePackaging"> & { companyId: number } | null>(
    order ? { ...order.employee, companyId: order.company.id } : null,
  );
  const [deliveryDate, setDeliveryDate] = useState(order?.deliveryDate ?? tomorrow());
  const [lines, setLines] = useState<LineDraft[]>(initialLines);
  const [addressId, setAddressId] = useState<number | undefined>(order?.addressId);
  const [deliveryTime, setDeliveryTime] = useState<string | undefined>(order?.deliveryTime);
  const [packagingTypeId, setPackagingTypeId] = useState<number | undefined>(order?.packagingTypeId ?? undefined);
  const [notes, setNotes] = useState(order?.notes ?? ""); const [acknowledged, setAcknowledged] = useState(order?.allergyAcknowledged ?? false);
  const [search, setSearch] = useState(""); const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");

  const { data: menu } = useResource<EmployeeMenu>(employee ? `/menu/preview?employeeId=${employee.id}${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ""}` : null);
  const { data: company } = useResource<CompanyDetail>(employee ? `/companies/${employee.companyId}` : null);
  const { data: packaging } = useResource<Option[]>("/reference-data/packaging-types");


  const payload = useMemo(() => employee && lines.length ? {
    employeeId: employee.id, deliveryDate, lines: toApiLines(lines), notes: notes.trim() || null, allergyAcknowledged: acknowledged,
    ...(addressId !== undefined ? { addressId } : {}), ...(deliveryTime !== undefined ? { deliveryTime } : {}), ...(packagingTypeId !== undefined ? { packagingTypeId } : {}),
  } : null, [acknowledged, addressId, deliveryDate, deliveryTime, employee, lines, notes, packagingTypeId]);
  const orderId = order?.id;

  // Live server-side validation and price breakdown, debounced.
  useEffect(() => {
    if (!payload) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      apiJson<Quote>("/orders/quote", sendJson("POST", { ...payload, ...(orderId ? { orderId } : {}) }))
        .then((result) => { if (!cancelled) { setQuote(result); setError(""); } })
        .catch((caught) => { if (!cancelled) { setQuote(null); setError(messageOf(caught, "Could not price the order.")); } });
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [orderId, payload]);

  const updateLine = (index: number, patch: Partial<LineDraft>) => setLines(lines.map((line, position) => position === index ? { ...line, ...patch } : line));
  const updateCombo = (lineIndex: number, comboIndex: number, patch: Partial<ComboDraft>) =>
    updateLine(lineIndex, { combinations: lines[lineIndex].combinations.map((combo, position) => position === comboIndex ? { ...combo, ...patch } : combo) });
  function addDish(dish: MenuDishView) {
    const existing = lines.findIndex((line) => line.dish.id === dish.id);
    if (existing >= 0) { setError(`${dish.name} is already on the order: add a combination to it instead.`); return; }
    const quantity = Math.max(1, dish.minOrderQty);
    setLines([...lines, { dish, quantity, combinations: [{ quantity, picks: defaultPicks(dish) }] }]);
  }
  function setQuantity(index: number, quantity: number) {
    const line = lines[index];
    // With a single combination, it follows the dish quantity; with several, staff split it themselves.
    updateLine(index, { quantity, combinations: line.combinations.length === 1 ? [{ ...line.combinations[0], quantity }] : line.combinations });
  }

  async function submit(action: "draft" | "place" | "save") {
    if (!payload) return;
    setBusy(true); setError("");
    const { employeeId, ...content } = payload;
    try {
      const saved = order
        ? await apiJson<OrderDetail>(`/orders/${order.id}`, sendJson("PUT", { ...content, version: order.version }))
        : await apiJson<OrderDetail>("/orders", sendJson("POST", { ...content, employeeId, place: action === "place" }));
      router.push(`/orders/${saved.id}`);
    } catch (caught) { setError(messageOf(caught, "Could not save the order.")); setBusy(false); }
  }

  const quoteLine = (dishId: number) => quote?.lines.find((line) => line.dishId === dishId);
  const assigned = (line: LineDraft) => line.combinations.reduce((sum, combo) => sum + combo.quantity, 0);
  const browse = menu ? (search.trim() ? [{ id: -1, name: "Search results", items: menu.searchResults }] : menu.categories) : [];

  return <div className="builder">
    <div className="builder-main">
      <section className="panel">
        <h2>Employee and date</h2>
        {order ? <p><strong>{order.employee.name}</strong> · {order.company.name}</p> : <EmployeePicker onChange={(picked) => { setEmployee(picked ? { ...picked, companyId: picked.company.id } : null); setLines([]); setQuote(null); setAddressId(undefined); setDeliveryTime(undefined); setPackagingTypeId(undefined); }} value={employee?.id ?? null} />}
        <div className="form-grid">
          <label>Delivery date<input onChange={(event) => setDeliveryDate(event.target.value)} required type="date" value={deliveryDate} /><span className="hint">{formatDay(deliveryDate)}</span></label>
          {quote ? <p className={quote.pastCutoff ? "notice" : "hint"}>{quote.pastCutoff ? "Cut-off passed " : "Orders for this date lock "}{formatInstant(quote.cutoffAt)}{quote.pastCutoff ? ": only an admin can add or change orders; placing confirms immediately." : "."}</p> : null}
        </div>
        {menu?.employee.allergens.length ? <p className="notice">{menu.employee.name} is allergic to <strong>{menu.employee.allergens.map((allergen) => allergen.name).join(", ")}</strong>. Affected items are marked ⚠.</p> : null}
      </section>

      {employee && company ? <section className="panel">
        <h2>Delivery</h2>
        <div className="form-grid">
          <label>Address<select disabled={!employee.canChooseAddress} onChange={(event) => setAddressId(Number(event.target.value))} value={addressId ?? company.addresses.find((address) => address.isDefault)?.id ?? ""}>
            {company.addresses.filter((address) => address.isActive).map((address) => <option key={address.id} value={address.id}>{address.label}{address.isDefault ? " (default)" : ""}</option>)}
          </select>{!employee.canChooseAddress ? <span className="hint">Fixed to company default</span> : null}</label>
          <label>Time<input disabled={!employee.canChangeDeliveryTime} max={company.deliveryWindowEnd} min={company.deliveryWindowStart} onChange={(event) => setDeliveryTime(event.target.value)} type="time" value={deliveryTime ?? company.defaultDeliveryTime} /><span className="hint">{employee.canChangeDeliveryTime ? `Within ${company.deliveryWindowStart}–${company.deliveryWindowEnd}` : "Fixed to company default"}</span></label>
          <label>Packaging<select disabled={!employee.canChangePackaging} onChange={(event) => setPackagingTypeId(Number(event.target.value))} value={packagingTypeId ?? company.defaultPackagingTypeId ?? ""}>
            <option disabled value="">None</option>{packaging?.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
          </select>{!employee.canChangePackaging ? <span className="hint">Fixed to company default</span> : null}</label>
        </div>
        <label>Notes for the kitchen<input maxLength={500} onChange={(event) => setNotes(event.target.value)} value={notes} /></label>
      </section> : null}

      {employee ? <section className="panel">
        <div className="panel-heading"><h2>{menu ? `${menu.employee.name}'s menu` : "Menu"}</h2>{menu ? <span className="hint">{menu.tier.name} prices</span> : null}</div>
        <input aria-label="Search the menu" onChange={(event) => setSearch(event.target.value)} placeholder="Search by name or SKU" value={search} />
        {browse.map((category) => <div key={category.id}><p className="eyebrow" style={{ margin: "10px 0 6px" }}>{category.name}</p>
          <div className="table-wrap"><table className="data-table"><tbody>{category.items.map((dish) => <tr key={dish.id}>
            <td><strong>{dish.name}</strong> <span className="hint">{dish.sku}</span>{dish.allergyConflicts.length ? <span className="badge red" style={{ marginLeft: 6 }}>⚠ {dish.allergyConflicts.map((allergen) => allergen.name).join(", ")}</span> : null}{dish.minOrderQty > 1 ? <span className="hint"> · min {dish.minOrderQty}</span> : null}</td>
            <td>{formatCents(dish.priceCents)}</td>
            <td><div className="row-actions"><button className="secondary-button" disabled={lines.some((line) => line.dish.id === dish.id)} onClick={() => addDish(dish)} type="button">Add</button></div></td>
          </tr>)}{!category.items.length ? <tr><td className="muted">Nothing matches.</td></tr> : null}</tbody></table></div>
        </div>)}
      </section> : null}
    </div>

    <aside className="builder-side panel">
      <h2>Order</h2>
      {!lines.length ? <p className="muted">{employee ? "Add dishes from the menu." : "Choose an employee first."}</p> : null}
      {lines.map((line, lineIndex) => { const priced = quoteLine(line.dish.id); return <div className="order-line" key={line.dish.id}>
        <div className="panel-heading"><strong>{line.dish.name}</strong><button className="quiet-link" onClick={() => setLines(lines.filter((_, position) => position !== lineIndex))} type="button">Remove</button></div>
        <div className="form-actions">
          <label className="inline-label">Qty<input max={500} min={1} onChange={(event) => setQuantity(lineIndex, Number(event.target.value))} style={{ width: 80 }} type="number" value={line.quantity} /></label>
          <span className="hint">{formatCents(line.dish.priceCents)} each + choices</span>
          {assigned(line) !== line.quantity ? <span className="badge red">{assigned(line)} of {line.quantity} assigned</span> : null}
        </div>
        {line.combinations.map((combo, comboIndex) => <div className="combo" key={comboIndex}>
          <div className="form-actions"><label className="inline-label">×<input max={500} min={1} onChange={(event) => updateCombo(lineIndex, comboIndex, { quantity: Number(event.target.value) })} style={{ width: 70 }} type="number" value={combo.quantity} /></label>
            {priced?.combinations[comboIndex] ? <span className="hint">{formatCents(priced.combinations[comboIndex].unitPriceCents)} each = {formatCents(priced.combinations[comboIndex].totalCents)}</span> : null}
            {line.combinations.length > 1 ? <button className="quiet-link" onClick={() => updateLine(lineIndex, { combinations: line.combinations.filter((_, position) => position !== comboIndex) })} type="button">Remove</button> : null}</div>
          {line.dish.groups.map((group) => <GroupInput group={group} key={group.id} onChange={(pick) => updateCombo(lineIndex, comboIndex, { picks: { ...combo.picks, [group.id]: pick } })} pick={combo.picks[group.id] ?? { optionIds: [], sizeId: null }} />)}
        </div>)}
        {line.dish.groups.length ? <button className="secondary-button" onClick={() => updateLine(lineIndex, { combinations: [...line.combinations, { quantity: Math.max(1, line.quantity - assigned(line)), picks: defaultPicks(line.dish) }] })} type="button">+ Split into another combination</button> : null}
        {priced ? <p className="line-total">Line total <strong>{formatCents(priced.totalCents)}</strong></p> : null}
      </div>; })}

      {quote?.errors.length ? <ul className="form-error error-list">{quote.errors.map((message) => <li key={message}>{message}</li>)}</ul> : null}
      {error ? <p aria-live="polite" className="form-error">{error}</p> : null}
      {quote?.allergyConflicts.length ? <label className="notice check"><input checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} style={{ width: "auto" }} type="checkbox" /> Contains {quote.allergyConflicts.map((allergen) => allergen.name).join(", ")}. I confirmed this with the employee.</label> : null}
      {quote && lines.length ? <div className="order-total"><span>Total ({quote.tier.name})</span><strong>{formatCents(quote.totalCents)}</strong></div> : null}
      <div className="form-actions">
        {order ? <button className="primary-button" disabled={busy || !payload} onClick={() => void submit("save")} type="button">{busy ? "Saving..." : "Save changes"}</button> : <>
          <button className="secondary-button" disabled={busy || !payload} onClick={() => void submit("draft")} type="button">Save draft</button>
          <button className="primary-button" disabled={busy || !payload || Boolean(quote?.errors.length)} onClick={() => void submit("place")} type="button">{busy ? "Placing..." : "Place order"}</button>
        </>}
      </div>
    </aside>
  </div>;
}
