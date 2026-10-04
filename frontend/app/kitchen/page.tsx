"use client";

import { useEffect, useState } from "react";
import { OrderRef } from "../components/order-ref";
import { AppShell } from "../components/app-shell";
import { can, useAuth } from "../components/auth-provider";
import { Pagination } from "../components/form-controls";
import { ProtectedPage } from "../components/protected-page";
import { apiJson, messageOf, sendJson } from "../lib/api";
import { Capability } from "../lib/capabilities";
import { formatDay, formatInstant, formatTime, kitchenToday, shiftDay } from "../lib/format";
import type { KitchenBoard, KitchenCard, KitchenTiming, KitchenUnit } from "../lib/types";
import { useResource } from "../lib/use-resource";

const TIMING_LABEL: Record<KitchenTiming, string> = { LATE: "Late", AT_RISK: "At risk", ON_TRACK: "On track", DONE: "Kitchen ready" };
const TIMING_BADGE: Record<KitchenTiming, string> = { LATE: "red", AT_RISK: "amber", ON_TRACK: "grey", DONE: "green" };
const STATE_LABEL = { PENDING: "To do", STARTED: "Cooking", DONE: "Done" } as const;
const STATE_BADGE = { PENDING: "grey", STARTED: "amber", DONE: "green" } as const;

function OrderCard({ card, canUpdate, canForce, busy, onAct }: { card: KitchenCard; canUpdate: boolean; canForce: boolean; busy: boolean; onAct: (path: string) => void }) {
  return <section className={`panel kitchen-card ${card.timing === "LATE" ? "late" : card.timing === "AT_RISK" ? "risk" : ""}`}>
    <div className="panel-heading">
      <div>
        <strong><OrderRef id={card.orderId} /> · {card.employee}</strong>
        <p className="hint">{card.company} · {card.address}{card.packaging ? ` · ${card.packaging}` : ""}</p>
      </div>
      <div className="row-actions">
        <span className={`badge ${TIMING_BADGE[card.timing]}`}>{TIMING_LABEL[card.timing]}</span>
        {canForce && card.timing !== "DONE" ? <button className="danger-button" disabled={busy} onClick={() => { if (window.confirm(`Force-complete order #${card.orderId}? Every open unit is marked done.`)) onAct(`/kitchen/orders/${card.orderId}/force-complete`); }} type="button">Force complete</button> : null}
      </div>
    </div>
    <p className="hint">
      Deliver {card.deliveryTime} · dispatch-ready by <strong>{formatTime(card.plannedDispatchReadyAt)}</strong> · kitchen-ready by <strong>{formatTime(card.plannedKitchenReadyAt)}</strong>
      {card.kitchenStartedAt ? <> · started {formatTime(card.kitchenStartedAt)}</> : " · not started"}{card.kitchenReadyAt ? <> · ready {formatTime(card.kitchenReadyAt)}</> : null}
    </p>
    <div className="table-wrap"><table className="data-table"><thead><tr><th>Station</th><th>Prep unit</th><th>Qty</th><th>Status</th><th /></tr></thead><tbody>
      {card.units.map((unit: KitchenUnit) => <tr key={unit.id}>
        <td>{unit.station}</td>
        <td><strong>{unit.dish}</strong>{unit.choices ? <span className="hint"> — {unit.choices}</span> : null}</td>
        <td>{unit.quantity}</td>
        <td><span className={`badge ${STATE_BADGE[unit.state]}`}>{STATE_LABEL[unit.state]}</span> <span className="hint">{unit.state === "DONE" ? `${formatTime(unit.doneAt)} · ${unit.doneBy ?? ""}` : unit.state === "STARTED" ? `since ${formatTime(unit.startedAt)}${unit.startedBy ? ` · ${unit.startedBy}` : ""}` : ""}</span></td>
        <td>{canUpdate && unit.state !== "DONE" ? <div className="row-actions">
          {unit.state === "PENDING" ? <button className="secondary-button" disabled={busy} onClick={() => onAct(`/kitchen/units/${unit.id}/start`)} type="button">Start</button> : null}
          <button className="primary-button" disabled={busy} onClick={() => onAct(`/kitchen/units/${unit.id}/finish`)} type="button">Done</button>
        </div> : null}</td>
      </tr>)}
    </tbody></table></div>
  </section>;
}

