"use client";

import { useEffect, useState } from "react";
import { Icon } from "../components/icons";
import { AppShell } from "../components/app-shell";
import { ProtectedPage } from "../components/protected-page";
import { apiJson, messageOf, sendJson } from "../lib/api";
import { Capability } from "../lib/capabilities";
import { formatDay, formatInstant, formatTime } from "../lib/format";
import type { Drop, DriverDrops } from "../lib/types";
import { uploadImage } from "../lib/upload";
import { useResource } from "../lib/use-resource";

const STATUS: Record<Drop["status"], string> = { NOT_STARTED: "Kitchen hasn't started", COOKING: "Being cooked", KITCHEN_READY: "Cooked, being packed", DISPATCH_READY: "Packed: wait for dispatch", OUT_FOR_DELIVERY: "Out for delivery", DELIVERED: "Delivered" };

function DeliverForm({ drop, onDone }: { drop: Drop; onDone: () => void }) {
  const { data: photos } = useResource<{ uploadsEnabled: boolean }>("/driver/photo-status");
  const [note, setNote] = useState(""); const [photoUrl, setPhotoUrl] = useState(""); const [uploading, setUploading] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function onFile(file: File | undefined) {
    if (!file) return;
    setUploading(true); setError("");
    try { setPhotoUrl(await uploadImage(file, "/driver/photo-signature")); } catch (caught) { setError(caught instanceof Error ? caught.message : "Upload failed."); } finally { setUploading(false); }
  }
  async function submit() {
    setBusy(true); setError("");
    try {
      await apiJson("/driver/drops/deliver", sendJson("POST", { deliveryDate: drop.deliveryDate, companyId: drop.companyId, addressId: drop.addressId, deliveryTime: drop.deliveryTime, note: note.trim() || null, photoUrl: photoUrl || null }));
      onDone();
    } catch (caught) { setError(messageOf(caught, "Could not mark this delivered.")); } finally { setBusy(false); }
  }
  return <div className="form-stack">
    <label>Note (optional)<textarea maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="e.g. left with reception" value={note} /></label>
    {photos?.uploadsEnabled ? <div className="form-stack">
      <span>Photo (optional)</span>
      {/* eslint-disable-next-line @next/next/no-img-element -- the driver's own just-uploaded photo */}
      {photoUrl ? <img alt="Delivery photo" className="photo-preview" src={photoUrl} /> : null}
      <div className="photo-row">
        <input accept="image/*" capture="environment" disabled={uploading} id={`camera-${drop.id}`} onChange={(event) => { void onFile(event.target.files?.[0]); event.target.value = ""; }} type="file" />
        <input accept="image/*" disabled={uploading} id={`gallery-${drop.id}`} onChange={(event) => { void onFile(event.target.files?.[0]); event.target.value = ""; }} type="file" />
        <label className="secondary-button" htmlFor={`camera-${drop.id}`}><Icon name="camera" size={16} />{photoUrl ? "Retake photo" : "Take a photo"}</label>
        <label className="secondary-button" htmlFor={`gallery-${drop.id}`}><Icon name="upload" size={16} />Upload a photo</label>
        {photoUrl ? <button className="link-button" onClick={() => setPhotoUrl("")} type="button">Remove</button> : null}
        {uploading ? <span className="hint">Uploading...</span> : null}
      </div>
    </div> : null}
    {error ? <p aria-live="polite" className="form-error">{error}</p> : null}
    <button className="primary-button big-button" disabled={busy || uploading} onClick={() => void submit()} type="button">{busy ? "Saving..." : <><Icon name="check" size={20} />Mark delivered</>}</button>
  </div>;
}

function DriverDrop({ drop, onDone }: { drop: Drop; onDone: () => void }) {
  return <section className="panel driver-drop">
      <div className="panel-heading"><strong className="drop-time">{drop.deliveryTime}</strong><span className={`badge ${drop.status === "DELIVERED" ? "green" : drop.status === "OUT_FOR_DELIVERY" ? "amber" : "grey"}`}>{STATUS[drop.status]}</span></div>
      <p><strong>{drop.company}</strong></p>
      <p>{drop.address}</p>
      {drop.instructions ? <p className="notice">{drop.instructions}</p> : null}
      <p className="hint">{drop.orders.length} order{drop.orders.length === 1 ? "" : "s"}, {drop.orders.reduce((sum, order) => sum + order.boxes, 0)} boxes{drop.packaging ? ` · ${drop.packaging}` : ""}</p>
      <ul className="plain-list">{drop.orders.map((order) => <li key={order.id}><strong>{order.employee}</strong> <span className="hint">#{order.id}: {order.items.join(", ")}</span></li>)}</ul>
      {drop.delivery ? <p className="hint">Delivered {formatTime(drop.delivery.deliveredAt)}: {drop.delivery.onTime ? "on time" : `${drop.delivery.lateMinutes} min late`}{drop.delivery.note ? ` · “${drop.delivery.note}”` : ""} <span>({formatInstant(drop.delivery.deliveredAt)})</span>{drop.delivery.photoUrl ? <> · <a className="link" href={drop.delivery.photoUrl} rel="noreferrer" target="_blank">photo</a></> : null}</p> : null}
      {drop.canDeliver ? <DeliverForm drop={drop} onDone={onDone} /> : null}
  </section>;
}

function DriverContent() {
  const [tick, setTick] = useState(0);
  const { data, error, loading, reload } = useResource<DriverDrops>("/driver/drops", tick);
  useEffect(() => { const timer = window.setInterval(() => setTick((value) => value + 1), 30_000); return () => window.clearInterval(timer); }, []);
  return <AppShell><main className="content-page driver-page">
    <div className="page-heading"><div><h1>My drops today</h1>{data ? <p className="muted">{formatDay(data.date)} · {data.drops.length} drop{data.drops.length === 1 ? "" : "s"}</p> : null}</div></div>
    {error ? <p className="form-error">{error}</p> : null}{loading && !data ? <p className="muted">Loading your drops...</p> : null}
    {data?.closedToday ? <p className="notice">The kitchen is closed today. Your next deliveries are below.</p> : null}
    {data?.drops.map((drop) => <DriverDrop drop={drop} key={drop.id} onDone={reload} />)}
    {data && !data.drops.length ? <p className="muted">{data.closedToday ? "No deliveries today." : "No drops assigned to you today."}</p> : null}
    {data?.nextDay ? <section className="form-stack"><h2>Next delivery day: {formatDay(data.nextDay.date)}</h2>
      {data.nextDay.drops.length ? data.nextDay.drops.map((drop) => <DriverDrop drop={drop} key={drop.id} onDone={reload} />) : <p className="muted">No drops assigned to you yet.</p>}
    </section> : null}
  </main></AppShell>;
}

export default function DriverPage() { return <ProtectedPage requires={[Capability.DRIVER_DROPS_VIEW]}><DriverContent /></ProtectedPage>; }
