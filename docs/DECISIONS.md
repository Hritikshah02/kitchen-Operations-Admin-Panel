# Decisions and interpretations

Running log of how ambiguous parts of the brief were interpreted. Feeds the README's prioritisation notes.

## Platform
- **Kitchen timezone:** Asia/Kolkata (kitchen in Ahmedabad). Cut-offs, delivery dates and "today" are computed in it, independent of server or browser timezone. The timezone is fixed at setup, not editable, because changing it would reinterpret every stored time.
- **Currency:** USD (prices entered in dollars; derived prices round up to the next 5 cents as the brief states).
- **Kitchen working days:** Mon–Fri by default; editable in Settings. Kitchen holidays are seeded from the 2026 Gujarat government list (verified) and 2027 estimates (marked "tentative").
- **Roles are data:** each role row holds a list of capabilities; the server only ever checks capabilities. A new role is a new row, not a code change.

## Companies (4.4)
- **Email domains** are globally unique and public providers (gmail.com, yahoo.co.in, ...) are rejected.
- **Employee email must use one of the company's domains** (server-enforced on create, email change, reactivation and move). A domain still used by active employees cannot be removed, and a company always keeps at least one domain.
- **Owner:** created together with the company as its first employee, so an active company always has one. The owner cannot be deactivated or moved until another owner is chosen.
- **Addresses:** one or more, exactly one default; deactivated rather than deleted so past orders keep a valid address. The default cannot be deactivated.
- **Calendar:** a delivery date needs the kitchen open and the company receiving (working weekday, not a company holiday). The company calendar never moves the cut-off, which counts kitchen working days only.
- **Delivery time:** each company has a default time and a delivery window; employees allowed to change the time pick inside that window.
- **Packaging types** are an admin-managed reference list (like allergens and stations), since the brief requires a default packaging type but does not list packaging among reference data.
- **Default driver:** any active staff member with the delivery capability (chosen by capability, not role name).
- **Deactivating a company** hides it from ordering and cancels its draft and placed orders that are still before cut-off. Placed orders already past cut-off are locked (4.6): they are kept, confirmed by cut-off processing and billed to the company. Confirmed orders are untouched. The same cut-off rule applies when an employee is moved.

