import type { MenuDish, Ref } from '../menu/menu-engine.js';

// Pure order-line validation and pricing (4.1, 4.6). Integer cents only.

export type ChoiceInput = { groupId: number; optionId: number; portionSizeId?: number | null };
export type CombinationInput = { quantity: number; choices: ChoiceInput[] };
export type LineInput = { dishId: number; quantity: number; combinations: CombinationInput[] };

export type PricedChoice = { groupId: number; groupName: string; optionId: number; optionName: string; portionSizeId: number | null; portionName: string | null; unitPriceCents: number };
export type PricedCombination = { signature: string; quantity: number; unitPriceCents: number; totalCents: number; choices: PricedChoice[] };
export type PricedLine = { dishId: number; dishName: string; dishSku: string; quantity: number; unitPriceCents: number; totalCents: number; combinations: PricedCombination[] };

/** Prices already locked on a placed order: kept for unchanged dish/combination pairs (4.1 "at what price"). */
export type PriceSnapshot = {
  dishUnit: ReadonlyMap<number, number>; // dishId -> unit price
  combination: ReadonlyMap<string, { unitPriceCents: number; choices: Map<string, number> }>; // `${dishId}|${signature}`
};

export type LineResult = { lines: PricedLine[]; totalCents: number; allergyConflicts: Ref[]; errors: string[] };

export const MAX_QUANTITY = 500;

/** Canonical key for a set of choices, so "brown rice + raita" and "raita + brown rice" are the same unit. */
export function signatureOf(choices: ChoiceInput[]): string {
  return [...choices]
    .map((choice) => `${choice.groupId}:${choice.optionId}:${choice.portionSizeId ?? '-'}`)
    .sort()
    .join('|') || 'plain';
}

const choiceKey = (choice: { groupId: number; optionId: number; portionSizeId?: number | null }) => `${choice.groupId}:${choice.optionId}:${choice.portionSizeId ?? '-'}`;

