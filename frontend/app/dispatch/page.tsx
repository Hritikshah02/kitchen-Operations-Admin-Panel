"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "../components/app-shell";
import { can, useAuth } from "../components/auth-provider";
import { Pagination } from "../components/form-controls";
import { ProtectedPage } from "../components/protected-page";
import { apiJson, messageOf, sendJson } from "../lib/api";
import { Capability } from "../lib/capabilities";
import { formatDay, formatInstant, formatTime, kitchenToday, shiftDay } from "../lib/format";
import type { DispatchBoard, Drop, DropStage, Option } from "../lib/types";
import { useResource } from "../lib/use-resource";

const STAGE_LABEL: Record<DropStage, string> = { NOT_STARTED: "Not started", COOKING: "Cooking", KITCHEN_READY: "Kitchen ready", DISPATCH_READY: "Dispatch ready", OUT_FOR_DELIVERY: "Out for delivery", DELIVERED: "Delivered" };
const STAGE_BADGE: Record<DropStage, string> = { NOT_STARTED: "grey", COOKING: "grey", KITCHEN_READY: "amber", DISPATCH_READY: "amber", OUT_FOR_DELIVERY: "amber", DELIVERED: "green" };
const TIMING_BADGE = { LATE: "red", AT_RISK: "amber", ON_TRACK: "grey", DONE: "green" } as const;
const TIMING_LABEL = { LATE: "Late", AT_RISK: "At risk", ON_TRACK: "On track", DONE: "Done" } as const;
const keyOf = (drop: Drop) => ({ deliveryDate: drop.deliveryDate, companyId: drop.companyId, addressId: drop.addressId, deliveryTime: drop.deliveryTime });

function DropCard({ drop, drivers, canUpdate, busy, onAct }: { drop: Drop; drivers: Option[]; canUpdate: boolean; busy: boolean; onAct: (path: string, body: object) => void }) {
  const [driverId, setDriverId] = useState(String(drop.driver?.id ?? ""));
  const counts = (Object.keys(drop.counts) as DropStage[]).filter((stage) => drop.counts[stage]).map((stage) => `${drop.counts[stage]} ${STAGE_LABEL[stage].toLowerCase()}`).join(" · ");
  return <section className={`panel kitchen-card ${drop.timing === "LATE" ? "late" : drop.timing === "AT_RISK" ? "risk" : ""}`}>
    <div className="panel-heading">
      <div><strong>{drop.deliveryTime} · {drop.company}</strong><p className="hint">{drop.address}{drop.packaging ? ` · ${drop.packaging}` : ""}</p></div>
      <div className="row-actions"><span className={`badge ${STAGE_BADGE[drop.status]}`}>{STAGE_LABEL[drop.status]}</span><span className={`badge ${TIMING_BADGE[drop.timing]}`}>{TIMING_LABEL[drop.timing]}</span></div>
    </div>
    <p className="hint">{counts} · leaves by <strong>{formatTime(drop.plannedDispatchReadyAt)}</strong></p>
    {drop.instructions ? <p className="hint">Driver notes: {drop.instructions}</p> : null}
    <div className="table-wrap"><table className="data-table"><tbody>
      {drop.orders.map((order) => <tr key={order.id}>
        <td><Link className="link" href={`/orders/${order.id}`}>#{order.id}</Link> {order.employee}</td>
        <td className="muted">{order.boxes} box{order.boxes === 1 ? "" : "es"}: {order.items.join(", ")}</td>
        <td><span className={`badge ${STAGE_BADGE[order.stage]}`}>{STAGE_LABEL[order.stage]}</span></td>
      </tr>)}
    </tbody></table></div>
    {drop.delivery ? <p className="hint">Delivered {formatInstant(drop.delivery.deliveredAt)} by {drop.delivery.by ?? "driver"} · {drop.delivery.onTime ? <span className="badge green">On time{drop.delivery.lateMinutes ? ` (+${drop.delivery.lateMinutes} min, within grace)` : ""}</span> : <span className="badge red">Late by {drop.delivery.lateMinutes} min</span>}{drop.delivery.note ? ` · “${drop.delivery.note}”` : ""}{drop.delivery.photoUrl ? <> · <a className="link" href={drop.delivery.photoUrl} rel="noreferrer" target="_blank">photo</a></> : null}</p> : null}
    <div className="form-actions">
      <span className="hint">Driver: <strong>{drop.driver ? `${drop.driver.name}${drop.driver.isDefault ? " (company default)" : ""}` : "none assigned"}</strong></span>
      {canUpdate && drop.canAssign ? <>
        <select aria-label="Driver" onChange={(event) => setDriverId(event.target.value)} value={driverId}><option value="">Choose a driver...</option>{drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}</select>
        <button className="secondary-button" disabled={busy || !driverId || Number(driverId) === drop.driver?.id} onClick={() => onAct("/dispatch/drops/assign-driver", { ...keyOf(drop), driverId: Number(driverId) })} type="button">Assign</button>
      </> : null}
      {canUpdate && drop.status !== "DELIVERED" ? <>
        <button className="secondary-button" disabled={busy || !drop.canDispatchReady} onClick={() => onAct("/dispatch/drops/dispatch-ready", keyOf(drop))} type="button">Mark dispatch ready</button>
        <button className="primary-button" disabled={busy || !drop.canOutForDelivery} onClick={() => onAct("/dispatch/drops/out-for-delivery", keyOf(drop))} type="button">Out for delivery</button>
      </> : null}
    </div>
    {drop.blockedReason ? <p className="hint">{drop.blockedReason}</p> : null}
  </section>;
}

