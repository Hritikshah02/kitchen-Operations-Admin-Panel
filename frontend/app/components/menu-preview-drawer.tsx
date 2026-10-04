"use client";

import { useEffect, useState } from "react";
import type { Employee, EmployeeMenu } from "../lib/types";
import { useResource } from "../lib/use-resource";
import { DishCard } from "./dish-card";
import { EmployeePicker } from "./employee-picker";

/** The menu exactly as the chosen employee sees it when ordering, in a side panel over the current page. */
function Drawer({ onClose }: { onClose: () => void }) {
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [choosing, setChoosing] = useState(true); const [search, setSearch] = useState("");
  const query = employee ? `/menu/preview?employeeId=${employee.id}${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ""}` : null;
  const { data: menu, error, loading } = useResource<EmployeeMenu>(query);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; };
  }, [onClose]);

  const searching = search.trim().length > 0;
  return <div className="drawer-backdrop" onClick={onClose} role="presentation">
    <aside aria-label="Menu preview" aria-modal="true" className="drawer" onClick={(event) => event.stopPropagation()} role="dialog">
      <header className="drawer-header">
        <div className="drawer-title"><h2>Menu preview</h2><button aria-label="Close preview" className="drawer-close" onClick={onClose} type="button">✕</button></div>
        {employee && !choosing
          ? <div className="drawer-employee"><span><strong>{employee.name}</strong> <span className="hint">· {employee.company.name}</span></span><button className="link-button" onClick={() => setChoosing(true)} type="button">Change</button></div>
          : <EmployeePicker onChange={(next) => { setEmployee(next); setSearch(""); if (next) setChoosing(false); }} value={employee?.id ?? null} />}
      </header>
      <div className="drawer-body">
        {!employee ? <p className="muted">Choose an employee to see their menu with their prices and rules.</p> : null}
        {error ? <p className="form-error">{error}</p> : null}
        {employee && menu ? <>
          <input aria-label="Search the menu" className="drawer-search" onChange={(event) => setSearch(event.target.value)} placeholder="Search dishes" type="search" value={search} />
          {searching ? <section className="drawer-section"><h3>Search results</h3>{menu.searchResults.length ? <div className="dish-grid">{menu.searchResults.map((dish) => <DishCard dish={dish} key={dish.id} />)}</div> : <p className="muted">Nothing found.</p>}</section> : <>
            {menu.categories.length ? <nav aria-label="Categories" className="chip-group menu-nav">{menu.categories.map((category) => <a className="chip" href={`#preview-category-${category.id}`} key={category.id}>{category.name}</a>)}</nav> : null}
            {menu.categories.map((category) => <section className="drawer-section" id={`preview-category-${category.id}`} key={category.id}><h3>{category.name}</h3>{category.description ? <p className="hint">{category.description}</p> : null}<div className="dish-grid">{category.items.map((dish) => <DishCard dish={dish} key={dish.id} />)}</div></section>)}
            {!menu.categories.length ? <p className="muted">Nothing on this employee&apos;s menu.</p> : null}
          </>}
        </> : null}
        {employee && !menu && loading ? <p className="muted">Loading the menu...</p> : null}
      </div>
    </aside>
  </div>;
}

/** A button that opens the preview panel; the chosen employee is forgotten when the panel closes. */
export function MenuPreviewButton() {
  const [open, setOpen] = useState(false);
  return <>
    <button className="secondary-button" onClick={() => setOpen(true)} type="button">Preview as an employee</button>
    {open ? <Drawer onClose={() => setOpen(false)} /> : null}
  </>;
}
