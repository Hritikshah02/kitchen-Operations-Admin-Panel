"use client";

import { type FormEvent, useState } from "react";
import { AppShell } from "../components/app-shell";
import { useAuth } from "../components/auth-provider";
import { ProtectedPage } from "../components/protected-page";
import { apiJson, messageOf, sendJson } from "../lib/api";
import { Capability } from "../lib/capabilities";
import { useResource } from "../lib/use-resource";

type Role = { id: number; name: string; label: string; capabilities: string[]; activeStaff: number };
type StaffMember = { id: number; name: string; email: string; isActive: boolean; role: { id: number; name: string; label: string } };
type Page<T> = { items: T[]; total: number; page: number; pageSize: number };

const PAGE_SIZE = 20;
const emptyDraft = { name: "", email: "", password: "", roleId: 0 };

function StaffContent() {
  const { staff: me } = useAuth();
  const { data: roles } = useResource<Role[]>("/roles");
  const [search, setSearch] = useState(""); const [roleFilter, setRoleFilter] = useState(""); const [includeInactive, setIncludeInactive] = useState(false); const [page, setPage] = useState(1);
  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), includeInactive: String(includeInactive), ...(search.trim() ? { search: search.trim() } : {}), ...(roleFilter ? { roleId: roleFilter } : {}) });
  const { data, error: loadError, loading, reload } = useResource<Page<StaffMember>>(`/staff?${query}`);
  const [draft, setDraft] = useState(emptyDraft); const [resetFor, setResetFor] = useState<number | null>(null); const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");

  async function run(action: () => Promise<unknown>, fallback: string, success?: string) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); reload(); if (success) setNotice(success); return true; }
    catch (caught) { setError(messageOf(caught, fallback)); return false; }
    finally { setBusy(false); }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await run(() => apiJson("/staff", sendJson("POST", draft)), "Could not create staff account.", `Account created for ${draft.email}.`)) setDraft(emptyDraft);
  }
  async function resetPassword(member: StaffMember) {
    if (await run(() => apiJson(`/staff/${member.id}/reset-password`, sendJson("POST", { password: newPassword })), "Could not reset password.", `Password reset for ${member.email}.`)) { setResetFor(null); setNewPassword(""); }
  }
  const update = (member: StaffMember, body: object, success: string) => run(() => apiJson(`/staff/${member.id}`, sendJson("PATCH", body)), "Could not update staff member.", success);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return <AppShell><main className="content-page wide">
    <div className="page-heading"><div><p className="eyebrow">Administration</p><h1>Staff &amp; roles</h1></div></div>

    <form className="panel" onSubmit={create}>
      <div className="panel-heading"><h2>Add staff account</h2><span className="hint">Each staff member has exactly one role</span></div>
      <div className="form-grid">
        <label>Full name<input disabled={busy} maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required value={draft.name} /></label>
        <label>Email<input autoComplete="off" disabled={busy} onChange={(event) => setDraft({ ...draft, email: event.target.value })} required type="email" value={draft.email} /></label>
        <label>Initial password<input autoComplete="new-password" disabled={busy} minLength={8} onChange={(event) => setDraft({ ...draft, password: event.target.value })} required type="password" value={draft.password} /><span className="hint">8+ characters, a letter and a number</span></label>
        <label>Role<select disabled={busy} onChange={(event) => setDraft({ ...draft, roleId: Number(event.target.value) })} required value={draft.roleId || ""}><option value="">Choose a role</option>{roles?.map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}</select></label>
      </div>
      <div className="form-actions"><button className="primary-button" disabled={busy} type="submit">Create account</button></div>
    </form>

    {error || loadError ? <p aria-live="polite" className="form-error">{error || loadError}</p> : null}
    {notice ? <p aria-live="polite" className="success-text">{notice}</p> : null}

    <section className="panel">
      <div className="toolbar">
        <label>Search<input onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Name or email" value={search} /></label>
        <label>Role<select onChange={(event) => { setRoleFilter(event.target.value); setPage(1); }} value={roleFilter}><option value="">All roles</option>{roles?.map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}</select></label>
        <label className="check"><input checked={includeInactive} onChange={(event) => { setIncludeInactive(event.target.checked); setPage(1); }} type="checkbox" />Show deactivated</label>
      </div>
      {loading && !data ? <p className="muted">Loading staff...</p> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th /></tr></thead><tbody>
        {data?.items.map((member) => <tr className={member.isActive ? "" : "inactive"} key={member.id}>
          <td><strong>{member.name}</strong>{member.id === me?.id ? <span className="hint"> (you)</span> : null}</td>
          <td>{member.email}</td>
          <td><select aria-label={`Role for ${member.name}`} disabled={busy} onChange={(event) => void update(member, { roleId: Number(event.target.value) }, `${member.name} is now ${roles?.find((role) => role.id === Number(event.target.value))?.label}.`)} value={member.role.id}>{roles?.map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}</select></td>
          <td>{member.isActive ? <span className="badge green">Active</span> : <span className="badge grey">Deactivated</span>}</td>
          <td>{resetFor === member.id ? <div className="row-actions">
            <input aria-label="New password" autoComplete="new-password" minLength={8} onChange={(event) => setNewPassword(event.target.value)} placeholder="New password" type="password" value={newPassword} />
            <button className="primary-button" disabled={busy || newPassword.length < 8} onClick={() => void resetPassword(member)} type="button">Set</button>
            <button className="secondary-button" onClick={() => { setResetFor(null); setNewPassword(""); }} type="button">Cancel</button>
          </div> : <div className="row-actions">
            <button className="secondary-button" disabled={busy} onClick={() => { setResetFor(member.id); setNewPassword(""); }} type="button">Reset password</button>
            {member.isActive ? <button className="danger-button" disabled={busy || member.id === me?.id} onClick={() => void update(member, { isActive: false }, `${member.name} can no longer sign in.`)} type="button">Deactivate</button>
              : <button className="secondary-button" disabled={busy} onClick={() => void update(member, { isActive: true }, `${member.name} can sign in again.`)} type="button">Reactivate</button>}
          </div>}</td>
        </tr>)}
        {data && !data.items.length ? <tr><td className="muted" colSpan={5}>No staff match these filters.</td></tr> : null}
      </tbody></table></div>}
      {data ? <div className="pagination"><span>{data.total} staff · page {data.page} of {totalPages}</span><div className="form-actions">
        <button className="secondary-button" disabled={page <= 1} onClick={() => setPage(page - 1)} type="button">Previous</button>
        <button className="secondary-button" disabled={page >= totalPages} onClick={() => setPage(page + 1)} type="button">Next</button>
      </div></div> : null}
    </section>

    <section className="panel">
      <div className="panel-heading"><h2>Roles</h2><span className="hint">A role is a named set of capabilities; the server checks capabilities, never role names.</span></div>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Role</th><th>Active staff</th><th>Capabilities</th></tr></thead><tbody>
        {roles?.map((role) => <tr key={role.id}><td><strong>{role.label}</strong></td><td>{role.activeStaff}</td><td className="muted">{role.capabilities.join(", ")}</td></tr>)}
      </tbody></table></div>
    </section>
  </main></AppShell>;
}

export default function StaffPage() { return <ProtectedPage requires={[Capability.STAFF_MANAGE]}><StaffContent /></ProtectedPage>; }