export function priceLines(inputs: LineInput[], menu: ReadonlyMap<number, MenuDish>, snapshot?: PriceSnapshot): LineResult {
  const errors: string[] = [];
  const conflicts = new Map<number, Ref>();
  const lines: PricedLine[] = [];
  const seenDishes = new Set<number>();

  inputs.forEach((input, lineIndex) => {
    const where = `Line ${lineIndex + 1}`;
    const dish = menu.get(input.dishId);
    if (!dish) { errors.push(`${where}: this dish is not on the employee's menu (hidden, unpriced or inactive).`); return; }
    const label = `${where} (${dish.name})`;
    if (seenDishes.has(dish.id)) { errors.push(`${label}: the dish appears twice; use one line with several combinations.`); return; }
    seenDishes.add(dish.id);
    if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > MAX_QUANTITY) { errors.push(`${label}: quantity must be between 1 and ${MAX_QUANTITY}.`); return; }
    if (input.quantity < dish.minOrderQty) errors.push(`${label}: the minimum order for this dish is ${dish.minOrderQty}.`);
    if (!input.combinations.length) { errors.push(`${label}: add at least one combination.`); return; }

    const sum = input.combinations.reduce((total, combination) => total + combination.quantity, 0);
    if (sum !== input.quantity) errors.push(`${label}: combination quantities add up to ${sum}, but the dish quantity is ${input.quantity}.`);
    dish.allergens.forEach((allergen) => dish.allergyConflicts.some((entry) => entry.id === allergen.id) && conflicts.set(allergen.id, allergen));

    const dishUnit = snapshot?.dishUnit.get(dish.id) ?? dish.priceCents;
    const merged = new Map<string, PricedCombination>();
    input.combinations.forEach((combination, comboIndex) => {
      const at = `${label}, combination ${comboIndex + 1}`;
      if (!Number.isInteger(combination.quantity) || combination.quantity < 1) { errors.push(`${at}: quantity must be at least 1.`); return; }
      const choices: PricedChoice[] = [];
      let valid = true;
      const byGroup = new Map<number, ChoiceInput[]>();
      for (const choice of combination.choices) {
        if (!dish.groups.some((group) => group.id === choice.groupId)) { errors.push(`${at}: a choice belongs to a group this dish doesn't offer.`); valid = false; continue; }
        byGroup.set(choice.groupId, [...(byGroup.get(choice.groupId) ?? []), choice]);
      }
      for (const group of dish.groups) {
        const picked = byGroup.get(group.id) ?? [];
        if (picked.length < group.minSelect) { errors.push(`${at}: choose ${group.minSelect === group.maxSelect ? group.minSelect : `at least ${group.minSelect}`} for "${group.name}".`); valid = false; }
        if (picked.length > group.maxSelect) { errors.push(`${at}: choose at most ${group.maxSelect} for "${group.name}".`); valid = false; }
        if (new Set(picked.map((choice) => choice.optionId)).size !== picked.length) { errors.push(`${at}: an option is chosen twice in "${group.name}".`); valid = false; }
        for (const choice of picked) {
          const option = group.options.find((entry) => entry.id === choice.optionId);
          if (!option) { errors.push(`${at}: an option in "${group.name}" is not available.`); valid = false; continue; }
          let size: Ref | null = null;
          if (group.usesPortions) {
            size = group.sizes.find((entry) => entry.id === choice.portionSizeId) ?? null;
            if (!size) { errors.push(`${at}: pick a size (${group.sizes.map((entry) => entry.name).join('/')}) for ${option.name}.`); valid = false; continue; }
          } else if (choice.portionSizeId) { errors.push(`${at}: "${group.name}" is not sold in sizes.`); valid = false; continue; }
          option.allergyConflicts.forEach((allergen) => conflicts.set(allergen.id, allergen));
          const current = option.priceCents + (size ? (option.surcharges[size.id] ?? 0) : 0);
          choices.push({ groupId: group.id, groupName: group.name, optionId: option.id, optionName: option.name, portionSizeId: size?.id ?? null, portionName: size?.name ?? null, unitPriceCents: current });
        }
      }
      if (!valid) return;
      const signature = signatureOf(choices);
      const locked = snapshot?.combination.get(`${dish.id}|${signature}`);
      if (locked) choices.forEach((choice) => { choice.unitPriceCents = locked.choices.get(choiceKey(choice)) ?? choice.unitPriceCents; });
      const unitPriceCents = locked?.unitPriceCents ?? dishUnit + choices.reduce((total, choice) => total + choice.unitPriceCents, 0);
      const existing = merged.get(signature);
      const quantity = (existing?.quantity ?? 0) + combination.quantity;
      merged.set(signature, { signature, quantity, unitPriceCents, totalCents: unitPriceCents * quantity, choices });
    });

    const combinations = [...merged.values()];
    lines.push({
      dishId: dish.id, dishName: dish.name, dishSku: dish.sku, quantity: input.quantity, unitPriceCents: dishUnit,
      totalCents: combinations.reduce((total, combination) => total + combination.totalCents, 0), combinations,
    });
  });

  return { lines, totalCents: lines.reduce((total, line) => total + line.totalCents, 0), allergyConflicts: [...conflicts.values()], errors };
}

/** Builds the snapshot of a placed order's locked prices from its stored lines. */
export function snapshotOf(lines: { dishId: number; unitPriceCents: number; combinations: { signature: string; unitPriceCents: number; choices: { groupId: number; optionId: number; portionSizeId: number | null; unitPriceCents: number }[] }[] }[]): PriceSnapshot {
  return {
    dishUnit: new Map(lines.map((line) => [line.dishId, line.unitPriceCents])),
    combination: new Map(lines.flatMap((line) => line.combinations.map((combination) => [
      `${line.dishId}|${combination.signature}`,
      { unitPriceCents: combination.unitPriceCents, choices: new Map(combination.choices.map((choice) => [choiceKey(choice), choice.unitPriceCents])) },
    ] as const))),
  };
}