function DispatchContent() {
  const { staff } = useAuth();
  const [date, setDate] = useState(kitchenToday()); const [stage, setStage] = useState(""); const [driver, setDriver] = useState(""); const [page, setPage] = useState(1);
  const [tick, setTick] = useState(0); const [busy, setBusy] = useState(false); const [actionError, setActionError] = useState("");
  const query = new URLSearchParams({ date, page: String(page), pageSize: "25", ...(stage ? { stage } : {}), ...(driver ? { driverId: driver } : {}) });
  const { data: board, error, loading, reload } = useResource<DispatchBoard>(`/dispatch/board?${query}`, tick);
  const { data: drivers } = useResource<Option[]>("/dispatch/drivers");
  useEffect(() => { const timer = window.setInterval(() => setTick((value) => value + 1), 30_000); return () => window.clearInterval(timer); }, []);
  const reset = (fn: () => void) => { fn(); setPage(1); };
  async function act(path: string, body: object) {
    setBusy(true); setActionError("");
    try { await apiJson(path, sendJson("POST", body)); } catch (caught) { setActionError(messageOf(caught, "Could not update the drop.")); }
    finally { setBusy(false); reload(); }
  }
  return <AppShell><main className="content-page wide">
    <div className="page-heading"><div><h1>Dispatch board</h1><p className="muted">{formatDay(date)}{board ? ` · updated ${formatInstant(board.now)}` : ""}</p></div>
      <div className="form-actions">
        <button className="secondary-button" onClick={() => reset(() => setDate(shiftDay(date, -1)))} type="button">←</button>
        <input aria-label="Delivery date" onChange={(event) => event.target.value && reset(() => setDate(event.target.value))} type="date" value={date} />
        <button className="secondary-button" onClick={() => reset(() => setDate(shiftDay(date, 1)))} type="button">→</button>
        <button className="secondary-button" onClick={() => reset(() => setDate(kitchenToday()))} type="button">Today</button>
      </div></div>
    {board ? <div className="stat-row">
      <div className="stat"><span>Drops</span><strong>{board.totals.drops}</strong></div>
      <div className="stat"><span>Out for delivery</span><strong>{board.totals.outForDelivery}</strong></div>
      <div className="stat"><span>Delivered</span><strong>{board.totals.delivered}</strong></div>
      <div className={`stat ${board.totals.noDriver ? "warn" : ""}`}><span>No driver yet</span><strong>{board.totals.noDriver}</strong></div>
      <div className={`stat ${board.totals.late ? "alert" : ""}`}><span>Late</span><strong>{board.totals.late}</strong></div>
    </div> : null}
    <section className="panel"><div className="toolbar">
      <label>Stage<select onChange={(event) => reset(() => setStage(event.target.value))} value={stage}><option value="">Any</option>{(Object.keys(STAGE_LABEL) as DropStage[]).map((entry) => <option key={entry} value={entry}>{STAGE_LABEL[entry]}</option>)}</select></label>
      <label>Driver<select onChange={(event) => reset(() => setDriver(event.target.value))} value={driver}><option value="">Any</option><option value="none">Unassigned</option>{drivers?.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
    </div></section>
    {error ? <p className="form-error">{error}</p> : null}{actionError ? <p aria-live="polite" className="form-error">{actionError}</p> : null}
    {loading && !board ? <p className="muted">Loading the board...</p> : null}
    {board?.drops.items.map((drop) => <DropCard busy={busy} canUpdate={can(staff, Capability.DISPATCH_BOARD_UPDATE)} drivers={drivers ?? []} drop={drop} key={drop.id} onAct={(path, body) => void act(path, body)} />)}
    {board && !board.drops.items.length ? <p className="muted">No drops match.</p> : null}
    {board ? <Pagination noun="drops" onPage={setPage} page={board.drops.page} pageSize={board.drops.pageSize} total={board.drops.total} /> : null}
  </main></AppShell>;
}

export default function DispatchPage() { return <ProtectedPage requires={[Capability.DISPATCH_BOARD_VIEW]}><DispatchContent /></ProtectedPage>; }
