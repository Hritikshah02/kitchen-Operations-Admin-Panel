# Decisions and interpretations

Running log of how ambiguous parts of the brief were interpreted. Feeds the README's prioritisation notes.

## Platform
- **Brand and look:** the product is "Fernleaf Kitchen" (the name in the brief; it was briefly shown as just "Kitchen"). Warm theme: cream background, espresso-brown navigation, saffron accents; green is kept only for success states (delivered, active, paid).
- **Kitchen timezone:** Asia/Kolkata (kitchen in Ahmedabad). Cut-offs, delivery dates and "today" are computed in it, independent of server or browser timezone. The timezone is fixed at setup, not editable, because changing it would reinterpret every stored time.
- **Currency:** USD (prices entered in dollars; derived prices round up to the next 5 cents as the brief states).
- **Kitchen working days:** Mon–Sat by default; editable in Settings. Kitchen holidays are seeded from the 2026 Gujarat government list (verified) and 2027 estimates (marked "tentative").
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
- **Demo data:** `npm run db:seed` also generates realistic orders for the past 7 and next 6 kitchen working days, including today, in every status. They are built with the same menu and pricing rules, and only dates with no orders are filled, so it is safe to re-run daily. Because the kitchen works Mon–Sat, a Sunday or holiday has no orders "today".
- **Invoiced filter** on the order list arrives with billing (Phase 9).

## Kitchen board (Phase 7)

- **Prep unit** = one distinct combination on an order line, started and finished as a whole (a combination of quantity 12 is one click). Routed to its dish's station, or "Unassigned".
- **Only confirmed orders** appear on the board and can be worked on. Starting or finishing a unit twice is refused with who did it; finishing an unstarted unit also records the start.
- **Order times:** "kitchen started" is the first unit's start; "kitchen ready" is set only when every unit is done. Both are derived inside one transaction that locks the order row, so two people finishing the last two units at once still produce exactly one "kitchen ready".
- **Plan:** dispatch-ready = delivery time minus the company's delivery minutes; kitchen-ready = dispatch-ready minus the kitchen buffer (Settings, 30 min). It is computed on read from the delivery time, so an override moves it automatically, in the kitchen time zone.
- **Late / at risk:** late once the planned kitchen-ready time passes with the order unfinished; at risk in the 30 minutes before it. The board sorts late first, then at risk, then by planned time, and refreshes every 30 seconds.
- **Force-complete** (needs `kitchen-board:update` and `orders:override`) finishes every open unit, records missing starts, sets kitchen ready and writes timeline events naming the admin.
- **Performance:** the board loads a day's confirmed orders in one query and pages the order cards (25 per page); station counts and prep totals cover the whole day. Tested with 400 orders.
- **Demo data:** the seed also gives delivered orders their kitchen history and puts today's confirmed orders part-way through (some late), so the board looks alive on any working day.

## Dispatch and driver (Phase 8)

- **Drop** = confirmed orders with the same company, address, delivery date and exact delivery time. Drops are derived (nothing stored), so an admin changing one order's time or address moves it to its own drop automatically.
- **Steps per order, driven per drop:** kitchen ready → dispatch ready → out for delivery → delivered. Each step needs the previous one and a repeat is refused (409). Two people clicking at once: the drop's order rows are locked, so one wins and the other is told it was already done.
- **Partial drops:** kitchen-ready orders leave together. Dispatch waits for an order still cooking while it can still make its planned kitchen-ready time; an order already late is not waited for, the ready ones go, and the late one follows as a second trip within the same drop.
- **Drivers:** each drop shows the company's default driver unless dispatch assigns another (stored per order). "Out for delivery" needs a driver. The driver can be changed until the drop is out for delivery; after that it is locked. Only staff whose role has `driver-drops:update` can be chosen.
- **Driver view:** a driver sees only drops where they are the driver, for today in the kitchen time zone, in time order, including upcoming ones for planning; only drops that are out for delivery can be marked delivered, and only by that driver. Optional note and photo; the photo uploads straight to Cloudinary (folder `kitchen/deliveries`), and only Cloudinary links are accepted.
- **On time:** late minutes = minutes after the delivery time (never negative), always recorded. On time while within the **on-time grace** (Settings, default 5 min); beyond it the delivery is marked late. Delivering sets the order status to DELIVERED.
- **Demo data:** delivered orders get dispatch history and a driver (about a quarter arrive late); on a working day today's drops are spread across dispatch ready, out for delivery and delivered.

## Billing (Phase 9)

- **What is owed:** every confirmed order (confirmed or delivered) is owed in full by its company. Cancelled, rejected, draft and placed orders are never invoiced. Totals are pre-tax integer cents.
- **Invoices** are internal records: `INV-00001`, UNPAID → PAID, or VOID. Staff pick a company's uninvoiced orders and group them; an order sits on at most one invoice (`Order.invoiceId`), and creating an invoice locks the chosen order rows, so two people can't both invoice the same order.
- **Reconciliation:** an invoice total always equals the sum of its lines (order lines plus negative credit lines), checked in tests and shown on the invoice.
- **Cancelled or rejected before invoicing:** the order is simply excluded.
- **Cancelled or rejected after invoicing:** the invoice's order lines are never edited. A full credit is issued. On an *unpaid* invoice it is added as its own credit line (the total drops); on a *paid* invoice nothing changes and the credit is carried forward to the company's next invoice.
- **Short delivery** (delivered orders only): staff enter the missing quantity per item and the credit is that quantity × the unit price, never more than is left to credit on the order. Same placement rules: credit line on an unpaid invoice, carried forward from a paid one, or netted off the order if it hasn't been invoiced yet.
- **Carried-forward credits** are applied to the company's next invoice oldest first, without ever taking an invoice below zero; one that doesn't fit stays open for the following invoice.
- **Void:** unpaid invoices only, with a reason; its orders are released and can be invoiced again, credits carried from earlier invoices go back to open, and a credit raised on one of its own orders is netted off that order (or dropped if the order is no longer billable). **Paid invoices are final**: no void, no edits, only credits.
- **Capability:** `billing:manage` (admin). The orders list has an "invoiced" filter, and the order detail shows its invoice and credits.
- **Demo data:** delivered orders of finished weeks are invoiced per company (older weeks paid, the latest unpaid, one with a short-delivery credit); the current week stays uninvoiced.