## Employees (4.5)
- **"Can choose their own delivery address"** means choosing among the company's active addresses (not free text), which keeps the drop grouping in 4.8 meaningful.
- **Moving to another company** takes priority over open orders. On a move:
  - draft and placed orders still **before their cut-off** are cancelled (they were made under the old company's rules);
  - placed orders **already past cut-off** but not yet processed are locked, so they are kept on the old company and confirmed by cut-off processing as usual;
  - confirmed and later orders keep the old company and stay billed to it;
  - the three permission flags are reset and set afresh for the new company (none unless staff tick them on the move form);
  - the email must change to a domain of the new company. The owner cannot be moved until another owner is chosen.
- **Allergies** use the allergen list; **dietary preferences** use the dietary tag list.
- **CSV import [Should]:** deferred until the Must items are done.

## Catalogue (4.1)
- **Money** is stored and computed as integer cents; the UI parses dollar input as text, never through floats.
- **Prices:** the researched Ahmedabad rupee prices are converted at ₹85 = $1, rounded up to the next 5 cents, so a ₹130 thali is $1.55. They're low by US standards because they're real local prices.
- **Option groups are reusable:** a group ("Choose your roti") is defined once and attached to many dishes, in a per-dish display order. The group carries its own rules: minimum choices (0 = optional, 1+ = required) and maximum choices.
- **Portions:** a group either sells sizes or not. If it does, every option in it must have a surcharge for every size the group offers. This is enforced whenever options, sizes or surcharges change. Surcharges are per option and size, the same on every price tier.
- **Minimum order quantity** applies to one order line (the dish quantity on an order).
- **Images:** an https URL per dish. Uploads go straight from the browser to Cloudinary using a short-lived signature from the API (the secret never leaves the server); enabled when `CLOUDINARY_URL` is set, otherwise staff paste a URL.
- **Deactivate, never delete:** dishes and options are deactivated; past orders keep referencing them.

## Pricing (4.3)
- **Tiers** are either typed (every price entered) or derived: `cost × multiplier` or `another tier ± %`. A derived tier can be based on another derived tier; loops are refused.
- **Resolution order** for an item on a tier: marked "not sold" → no price; a typed price or override → that price as typed; otherwise the rule, rounded **up** to the next 5 cents ($2.11 → $2.15). Rounding is integer/BigInt arithmetic on the exact value, never floats.
- **No price = not on the menu.** An item without a price (missing, or not sold) on the employee's tier is left off their menu entirely, never shown at $0. If a base tier lacks a price, tiers derived from it lack one too.
- **Company tier** is optional; companies without one use the single default tier.
- **Portion surcharges** are added on top of the option's tier price and are the same on every tier.
- **Prices affect new orders only:** orders snapshot the prices they were placed with (Phase 6).
- **Seed:** Standard (default, typed) uses the researched prices; Enterprise = Standard − 8%; Partner = cost × 1.6. The research also suggested a floor of Standard − 15% for Partner, which is not modelled. Mineral water deliberately has no Standard price, and the seasonal Undhiyu box is marked not sold on Enterprise, to show both cases.

## Menu (4.2)
- **Categories** are ordered and can be switched off; each lists dishes in order, and each item can be switched off within that category. A dish may appear in several categories.
- **Hiding is per company:** whole categories, or individual dishes. A hidden dish is hidden in every category it appears in.
- **Secret categories** are left out of the browsable menu, but their dishes are found by searching (name or SKU) when staff build an order. Company hiding wins over secrecy: hidden items are not reachable at all.
- **What an employee sees** = active category, not hidden for their company, item on, dish active, dish has a price on their tier, and every required option group still has enough priced, sellable options. An optional group with nothing to offer is simply not shown.
- **Preview** shows the menu exactly as a chosen employee sees it, at their tier's prices, with their allergies highlighted. It also lists every dish left out and why ("No price on the Standard tier", "Dish is hidden for this company", ...).
- **One rule set:** the same pure function drives the preview and the server-side order validation, so the menu and what an order accepts cannot drift apart.

## Orders (4.6)
- **One active order per employee per delivery date** (cancelled and rejected ones don't count), enforced by a partial unique index as well as the API. An order has lines (one per dish) and each line has combinations whose quantities must add up exactly to the dish quantity; identical combinations are merged, so the kitchen sees one prep unit per distinct combination.
- **Server-side validation** covers everything: employee and company active, the kitchen open and the company receiving on that date, delivery address, time and packaging only where the employee may choose, dish on the employee's menu (secret categories included, hidden ones excluded), every required group satisfied, max choices, portion sizes, minimum order quantity. All problems are returned at once. The builder shows a live server-side quote.
- **Prices lock when placed:** drafts show today's prices and are re-priced when placed. Once placed, unchanged items keep their placed prices even if edited later; new items use current prices. Lines snapshot dish names and SKUs so catalogue edits never change a past order.
- **Cut-off:** before it, drafts and placed orders can be edited or cancelled. After it, only staff with the `orders:override` capability (admins) can. An admin placing an order after the cut-off confirms it immediately, because that date's processing has already run.
- **Cut-off processing** cancels drafts and confirms placed orders (they become billable). It runs every minute while the server is up, catches up on start-up (the free Render instance sleeps), runs before order lists and details are read, and can be triggered by hand for a past cut-off on the Orders page. A per-date Postgres advisory lock plus status-guarded updates make it safe to run twice or concurrently. Each run is logged.
- **Rejected** = the kitchen can't fulfil a placed or confirmed order (admin only, reason required). Never billable. **Cancelled** = withdrawn, or still a draft at cut-off.
- **Allergies:** if an order contains something the employee is allergic to, placing it requires an explicit "confirmed with the employee" acknowledgement, recorded on the timeline.
- **Concurrency:** every write carries the version it read; a stale write is refused ("someone else changed this order"), so two staff can't silently overwrite each other.
- **Admin overrides** after confirmation: delivery time, address (any of the company's active ones) and packaging, ignoring the employee's permission flags; recorded on the timeline.
- **Timeline:** every create, edit, place, confirmation, cancellation, rejection, delivery change and allergy acknowledgement is an order event with who did it (or "System").
- **Demo data:** `npm run db:seed` also generates realistic orders for the past 7 and next 5 kitchen working days, including today, in every status. They are built with the same menu and pricing rules, and only dates with no orders are filled, so it is safe to re-run daily. Because the kitchen works Mon–Fri, a weekend or holiday has no orders "today".
- **Invoiced filter** on the order list arrives with billing (Phase 9).
