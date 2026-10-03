"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "../lib/api";
import { useAuth } from "../components/auth-provider";

export default function LoginPage() {
  const router = useRouter(); const { login, status } = useAuth();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [error, setError] = useState(""); const [submitting, setSubmitting] = useState(false);
  useEffect(() => { if (status === "authenticated") router.replace("/dashboard"); }, [router, status]);
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSubmitting(true);
    try { await login(email, password); router.replace("/dashboard"); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : "Unable to sign in. Try again."); }
    finally { setSubmitting(false); }
  }
  return <main className="login-page"><form className="login-form" onSubmit={handleSubmit}>
    <p className="eyebrow">Fernleaf Kitchen</p><h1>Staff sign in</h1><p className="muted">Use your kitchen operations account.</p>
    <label>Email address<input autoComplete="email" disabled={submitting} onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></label>
    <label>Password<input autoComplete="current-password" disabled={submitting} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></label>
    {error ? <p aria-live="polite" className="form-error">{error}</p> : null}
    <button className="primary-button" disabled={submitting} type="submit">{submitting ? "Signing in..." : "Sign in"}</button>
  </form></main>;
}