## Dashboards (Phase 10)

- One dashboard per person, picked by capability (orders → kitchen → dispatch → driver, first match), never by role name. Admin, kitchen lead, dispatcher and driver each see only what their job needs; the exact figures and how they are calculated are defined in the README.
- Kitchen and dispatch figures come from the same services as the boards, so a dashboard can never disagree with the board behind it (tested).
- The "working day" is today, or the next kitchen working day when the kitchen is closed today, and the page says which.

## Hardening after review

- **Input errors are 4xx, never 500:** dates must be real calendar dates (not just `YYYY-MM-DD`-shaped), route ids and numbers beyond the database range are 404/400, NUL bytes are stripped from text, and database errors are mapped to plain messages (for example "This employee already has an order for that delivery date.").
- **Orders can't be placed for a past date.** Today is allowed (an admin can still place after cut-off); yesterday and earlier is refused with a clear message.
- **System cancellations leave a trail:** moving an employee, deactivating an employee, or deactivating a company cancels only draft/placed orders that are still before cut-off, and each gets a cancelled time, a reason, a version bump and a timeline event ("Cancelled automatically: ..."). Locked orders are kept and billed to the company (4.6).
- **Deactivating an employee** now cancels their open pre-cut-off orders the same way, instead of leaving them to be confirmed and billed.
- **Short-delivery credits are tracked per item:** the credited quantity of each combination is recorded, so the same missing box can't be credited twice.
- **A dish priced at $0 is treated as unpriced** and never shown (4.3 rule 5). Option prices of $0 stay valid.
- **Rate limiting:** sign-in is limited per account (5 a minute per email), so a forged `X-Forwarded-For` or many addresses don't help and a shared office IP can't lock people out; everything else is limited per client IP at 1000 a minute, because all users reach the API through the frontend's proxy and the boards poll. Only `TRUST_PROXY_HOPS` (default 1, Render's load balancer) proxy hops are trusted.
- **Dashboard aggregates** (dispatch stages, driver load, next departures) are computed over every drop of the day, not a page of them.
- **Employee CSV import** (4.5 [Should]): header row with `name` and `email` (plus optional phone, allergies, dietary preferences, three yes/no permission columns; several values separated by `;`). Every row is validated on its own (company domain, duplicates in the file and in the system, unknown allergy/preference, bad yes/no) and the file is never rejected as a whole: valid rows are created, bad rows come back with line number and reason. "Check file" runs the same validation without writing. Up to 500 rows per file.
- **Delivery photos** can only be taken with the camera or uploaded from the device (no URL field), and the server only accepts links to this project's own Cloudinary account.
- **Closed days:** the kitchen is closed on Sundays, so there are no orders or drops "today" then; this is intended.

## Demo data freshness

- **Every status, every day:** a coverage pass guarantees that each day around today shows every status that can exist then. Past days have delivered, cancelled and rejected orders; today has confirmed (then delivered as the day goes on), cancelled and rejected; coming days have drafts and placed orders, or confirmed ones once their cut-off has passed (plus cancelled and rejected). A missing status is added as an extra order, so it doesn't depend on luck.
- **Today follows the clock:** kitchen units, dispatch-ready, out-for-delivery and delivered happen at moments derived from the planned times (with per-drop jitter, so some run late). Only moments already behind "now" are recorded and progress never moves backwards, so each refresh moves the boards along. Yesterday's unfinished orders are completed when the day rolls over.
- **Self-refreshing:** with `DEMO_AUTO_REFRESH=true` (set on both Render services) the API tops up the demo data 15 seconds after it starts, so a reviewer waking it gets today's data, and every 30 minutes while awake. The daily GitHub job is a second safety net.
- **Closed days:** the kitchen is closed on Sundays and holidays, so there are no orders or drops that day; the dashboards show the next working day.
- **Time of day matters:** because progress follows real time, early in the morning the boards show work still to start, and in the evening everything is delivered. That is realistic, not a bug.

## After the independent evaluation

- **The demo simulator only touches sample data.** Seeded companies and the orders generated for them carry `isDemo`; the generator, the "today follows the clock" progression, past-day close-out, billing history and the driver drop for `driver@test.com` all ignore everything else. A reviewer's own company, employees and orders (including today's) are left exactly as they made them; if one of their orders clashes with a sample one (same employee and day) the sample one is skipped.
- **Sample history is believable:** no timestamp is in the future, an order is placed before it is cancelled or rejected, and each order's timeline is derived from its own timestamps (created, placed, confirmed, kitchen started/ready, dispatch ready, out, delivered or cancelled/rejected), each at the moment it happened. Old sample orders whose events were all stamped at one instant are rebuilt this way.
- **Closed days:** the kitchen, dispatch and driver pages open on the next working day with a note when the kitchen is closed today; the driver page still lists today's drops (none) and shows the next working day's drops below. The dashboards already did this.
- **Small things:** order links are plain text for roles that can't open orders; page-size errors give one clear message; the rate-limit reply is readable; saving a price for a dish that doesn't exist is a 400 instead of a database error.
