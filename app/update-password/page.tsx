"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function UpdatePasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();

    if (password.length < 8) {
      setMessage({ kind: "error", text: "Use at least 8 characters." });
      return;
    }

    if (password !== confirmPassword) {
      setMessage({ kind: "error", text: "Passwords do not match." });
      return;
    }

    setBusy(true);
    setMessage(null);

    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setMessage({ kind: "error", text: "This invite link is invalid or expired. Ask your admin to send a new invite." });
      setBusy(false);
      return;
    }

    setMessage({ kind: "success", text: "Password updated. You can now sign in." });

    setTimeout(() => {
      window.location.href = "/";
    }, 1200);
  }

  return (
    <main className="auth-layout">
      <section className="intro-panel">
        <div className="brand">
          <span className="brand-mark">A</span>
          <span>Authentico</span>
        </div>
        <div className="intro-copy">
          <p className="eyebrow light">ACCOUNT SETUP</p>
          <h1>Create your private password</h1>
        </div>
        <p className="footnote">Your admin will not be able to see this password.</p>
      </section>

      <section className="form-panel">
        <div className="form-card">
          <p className="eyebrow">INVITE ACCEPTED</p>
          <h2>Set your password</h2>
          <p className="muted">Choose a password only you know.</p>

          <form onSubmit={submit}>
            <label className="field">
              <span>New password</span>
              <input
                type="password"
                minLength={8}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 8 characters"
              />
            </label>

            <label className="field">
              <span>Confirm password</span>
              <input
                type="password"
                minLength={8}
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Re-enter password"
              />
            </label>

            {message && <p className={`message ${message.kind}`}>{message.text}</p>}

            <button className="primary-button" disabled={busy}>
              {busy ? "Saving..." : "Save password"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
