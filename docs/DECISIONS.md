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
