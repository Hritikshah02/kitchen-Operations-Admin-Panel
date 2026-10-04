"use client";

import { useState } from "react";
import { AppShell } from "../../components/app-shell";
import { BackLink } from "../../components/back-link";
import { EmployeePicker } from "../../components/employee-picker";
import { ProtectedPage } from "../../components/protected-page";
import { Capability } from "../../lib/capabilities";
import { DishCard } from "../../components/dish-card";
import type { EmployeeMenu } from "../../lib/types";
import { useResource } from "../../lib/use-resource";

function PreviewContent() {
  const [employeeId, setEmployeeId] = useState<number | null>(null); const [search, setSearch] = useState("");
  const query = employeeId ? `/menu/preview?employeeId=${employeeId}${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ""}` : null;
  const { data: menu, error } = useResource<EmployeeMenu>(query);
  return <AppShell><main className="content-page wide">
    <BackLink href="/menu" label="Back to menu" />
    <div className="page-heading"><h1>Preview as an employee</h1></div>
    <section className="panel"><EmployeePicker onChange={(employee) => setEmployeeId(employee?.id ?? null)} value={employeeId} /></section>
    {error ? <p className="form-error">{error}</p> : null}
    {menu ? <>
      <div className="notice" style={{ background: "#f3f6f4", borderColor: "var(--border)", color: "var(--foreground)" }}>
        <strong>{menu.employee.name}</strong> · {menu.company.name} · <strong>{menu.tier.name}</strong> prices
        {menu.employee.allergens.length ? <> · allergic to <span className="badge red">{menu.employee.allergens.map((entry) => entry.name).join(", ")}</span></> : null}
        {menu.employee.dietaryTags.length ? <> · prefers {menu.employee.dietaryTags.map((entry) => entry.name).join(", ")}</> : null}
        {!menu.company.isActive ? <span className="badge grey" style={{ marginLeft: 8 }}>Company deactivated</span> : null}
      </div>
      <label>Search the menu (also finds secret categories)<input onChange={(event) => setSearch(event.target.value)} placeholder="e.g. tray, paneer, GUJ-001" value={search} /></label>
      {search.trim() ? <section className="panel"><h2>Search results ({menu.searchResults.length})</h2><div className="dish-grid">{menu.searchResults.map((dish) => <DishCard dish={dish} key={dish.id} />)}</div></section> : null}
      {!search.trim() && menu.categories.length ? <nav aria-label="Categories" className="chip-group menu-nav">{menu.categories.map((category) => <a className="chip" href={`#category-${category.id}`} key={category.id}>{category.name} <span className="hint">{category.items.length}</span></a>)}</nav> : null}
      {menu.categories.map((category) => <section className="panel" id={`category-${category.id}`} key={category.id}><h2>{category.name}</h2>{category.description ? <p className="hint">{category.description}</p> : null}<div className="dish-grid">{category.items.map((dish) => <DishCard dish={dish} key={dish.id} />)}</div></section>)}
      {!menu.categories.length ? <p className="muted">Nothing on this employee&apos;s menu.</p> : null}
      <details className="panel"><summary><strong>Not shown to this employee ({menu.excluded.length})</strong></summary>
        <div className="table-wrap" style={{ marginTop: 12 }}><table className="data-table"><thead><tr><th>Dish</th><th>Category</th><th>Why</th></tr></thead><tbody>
          {menu.excluded.map((entry) => <tr key={`${entry.dishId}-${entry.category}`}><td>{entry.name}</td><td>{entry.category}</td><td>{entry.reason}</td></tr>)}
        </tbody></table></div>
      </details>
    </> : null}
  </main></AppShell>;
}

export default function MenuPreviewPage() { return <ProtectedPage requires={[Capability.ORDERS_MANAGE]}><PreviewContent /></ProtectedPage>; }
