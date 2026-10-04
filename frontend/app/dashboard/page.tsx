"use client";

import Link from "next/link";
import { AppShell } from "../components/app-shell";
import { ProtectedPage } from "../components/protected-page";
import { Capability } from "../lib/capabilities";
import { formatDay, formatInstant, formatTime } from "../lib/format";
import { formatCents } from "../lib/money";
import type { Dashboard, KitchenTiming } from "../lib/types";
import { useResource } from "../lib/use-resource";

const percent = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 100)}%`);
const TIMING: Record<KitchenTiming, { label: string; tone: string }> = { LATE: { label: "Late", tone: "red" }, AT_RISK: { label: "At risk", tone: "amber" }, ON_TRACK: { label: "On track", tone: "grey" }, DONE: { label: "Done", tone: "green" } };
const Stat = ({ label, value, tone, hint }: { label: string; value: string | number; tone?: "warn" | "alert"; hint?: string }) => <div className={`stat ${tone ?? ""}`}><span>{label}</span><strong>{value}</strong>{hint ? <span className="hint">{hint}</span> : null}</div>;

function Admin({ data }: { data: NonNullable<Dashboard["admin"]> }) {
  const { attention, operating, upcoming, recent, performance, money } = data;
  return <>
    <div className="stat-row">
      <Stat label="Late in the kitchen" tone={attention.lateKitchenOrders ? "alert" : undefined} value={attention.lateKitchenOrders} hint="confirmed orders past their kitchen-ready time" />
      <Stat label="At risk in the kitchen" tone={attention.atRiskKitchenOrders ? "warn" : undefined} value={attention.atRiskKitchenOrders} hint="within 30 min of it" />
      <Stat label="Drops without a driver" tone={attention.dropsWithoutDriver ? "warn" : undefined} value={attention.dropsWithoutDriver} />
      <Stat label="Late drops" tone={attention.lateDrops ? "alert" : undefined} value={attention.lateDrops} hint="not dispatched by their time, or delivered late" />
    </div>
    <section className="panel"><h2>The working day</h2>
      <div className="stat-row">
        <Stat label="Confirmed orders" value={operating.kitchenOrders} /><Stat label="Kitchen ready" value={`${operating.kitchenReady} of ${operating.kitchenOrders}`} />
        <Stat label="Drops" value={operating.drops} /><Stat label="Drops delivered" value={`${operating.delivered} of ${operating.drops}`} />
      </div>
      <div className="form-actions"><Link className="secondary-button" href="/kitchen">Kitchen board</Link><Link className="secondary-button" href="/dispatch">Dispatch board</Link></div>
    </section>
    <section className="panel"><h2>Coming up</h2>
      <p className="hint">Orders by status for the next delivery days. Drafts are cancelled and placed orders confirmed at each date&apos;s cut-off.</p>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Delivery</th><th>Cut-off</th><th>Draft</th><th>Placed</th><th>Confirmed</th><th>Delivered</th><th>Cancelled / rejected</th></tr></thead><tbody>
        {upcoming.map((day) => <tr key={day.date}><td>{formatDay(day.date)}</td><td>{formatInstant(day.cutoffAt)} {day.cutoffPassed ? <span className="badge grey">passed</span> : <span className="badge amber">open</span>}</td><td>{day.draft}</td><td>{day.placed}</td><td>{day.confirmed}</td><td>{day.delivered}</td><td>{day.cancelled} / {day.rejected}</td></tr>)}
      </tbody></table></div>
    </section>
    <section className="panel"><h2>Last {recent.length} working days</h2>
      <p className="hint">By delivery date. Billable = confirmed + delivered orders at their full total; cancelled and rejected orders are counted but never billed.</p>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Delivery</th><th>Delivered</th><th>Confirmed, not delivered</th><th>Cancelled</th><th>Rejected</th><th>Billable</th><th>On time / late</th></tr></thead><tbody>
        {recent.map((day) => <tr key={day.date}><td>{formatDay(day.date)}</td><td>{day.delivered}</td><td>{day.confirmedNotDelivered}</td><td>{day.cancelled}</td><td>{day.rejected}</td><td>{formatCents(day.billableCents)}</td><td>{day.onTime} / {day.late}</td></tr>)}
        <tr><td><strong>Total</strong></td><td>{recent.reduce((sum, day) => sum + day.delivered, 0)}</td><td>{recent.reduce((sum, day) => sum + day.confirmedNotDelivered, 0)}</td><td>{recent.reduce((sum, day) => sum + day.cancelled, 0)}</td><td>{recent.reduce((sum, day) => sum + day.rejected, 0)}</td><td><strong>{formatCents(recent.reduce((sum, day) => sum + day.billableCents, 0))}</strong></td><td>{performance.onTime} / {performance.late}</td></tr>
      </tbody></table></div>
      <div className="stat-row">
        <Stat label="Delivered on time" value={percent(performance.onTimeRate)} hint={`${performance.onTime} of ${performance.onTime + performance.late} timed deliveries, within the grace`} />
        <Stat label="Average lateness when late" value={performance.averageLateMinutes === null ? "—" : `${performance.averageLateMinutes} min`} />
      </div>
    </section>
    {money ? <section className="panel"><h2>Money</h2>
      <div className="stat-row">
        <Stat label="Not yet invoiced" value={formatCents(money.uninvoicedCents)} hint={`${money.uninvoicedOrders} confirmed orders, net of credits`} />
        <Stat label="Invoiced, unpaid" value={formatCents(money.unpaidCents)} hint={`${money.unpaidInvoices} invoice${money.unpaidInvoices === 1 ? "" : "s"}`} />
        <Stat label="Credits owed back" value={formatCents(money.openCreditCents)} hint={`${money.openCredits} carried to next invoices`} />
      </div>
      <div className="form-actions"><Link className="secondary-button" href="/billing">Billing</Link></div>
    </section> : null}
  </>;
}

function Kitchen({ data, date }: { data: NonNullable<Dashboard["kitchen"]>; date: string }) {
  const total = data.units.pending + data.units.started + data.units.done;
  return <>
    <div className="stat-row">
      <Stat label="Confirmed orders" value={data.totals.orders} />
      <Stat label="Prep units still to do" value={data.units.pending + data.units.started} hint={`${data.units.pending} not started · ${data.units.started} cooking · ${data.units.done} of ${total} done`} />
      <Stat label="First kitchen-ready deadline" value={data.firstDeadline ? formatTime(data.firstDeadline) : "—"} hint="earliest unfinished order" />
      <Stat label="Late / at risk" tone={data.totals.late ? "alert" : data.totals.atRisk ? "warn" : undefined} value={`${data.totals.late} / ${data.totals.atRisk}`} />
      <Stat label="Orders with allergy sign-off" value={data.allergyOrders} hint="check these before packing" />
    </div>
    <section className="panel"><div className="panel-heading"><h2>What to cook ({formatDay(date)})</h2><Link className="secondary-button" href="/kitchen">Open kitchen board</Link></div>
      <p className="hint">Portions still to do across all stations, biggest first.</p>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Dish</th><th>Choices</th><th>Still to do</th><th>Of total</th></tr></thead><tbody>
        {data.prep.map((entry) => <tr key={`${entry.dish}-${entry.choices}`}><td>{entry.dish}</td><td className="muted">{entry.choices || "—"}</td><td><strong>{entry.remaining}</strong></td><td>{entry.total}</td></tr>)}
        {!data.prep.length ? <tr><td className="muted" colSpan={4}>Nothing left to cook.</td></tr> : null}
      </tbody></table></div>
    </section>
    <section className="panel"><h2>By station</h2>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Station</th><th>To do</th><th>Cooking</th><th>Done</th></tr></thead><tbody>
        {data.stations.map((station) => <tr key={station.id ?? "none"}><td>{station.name}</td><td>{station.pending}</td><td>{station.started}</td><td>{station.done}</td></tr>)}
      </tbody></table></div>
    </section>
    <section className="panel"><h2>Most urgent orders</h2>
      <div className="table-wrap"><table className="data-table"><tbody>
        {data.mostUrgent.map((order) => <tr key={order.orderId}><td><Link className="link" href={`/orders/${order.orderId}`}>#{order.orderId}</Link> {order.employee} · {order.company}</td><td>ready by {formatTime(order.plannedKitchenReadyAt)}</td><td>{order.unitsLeft} unit{order.unitsLeft === 1 ? "" : "s"} left</td><td><span className={`badge ${TIMING[order.timing].tone}`}>{TIMING[order.timing].label}</span></td></tr>)}
        {!data.mostUrgent.length ? <tr><td className="muted">No unfinished orders.</td></tr> : null}
      </tbody></table></div>
    </section>
    {data.tomorrow ? <section className="panel"><h2>Next working day ({formatDay(data.tomorrow.date)})</h2><p>{data.tomorrow.placed} placed · {data.tomorrow.draft} draft · {data.tomorrow.confirmed} already confirmed</p><p className="hint">Placed orders are confirmed at the cut-off; this is a forecast, not final.</p></section> : null}
  </>;
}

function Dispatch({ data }: { data: NonNullable<Dashboard["dispatch"]> }) {
  return <>
    <div className="stat-row">
      <Stat label="Drops today" value={data.totals.drops} hint={`${data.totals.orders} orders`} />
      <Stat label="Out for delivery" value={data.totals.outForDelivery} /><Stat label="Delivered" value={data.totals.delivered} />
      <Stat label="No driver yet" tone={data.totals.noDriver ? "warn" : undefined} value={data.totals.noDriver} />
      <Stat label="Late" tone={data.totals.late ? "alert" : undefined} value={data.totals.late} />
    </div>
    <section className="panel"><div className="panel-heading"><h2>Next to leave</h2><Link className="secondary-button" href="/dispatch">Open dispatch board</Link></div>
      <div className="table-wrap"><table className="data-table"><tbody>
        {data.next.map((drop) => <tr key={drop.id}><td><strong>leave by {formatTime(drop.plannedDispatchReadyAt)}</strong> · {drop.company} · for {drop.deliveryTime}</td><td>{drop.driver ?? <span className="badge amber">no driver</span>}</td><td className="muted">{drop.blockedReason ?? drop.status.replace(/_/g, " ").toLowerCase()}</td><td><span className={`badge ${TIMING[drop.timing].tone}`}>{TIMING[drop.timing].label}</span></td></tr>)}
        {!data.next.length ? <tr><td className="muted">Nothing waiting to leave.</td></tr> : null}
      </tbody></table></div>
    </section>
    <section className="panel"><h2>Where every drop is</h2>
      <p>{data.stages.cooking} cooking · {data.stages.kitchenReady} kitchen ready · {data.stages.dispatchReady} dispatch ready · {data.stages.outForDelivery} out · {data.stages.delivered} delivered</p>
      {data.outNow.length ? <><h3>Out now</h3><ul className="plain-list">{data.outNow.map((drop) => <li key={drop.id}>{drop.company} · due {drop.deliveryTime} · {drop.driver ?? "no driver"}</li>)}</ul></> : null}
    </section>
    <section className="panel"><h2>Driver load</h2>
      <div className="table-wrap"><table className="data-table"><tbody>{data.drivers.map((driver) => <tr key={driver.name}><td>{driver.name}</td><td>{driver.drops} drop{driver.drops === 1 ? "" : "s"}</td><td>{driver.delivered} delivered</td></tr>)}</tbody></table></div>
    </section>
  </>;
}

function Driver({ data }: { data: NonNullable<Dashboard["driver"]> }) {
  return <>
    <div className="stat-row">
      <Stat label="My drops today" value={data.totals.drops} /><Stat label="Delivered" value={`${data.totals.delivered} of ${data.totals.drops}`} />
      <Stat label="Out for delivery" value={data.totals.outForDelivery} /><Stat label="Waiting to go" value={data.totals.waiting} />
    </div>
    <section className="panel"><h2>Next drop</h2>
      {data.next ? <>
        <p className="drop-time">{data.next.deliveryTime}</p><p><strong>{data.next.company}</strong></p><p>{data.next.address}</p>
        {data.next.instructions ? <p className="notice">{data.next.instructions}</p> : null}
        <p className="hint">{data.next.boxes} boxes · {data.next.status.replace(/_/g, " ").toLowerCase()}</p>
        <Link className="primary-button" href="/driver">{data.next.canDeliver ? "Open and mark delivered" : "Open my drops"}</Link>
      </> : <p className="muted">{data.totals.drops ? "All of today's drops are delivered." : "No drops assigned to you today."}</p>}
    </section>
    <section className="panel"><h2>My on-time record</h2>
      <p><strong>{percent(data.record.onTimeRate)}</strong> <span className="hint">{data.record.onTime} on time, {data.record.late} late over the last {data.record.windowDays} working days (within the grace period)</span></p>
    </section>
  </>;
}

const TITLES = { ADMIN: "Operations overview", KITCHEN: "Kitchen today", DISPATCH: "Dispatch today", DRIVER: "My day", NONE: "Welcome" } as const;

function DashboardContent() {
  const { data, error } = useResource<Dashboard>("/dashboard", "");
  if (error) return <AppShell><main className="content-page"><p className="form-error">{error}</p></main></AppShell>;
  if (!data) return <AppShell><main className="content-page"><p className="muted">Loading your dashboard...</p></main></AppShell>;
  return <AppShell><main className="content-page wide">
    <p className="eyebrow">{data.staff.name}</p>
    <h1>{TITLES[data.kind]}</h1>
    <p className="hint">{data.kind === "DRIVER" ? formatDay(data.today) : `${data.isToday ? "Today" : "Next working day"}: ${formatDay(data.operatingDate)}`} · times in {data.timezone}{data.isToday || data.kind === "DRIVER" ? "" : " (the kitchen is closed today)"}</p>
    {data.admin ? <Admin data={data.admin} /> : null}
    {data.kitchen ? <Kitchen data={data.kitchen} date={data.operatingDate} /> : null}
    {data.dispatch ? <Dispatch data={data.dispatch} /> : null}
    {data.driver ? <Driver data={data.driver} /> : null}
    {data.kind === "NONE" ? <p className="muted">Your workspace is ready.</p> : null}
  </main></AppShell>;
}

export default function DashboardPage() { return <ProtectedPage requires={[Capability.DASHBOARD_VIEW]}><DashboardContent /></ProtectedPage>; }