function KitchenContent() {
  const { staff } = useAuth();
  const [date, setDate] = useState("");
  const [station, setStation] = useState(""); const [state, setState] = useState(""); const [timing, setTiming] = useState(""); const [page, setPage] = useState(1);
  const [tick, setTick] = useState(0); const [busy, setBusy] = useState(false); const [actionError, setActionError] = useState("");
  const query = new URLSearchParams({ ...(date ? { date } : {}), page: String(page), pageSize: "25", ...(station ? { station } : {}), ...(state ? { state } : {}), ...(timing ? { timing } : {}) });
  const { data: board, error, loading, reload } = useResource<KitchenBoard>(`/kitchen/board?${query}`, tick);
  const shown = board?.date ?? (date || kitchenToday());
  useEffect(() => { const timer = window.setInterval(() => setTick((value) => value + 1), 30_000); return () => window.clearInterval(timer); }, []); // keeps the board and late warnings fresh
  const reset = (fn: () => void) => { fn(); setPage(1); };

  async function act(path: string) {
    setBusy(true); setActionError("");
    try { await apiJson(path, sendJson("POST")); } catch (caught) { setActionError(messageOf(caught, "Could not update the kitchen board.")); }
    finally { setBusy(false); reload(); }
  }

  const canUpdate = can(staff, Capability.KITCHEN_BOARD_UPDATE); const canForce = canUpdate && can(staff, Capability.ORDERS_OVERRIDE);
  const stationLabel = (id: number | null) => (id === null ? "unassigned" : String(id));
  return <AppShell><main className="content-page wide">
    <div className="page-heading"><div><h1>Kitchen board</h1><p className="muted">{formatDay(shown)}{board ? ` · updated ${formatInstant(board.now)}` : ""}</p></div>
      <div className="form-actions">
        <button className="secondary-button" onClick={() => reset(() => setDate(shiftDay(shown, -1)))} type="button">←</button>
        <input aria-label="Delivery date" onChange={(event) => event.target.value && reset(() => setDate(event.target.value))} type="date" value={shown} />
        <button className="secondary-button" onClick={() => reset(() => setDate(shiftDay(shown, 1)))} type="button">→</button>
        <button className="secondary-button" onClick={() => reset(() => setDate(""))} type="button">Today</button>
      </div></div>
    {board?.closedToday && board.date !== board.today ? <p className="notice">The kitchen is closed today ({formatDay(board.today)}). Showing the next working day.</p> : null}
    {board ? <div className="stat-row">
      <div className="stat"><span>Orders</span><strong>{board.totals.orders}</strong></div>
      <div className="stat"><span>Kitchen ready</span><strong>{board.totals.ready}</strong></div>
      <div className={`stat ${board.totals.atRisk ? "warn" : ""}`}><span>At risk (≤{board.atRiskMinutes} min)</span><strong>{board.totals.atRisk}</strong></div>
      <div className={`stat ${board.totals.late ? "alert" : ""}`}><span>Late</span><strong>{board.totals.late}</strong></div>
    </div> : null}
    <section className="panel">
      <div className="chip-group">
        <label className="chip"><input checked={station === ""} onChange={() => reset(() => setStation(""))} type="radio" name="station" />All stations</label>
        {board?.stations.map((entry) => <label className="chip" key={stationLabel(entry.id)}><input checked={station === stationLabel(entry.id)} onChange={() => reset(() => setStation(stationLabel(entry.id)))} type="radio" name="station" />{entry.name} <span className="hint">{entry.pending} to do · {entry.started} cooking</span></label>)}
      </div>
      <div className="toolbar">
        <label>Unit status<select onChange={(event) => reset(() => setState(event.target.value))} value={state}><option value="">Any</option><option value="PENDING">To do</option><option value="STARTED">Cooking</option><option value="DONE">Done</option></select></label>
        <label>Order timing<select onChange={(event) => reset(() => setTiming(event.target.value))} value={timing}><option value="">Any</option><option value="LATE">Late</option><option value="AT_RISK">At risk</option><option value="ON_TRACK">On track</option><option value="DONE">Kitchen ready</option></select></label>
      </div>
    </section>
    {board?.prep.length ? <details className="panel"><summary>Prep totals <span className="hint">· {board.prep.reduce((sum, entry) => sum + entry.remaining, 0)} portions still to do</span></summary>
      <div className="table-wrap" style={{ marginTop: 12 }}><table className="data-table"><thead><tr><th>Dish</th><th>Choices</th><th>Total</th><th>Still to do</th></tr></thead><tbody>
        {board.prep.map((entry) => <tr key={`${entry.stationId}-${entry.sku}-${entry.choices}`}><td>{entry.dish}</td><td className="muted">{entry.choices || "—"}</td><td>{entry.total}</td><td><strong>{entry.remaining}</strong></td></tr>)}
      </tbody></table></div></details> : null}
    {error ? <p className="form-error">{error}</p> : null}{actionError ? <p aria-live="polite" className="form-error">{actionError}</p> : null}
    {loading && !board ? <p className="muted">Loading the board...</p> : null}
    {board?.orders.items.map((card) => <OrderCard busy={busy} canForce={canForce} canUpdate={canUpdate} card={card} key={card.orderId} onAct={(path) => void act(path)} />)}
    {board && !board.orders.items.length ? <p className="muted">{board.totals.orders ? "Nothing matches these filters." : "No confirmed orders for this date."}</p> : null}
    {board ? <Pagination noun="orders" onPage={setPage} page={board.orders.page} pageSize={board.orders.pageSize} total={board.orders.total} /> : null}
  </main></AppShell>;
}

export default function KitchenPage() { return <ProtectedPage requires={[Capability.KITCHEN_BOARD_VIEW]}><KitchenContent /></ProtectedPage>; }
