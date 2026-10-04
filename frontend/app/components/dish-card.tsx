"use client";

import { cardImage } from "../lib/image";
import { formatCents } from "../lib/money";
import type { MenuDishView } from "../lib/types";

export function DishCard({ dish, onSelect }: { dish: MenuDishView; onSelect?: (dish: MenuDishView) => void }) {
  return <div className={`dish-card${dish.allergyConflicts.length ? " conflict" : ""}`}>
    {/* eslint-disable-next-line @next/next/no-img-element -- remote Cloudinary/stock URLs entered by staff */}
    {dish.imageUrl ? <img alt="" decoding="async" height={384} loading="lazy" src={cardImage(dish.imageUrl)} width={640} /> : <div className="dish-card-placeholder">{dish.name.slice(0, 1)}</div>}
    <div className="dish-card-body">
      <div className="panel-heading"><strong>{dish.name}</strong><strong>{formatCents(dish.priceCents)}</strong></div>
      {dish.allergyConflicts.length ? <p className="form-error">Contains {dish.allergyConflicts.map((entry) => entry.name).join(", ")}: the employee must acknowledge before ordering.</p> : null}
      <p className="hint">{dish.description}</p>
      <div className="chip-list">
        {dish.dietaryTags.map((tag) => <span className="badge grey" key={tag.id}>{tag.name}</span>)}
        {dish.allergens.map((allergen) => <span className={dish.allergyConflicts.some((entry) => entry.id === allergen.id) ? "badge red" : "badge amber"} key={allergen.id}>{allergen.name}</span>)}
      </div>
      {dish.groups.map((group) => <p className="hint" key={group.id}><strong>{group.name}</strong> ({group.required ? "required" : "optional"}{group.maxSelect > 1 ? `, up to ${group.maxSelect}` : ""}): {group.options.map((option) => `${option.name} +${formatCents(option.priceCents)}`).join(", ")}{group.usesPortions ? ` · sizes: ${group.sizes.map((size) => size.name).join("/")}` : ""}</p>)}
      {dish.minOrderQty > 1 ? <p className="hint">Minimum {dish.minOrderQty} per order</p> : null}
      {onSelect ? <button className="secondary-button" onClick={() => onSelect(dish)} type="button">Add to order</button> : null}
    </div>
  </div>;
}
