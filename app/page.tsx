"use client";

/* eslint-disable @next/next/no-img-element */

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Account, PublicAccount, Role, changePassword, createAccount, createFirstAdmin, deleteAccount, getAccounts, getCurrentAccount, hasAnyAccounts, login, logout } from "@/lib/auth";
import { FinalDecision, ReceiptRecord, analyzeReceipt, deleteReceipt, getReceipts, recordDecision } from "@/lib/receipts";
import type { AnalysisResult, Flag, Tier } from "@/lib/analysis/types";

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { label: string };

function Logo() {
  return <div className="brand"><span className="brand-mark">A</span><span>Authentico</span></div>;
}

function Field({ label, ...props }: InputProps) {
  return <label className="field"><span>{label}</span><input {...props} /></label>;
}

function AuthShell({ children }: { children: React.ReactNode }) {
  return <main className="auth-layout">
    <section className="intro-panel">
      <Logo />
      <div className="intro-copy"><p className="eyebrow light">RECEIPT INTELLIGENCE</p><h1>Your go to receipt fraud-triage tool</h1></div>
      <p className="footnote">Built for human review. Never automatic rejection.</p>
    </section>
    <section className="form-panel">{children}</section>
  </main>;
}

function LoginForm({ onLogin }: { onLogin: (account: Account) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setBusy(true);
    try { onLogin(await login(email, password)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to sign in."); }
    finally { setBusy(false); }
  }

  return <AuthShell><div className="form-card">
    <p className="eyebrow">SECURE ACCESS</p><h2>Welcome back</h2><p className="muted">Sign in with your admin or member account.</p>
    <form onSubmit={submit}>
      <Field label="Email address" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
      <Field label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" />
      {error && <p className="message error" role="alert">{error}</p>}
      <button className="primary-button" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button>
    </form>
    <p className="help-text">Need an account? Ask your Authentico admin to add you.</p>
  </div></AuthShell>;
}

function SetupForm({ onCreated }: { onCreated: (account: Account) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 8) return setError("Use at least 8 characters for your password.");
    setError(""); setBusy(true);
    try { onCreated(await createFirstAdmin({ name, email, password })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to create the account."); }
    finally { setBusy(false); }
  }

  return <AuthShell><div className="form-card">
    <span className="setup-badge">First-time setup</span><h2>Create your admin account</h2>
    <form onSubmit={submit}>
      <Field label="Full name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
      <Field label="Work email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@company.com" />
      <Field label="Password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
      {error && <p className="message error" role="alert">{error}</p>}
      <button className="primary-button" disabled={busy}>{busy ? "Creating account..." : "Create admin account"}</button>
    </form>
  </div></AuthShell>;
}

function AddAccount({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();

    if (password.length < 8) {
      setMessage({ kind: "error", text: "Use at least 8 characters for the temporary password." });
      return;
    }

    setBusy(true);
    setMessage(null);

    try {
      const invitedEmail = email.trim().toLowerCase();
      const invitedRole = role;
      await createAccount({ name, email: invitedEmail, password, role: invitedRole });
      setName("");
      setEmail("");
      setPassword("");
      setRole("member");
      setMessage({
        kind: "success",
        text: `${invitedRole === "admin" ? "Admin" : "Member"} account created. A password reset email has been sent to ${invitedEmail}.`,
      });
      onAdded();
    } catch (reason) {
      setMessage({ kind: "error", text: reason instanceof Error ? reason.message : "Unable to create account or send reset email." });
    } finally {
      setBusy(false);
    }
  }

  return <form className="member-form" onSubmit={submit}>
    <Field label="Name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
    <Field label="Email address" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@company.com" />
    <label className="field"><span>Role</span><select required value={role} onChange={(e) => setRole(e.target.value as Role)}><option value="member">Member</option><option value="admin">Admin</option></select></label>
    <Field label="Temporary password" type="password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
    {message && <p className={`message ${message.kind}`}>{message.text}</p>}
    <button className="primary-button compact" disabled={busy}>{busy ? "Sending reset email..." : "Send invite"}</button>
  </form>;
}

type ReceiptType = "medical" | "purchase" | "grab";

const receiptTypes: { id: ReceiptType; title: string; description: string; abbreviation: string }[] = [
  { id: "medical", title: "Medical claim", description: "Clinic, pharmacy, hospital or treatment receipt", abbreviation: "MC" },
  { id: "purchase", title: "Purchase claim", description: "Business purchase, supplies or reimbursement", abbreviation: "PC" },
  { id: "grab", title: "Grab claim", description: "Transport, delivery or Grab service receipt", abbreviation: "GC" },
];

const tierMeta: Record<Tier, { label: string; blurb: string }> = {
  green: { label: "Low risk", blurb: "No deterministic red flags in the available checks." },
  amber: { label: "Some risk", blurb: "Worth a human look before approving." },
  red: { label: "High risk", blurb: "Manual review recommended before processing." },
};

const statusOrder: Record<Flag["status"], number> = { triggered: 0, pending: 1, passed: 2 };
const statusLabel: Record<Flag["status"], string> = { triggered: "Flagged", pending: "AI pending", passed: "Passed" };


function formatDateTime(value: string | null) {
  if (!value) return "Not yet reviewed";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function hasDistinctReviewedTime(receipt: ReceiptRecord) {
  if (!receipt.reviewedAt) return false;
  const checked = new Date(receipt.createdAt).getTime();
  const reviewed = new Date(receipt.reviewedAt).getTime();
  if (Number.isNaN(checked) || Number.isNaN(reviewed)) return true;
  return Math.abs(reviewed - checked) > 60_000;
}

function reviewStatusText(receipt: ReceiptRecord) {
  if (hasDistinctReviewedTime(receipt)) return formatDateTime(receipt.reviewedAt);
  if (receipt.finalDecision === "pending") return "Not manually reviewed yet";
  if (receipt.reviewedAt) return "Reviewed shortly after the check";
  return "No manual review recorded";
}

function formatHistoryReviewed(receipt: ReceiptRecord) {
  if (receipt.reviewedAt && receipt.finalDecision !== "pending") return formatDateTime(receipt.reviewedAt);
  return "—";
}

function isArithmeticFlag(flag: Flag | null) {
  if (!flag) return false;
  const text = `${flag.id} ${flag.title}`.toLowerCase();
  return text.includes("arithmetic") || text.includes("subtotal") || text.includes("total");
}

function displayFlagTitle(flag: Flag) {
  return flag.title;
}

function parseMoneyAmount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[^\d.-]/g, "").trim();
  if (!normalized) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeArithmeticLabel(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;

  const lower = trimmed.toLowerCase();

  // Your current analyzer sometimes returns labels such as
  // "base + tax vs total". That is useful internally, but confusing in the UI.
  // For the reviewer, the wrong printed line is simply the TOTAL line.
  if (
    lower.includes("base + tax vs total") ||
    lower.includes("subtotal") && lower.includes("total") ||
    lower.includes("tax") && lower.includes("total")
  ) {
    return "TOTAL";
  }

  if (lower === "total" || lower.includes("printed total")) return "TOTAL";
  if (lower.includes("balance due")) return "BALANCE DUE";
  if (lower.includes("amount due")) return "AMOUNT DUE";
  return trimmed;
}

function arithmeticFallbackLabel(flag: Flag) {
  const summary = arithmeticMismatchSummary(flag);
  if (summary?.actualAmount !== null && summary?.actualAmount !== undefined && summary?.expectedAmount !== null && summary?.expectedAmount !== undefined) {
    const target = normalizeArithmeticLabel(summary.targetLineLabel, "TOTAL");
    return `${target}: printed $${summary.expectedAmount.toFixed(2)}, expected $${summary.actualAmount.toFixed(2)}`;
  }
  return "Arithmetic mismatch found here";
}

function firstMismatch(flag: Flag) {
  const raw = flag.evidence && isRecord(flag.evidence) ? (flag.evidence as Record<string, unknown>).mismatches : undefined;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.find(isRecord) ?? null;
}

function arithmeticMismatchSummary(flag: Flag) {
  if (!isArithmeticFlag(flag)) return null;
  const mismatch = firstMismatch(flag);
  if (!mismatch) return null;
  const actual = mismatch.actual ?? mismatch.calculated ?? mismatch.detected;
  const expected = mismatch.expected ?? mismatch.printed ?? mismatch.total;
  const actualAmount = parseMoneyAmount(actual);
  const expectedAmount = parseMoneyAmount(expected);
  const delta = actualAmount !== null && expectedAmount !== null ? expectedAmount - actualAmount : null;
  const targetLineLabel = normalizeArithmeticLabel(mismatch.targetLineLabel ?? mismatch.expectedLabel ?? mismatch.label, "TOTAL");
  const rawExpectedLabel = normalizeArithmeticLabel(mismatch.expectedLabel, `Printed ${targetLineLabel}`);
  return {
    label: normalizeArithmeticLabel(mismatch.label, "receipt amount comparison"),
    targetLineLabel,
    basis: typeof mismatch.calculationBasis === "string" ? mismatch.calculationBasis : null,
    actualLabel: typeof mismatch.actualLabel === "string" ? mismatch.actualLabel : "Expected amount",
    expectedLabel: rawExpectedLabel.toLowerCase().startsWith("printed") ? rawExpectedLabel : `Printed ${targetLineLabel}`,
    actual,
    expected,
    actualAmount,
    expectedAmount,
    delta,
  };
}

function flagLocation(flag: Flag) {
  if (flag.status === "pending") return "Not checked yet";
  if (flag.id.includes("exif") || flag.id.includes("pdf") || flag.id === "exif-camera") return "Hidden file metadata";
  if (flag.id === "duplicate") return "Whole uploaded file";
  if (isArithmeticFlag(flag)) return "Receipt amount lines";
  if (flag.id === "font-consistency") return "Text blocks and spacing";
  if (flag.id === "round-numbers") return "Amount fields";
  return "Receipt evidence";
}

function visualRegionLabel(flag: Flag, regionCount: number) {
  if (isArithmeticFlag(flag)) {
    const summary = arithmeticMismatchSummary(flag);
    const target = summary?.targetLineLabel ? formatEvidenceKey(summary.targetLineLabel) : "Printed amount";
    return `${target} line`;
  }
  return `${regionCount} highlighted region${regionCount === 1 ? "" : "s"} on receipt`;
}

function visualRegionHint(flag: Flag) {
  if (isArithmeticFlag(flag)) {
    return "Only the exact OCR-backed mismatched amount is highlighted.";
  }
  return "Click this card to show the boxed evidence on the receipt preview.";
}

function flagCaught(flag: Flag) {
  if (flag.status === "passed") return "Nothing suspicious found for this check.";
  if (flag.status === "pending") return "This check is pending, so it should not be used for the final decision yet.";
  if (isArithmeticFlag(flag)) {
    const summary = arithmeticMismatchSummary(flag);
    if (summary && summary.actualAmount !== null && summary.expectedAmount !== null) {
      const basis = summary.basis ? `${formatEvidenceKey(summary.basis)}. ` : "";
      return `${basis}${summary.actualLabel}: $${summary.actualAmount.toFixed(2)}. ${summary.expectedLabel}: $${summary.expectedAmount.toFixed(2)}.`;
    }
    return "The printed amount does not match the amount calculated from the receipt values. Review the extracted values below.";
  }
  const evidence = flag.evidence ? Object.entries(flag.evidence).filter(([, v]) => v !== null && v !== undefined) : [];
  if (evidence.length === 0) return flag.explanation;
  return evidence.map(([key, value]) => `${formatEvidenceKey(key)}: ${evidencePlainText(value)}`).join(" · ");
}

function displayFlagExplanation(flag: Flag) {
  if (!isArithmeticFlag(flag)) return flag.explanation;
  const summary = arithmeticMismatchSummary(flag);
  if (summary && summary.actualAmount !== null && summary.expectedAmount !== null) {
    const basis = summary.basis ? `${formatEvidenceKey(summary.basis)} ` : "";
    return `${basis}${summary.actualLabel} is $${summary.actualAmount.toFixed(2)}, while ${summary.expectedLabel.toLowerCase()} is $${summary.expectedAmount.toFixed(2)}.`;
  }
  return flag.explanation;
}

function ScoreMeter({ score, tier }: { score: number; tier: Tier }) {
  return <div className="score-meter">
    <div className="score-track"><div className={`score-fill ${tier}`} style={{ width: `${score}%` }} /></div>
    <span className="score-value">{score}/100 risk</span>
  </div>;
}

function FlagItem({ flag, selected = false, onSelect }: { flag: Flag; selected?: boolean; onSelect?: () => void }) {
  const evidence = evidenceEntries(flag);
  const regionCount = flagRegions(flag).length;

  return <li className={`flag-item ${flag.status} ${selected ? "selected" : ""}`}>
    <button type="button" className="flag-select-button" onClick={onSelect} disabled={!onSelect}>
      <span className="flag-head">
        <span className={`flag-status ${flag.status}`}>{statusLabel[flag.status]}</span>
        <strong>{displayFlagTitle(flag)}</strong>
        <span className={`flag-severity ${flag.severity}`}>{flag.severity}</span>
      </span>
      <span className="flag-copy">{displayFlagExplanation(flag)}</span>
      <span className="flag-location-box">
        <span>Where to check</span>
        <strong>{regionCount > 0 ? visualRegionLabel(flag, regionCount) : flagLocation(flag)}</strong>
        <small>{regionCount > 0 ? visualRegionHint(flag) : flagCaught(flag)}</small>
      </span>
      {regionCount > 0 && <span className="flag-view-hint">View on receipt</span>}
    </button>
    {isArithmeticFlag(flag) ? <ArithmeticEvidenceDetails flag={flag} /> : evidence.length > 0 && <dl className="flag-evidence">{evidence.map(([key, value]) => <div key={key}><dt>{formatEvidenceKey(key)}</dt><dd>{evidenceValue(value)}</dd></div>)}</dl>}
  </li>;
}

function ResultSummary({ receipt, onDecision, onReset }: { receipt: ReceiptRecord; onDecision: (d: "authentic" | "rejected") => Promise<void>; onReset: () => void }) {
  const [busy, setBusy] = useState<"authentic" | "rejected" | null>(null);
  const [error, setError] = useState("");
  const result: AnalysisResult = receipt.result;
  const flags = [...result.flags].sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);
  const meta = tierMeta[result.tier];

  async function decide(decision: "authentic" | "rejected") {
    setBusy(decision); setError("");
    try { await onDecision(decision); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save the decision."); }
    finally { setBusy(null); }
  }

  return <section className="receipt-workflow result-view">
    <div className={`result-banner ${result.tier}`}>
      <div><span className="result-tier-pill">{meta.label}</span><h2>{receipt.fileName}</h2><p>{result.summary}</p></div>
      <ScoreMeter score={result.score} tier={result.tier} />
    </div>

    <ul className="flag-list">{flags.map((flag) => <FlagItem key={flag.id} flag={flag} />)}</ul>

    <div className="final-check">
      <div><p className="eyebrow">FINAL CHECK</p><p className="muted final-check-copy">Authentico never auto-rejects. Confirm your decision before processing.</p></div>
      {receipt.finalDecision === "pending" ? <div className="decision-buttons">
        <button className="primary-button compact" disabled={busy !== null} onClick={() => decide("authentic")}>{busy === "authentic" ? "Saving..." : "Mark authentic"}</button>
        <button className="danger-button" disabled={busy !== null} onClick={() => decide("rejected")}>{busy === "rejected" ? "Saving..." : "Reject"}</button>
      </div> : <span className={`decision-pill ${receipt.finalDecision}`}>{receipt.finalDecision === "authentic" ? "Marked authentic" : "Rejected"}</span>}
      {error && <p className="message error" role="alert">{error}</p>}
    </div>

    <button className="text-button dark" onClick={onReset}>Check another receipt</button>
  </section>;
}

function ReceiptUpload({ onAnalyzed }: { onAnalyzed?: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [receiptType, setReceiptType] = useState<ReceiptType | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<"form" | "analyzing">("form");
  const [receipt, setReceipt] = useState<ReceiptRecord | null>(null);

  function selectType(type: ReceiptType) {
    setReceiptType(type);
  }

  function fileKind(selected: File) {
    const extension = selected.name.toLowerCase().split(".").pop();
    if (selected.type === "application/pdf" || extension === "pdf") return "PDF";
    if (selected.type === "image/jpeg" || extension === "jpg" || extension === "jpeg") return "JPEG";
    if (selected.type === "image/png" || extension === "png") return "PNG";
    if (selected.type === "image/heic" || selected.type === "image/heif" || extension === "heic" || extension === "heif") return "HEIC";
    return null;
  }

  function selectFile(selected: File | undefined) {
    setError("");
    if (!selected) return;

    if (!fileKind(selected)) {
      setFile(null);
      setError("Please choose a PDF, JPEG, PNG, or HEIC file.");
      return;
    }
    if (selected.size > 10 * 1024 * 1024) {
      setFile(null);
      setError("The file must be 10 MB or smaller.");
      return;
    }
    setFile(selected);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    selectFile(event.target.files?.[0]);
  }

  function removeFile() {
    setFile(null);
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  }

  function reset() {
    setReceipt(null);
    setReceiptType(null);
    setFile(null);
    setError("");
    setPhase("form");
    if (inputRef.current) inputRef.current.value = "";
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!receiptType) return setError("Choose a receipt type first.");
    if (!file) return setError("Choose a receipt file to continue.");
    setError("");
    setPhase("analyzing");
    try {
      setReceipt(await analyzeReceipt(file, receiptType));
      onAnalyzed?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to analyze the receipt.");
      setPhase("form");
    }
  }

  async function decide(decision: "authentic" | "rejected") {
    if (!receipt) return;
    setReceipt(await recordDecision(receipt.id, decision));
    onAnalyzed?.();
  }

  if (receipt) return <ResultSummary receipt={receipt} onDecision={decide} onReset={reset} />;

  const selectedType = receiptTypes.find((type) => type.id === receiptType);
  const selectedFileKind = file ? fileKind(file) : null;
  const analyzing = phase === "analyzing";

  return <section className="receipt-workflow">
    <div className="workflow-heading">
      <div><p className="eyebrow">NEW RECEIPT CHECK</p><h2>What kind of receipt are you checking?</h2><p>Select the claim category, then attach one receipt file.</p></div>
      <span className="step-count">2 steps</span>
    </div>

    <form onSubmit={submit}>
      <fieldset className="receipt-type-fieldset" disabled={analyzing}>
        <legend><span>01</span> Choose a receipt type</legend>
        <div className="receipt-type-grid">
          {receiptTypes.map((type) => <label className={`receipt-type-card ${receiptType === type.id ? "selected" : ""}`} key={type.id}>
            <input type="radio" name="receipt-type" value={type.id} checked={receiptType === type.id} onChange={() => selectType(type.id)} />
            <span className="type-mark">{type.abbreviation}</span>
            <span className="type-copy"><strong>{type.title}</strong><small>{type.description}</small></span>
            <span className="radio-mark" aria-hidden="true" />
          </label>)}
        </div>
      </fieldset>

      <fieldset className="receipt-file-fieldset" disabled={!receiptType || analyzing}>
        <legend><span>02</span> Upload your receipt</legend>
        <input ref={inputRef} className="file-input" id="receipt-file" type="file" accept="application/pdf,image/jpeg,image/png,image/heic,image/heif,.pdf,.jpg,.jpeg,.png,.heic,.heif" onChange={onFileChange} />
        {!file ? <label className="upload-zone" htmlFor="receipt-file">
          <span className="upload-icon">FILE</span>
          <strong>{receiptType ? "Choose a receipt file" : "Choose a receipt type first"}</strong>
          <small>PDF, JPEG, PNG or HEIC, up to 10 MB</small>
          <span className="upload-button">Browse files</span>
        </label> : <div className="selected-file">
          <span className="file-badge">{selectedFileKind}</span>
          <div><strong>{file.name}</strong><span>{(file.size / 1024 / 1024).toFixed(2)} MB · {selectedType?.title}</span></div>
          <button type="button" className="remove-file" onClick={removeFile} disabled={analyzing}>Remove</button>
        </div>}
      </fieldset>

      {error && <p className="message error receipt-message" role="alert">{error}</p>}
      <button className="primary-button receipt-submit" disabled={!receiptType || !file || analyzing}>{analyzing ? "Analyzing..." : "Analyze receipt"}</button>
    </form>
  </section>;
}

const claimLabels: Record<string, string> = { medical: "Medical", purchase: "Purchase", grab: "Grab" };
const decisionLabels: Record<FinalDecision, string> = { pending: "Pending review", authentic: "Marked authentic", rejected: "Rejected" };


type EvidenceRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  shape?: "box" | "circle";
  synthetic?: boolean;
  userEdited?: boolean;
};

type ClientOcrLine = EvidenceRegion & {
  text: string;
  confidence?: number;
};

type PlainOcrLine = {
  text: string;
  index: number;
};

type FlagWithRegionEvidence = Flag & {
  evidence?: Flag["evidence"] & {
    regions?: unknown;
    region?: unknown;
    boxes?: unknown;
    ocrLines?: unknown;
    lines?: unknown;
    textLines?: unknown;
    extractedLines?: unknown;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function normalizeCoordinate(value: number) {
  if (value > 1) return value / 100;
  return value;
}

function parseRegion(value: unknown): EvidenceRegion | null {
  if (Array.isArray(value) && value.length >= 4) {
    const rawX = readNumber(value[0]);
    const rawY = readNumber(value[1]);
    const rawThird = readNumber(value[2]);
    const rawFourth = readNumber(value[3]);
    if (rawX === null || rawY === null || rawThird === null || rawFourth === null) return null;
    const x = normalizeCoordinate(rawX);
    const y = normalizeCoordinate(rawY);
    let width = normalizeCoordinate(rawThird);
    let height = normalizeCoordinate(rawFourth);
    if (rawThird > rawX && rawFourth > rawY) {
      const fromRight = normalizeCoordinate(rawThird - rawX);
      const fromBottom = normalizeCoordinate(rawFourth - rawY);
      if (fromRight > 0 && fromBottom > 0 && fromRight <= 1 && fromBottom <= 1) {
        width = fromRight;
        height = fromBottom;
      }
    }
    if (x < 0 || y < 0 || width <= 0 || height <= 0) return null;
    if (x > 1 || y > 1 || width > 1 || height > 1) return null;
    return { x, y, width, height, shape: "box" };
  }

  if (!isRecord(value)) return null;
  const nested = value.region ?? value.bbox ?? value.boundingBox ?? value.box;
  if (nested && nested !== value) {
    const parsed = parseRegion(nested);
    if (parsed) return { ...parsed, label: typeof value.label === "string" ? value.label : parsed.label, shape: value.shape === "circle" ? "circle" : "box" };
  }

  const rawX = readNumber(value.x ?? value.left);
  const rawY = readNumber(value.y ?? value.top);
  const rawRight = readNumber(value.right);
  const rawBottom = readNumber(value.bottom);
  let rawWidth = readNumber(value.width ?? value.w);
  let rawHeight = readNumber(value.height ?? value.h);
  if (rawX === null || rawY === null) return null;
  if ((rawWidth === null || rawHeight === null) && rawRight !== null && rawBottom !== null) {
    rawWidth = rawRight - rawX;
    rawHeight = rawBottom - rawY;
  }
  if (rawWidth === null || rawHeight === null) return null;

  const x = normalizeCoordinate(rawX);
  const y = normalizeCoordinate(rawY);
  const width = normalizeCoordinate(rawWidth);
  const height = normalizeCoordinate(rawHeight);
  if (x < 0 || y < 0 || width <= 0 || height <= 0) return null;
  if (x > 1 || y > 1 || width > 1 || height > 1) return null;

  const label = typeof value.label === "string" ? value.label : undefined;
  const shape = value.shape === "circle" ? "circle" : "box";
  return { x, y, width, height, label, shape };
}

function normalizedSearchText(value: unknown) {
  return String(value ?? "").toLowerCase().replace(/[$,]/g, "").replace(/\s+/g, " ").trim();
}

function moneySearchText(value: number | null) {
  return value === null ? null : value.toFixed(2).replace(/\.00$/, "");
}

function ocrLineText(line: unknown) {
  if (!isRecord(line)) return "";
  return normalizedSearchText([line.text, line.rawText, line.lineText, line.label, line.name, line.key, line.amount, line.value].filter((part) => part !== null && part !== undefined).join(" "));
}

function rawOcrLines(flag: Flag | null): unknown[] {
  if (!flag) return [];
  const evidence = (flag as FlagWithRegionEvidence).evidence;
  if (!evidence) return [];
  for (const value of [evidence.ocrLines, evidence.lines, evidence.textLines, evidence.extractedLines]) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function deriveRegionsFromOcrLines(flag: Flag | null): EvidenceRegion[] {
  if (!flag || !isArithmeticFlag(flag)) return [];
  const summary = arithmeticMismatchSummary(flag);
  const lines = rawOcrLines(flag);
  if (!summary || lines.length === 0) return [];
  const targetLabel = normalizedSearchText(summary.targetLineLabel || summary.expectedLabel || "total");
  const expectedMoney = moneySearchText(summary.expectedAmount);
  const actualMoney = moneySearchText(summary.actualAmount);
  const scored = lines.map((line, index) => {
    const text = ocrLineText(line);
    const region = parseRegion(line);
    if (!region || !text) return null;
    let score = 0;
    if (targetLabel && text.includes(targetLabel)) score += 80;
    if (targetLabel === "total" && /\btotal\b/.test(text) && !text.includes("subtotal")) score += 75;
    if (targetLabel.includes("balance due") && text.includes("balance") && text.includes("due")) score += 80;
    if (expectedMoney && text.includes(expectedMoney)) score += 45;
    if (actualMoney && text.includes(actualMoney)) score -= 25;
    if (text.includes("subtotal")) score -= 45;
    if (text.includes("gst") || text.includes("tax")) score -= 35;
    if (text.includes("tendered") || text.includes("paid") || text.includes("change")) score -= 55;
    return { region, score, index };
  }).filter((entry): entry is { region: EvidenceRegion; score: number; index: number } => Boolean(entry)).sort((a, b) => b.score - a.score || b.index - a.index);
  const best = scored[0];
  if (!best || best.score <= 0) return [];
  return [{ ...best.region, label: arithmeticFallbackLabel(flag), shape: "box" }];
}

function fallbackRegions(flag: Flag | null): EvidenceRegion[] {
  return deriveRegionsFromOcrLines(flag);
}

function flagRegions(flag: Flag | null): EvidenceRegion[] {
  if (!flag) return [];
  const evidence = (flag as FlagWithRegionEvidence).evidence;
  if (!evidence) return fallbackRegions(flag);
  const rawRegions = Array.isArray(evidence.regions) ? evidence.regions : Array.isArray(evidence.boxes) ? evidence.boxes : evidence.region ? [evidence.region] : [];
  const parsed = rawRegions.map(parseRegion).filter((region): region is EvidenceRegion => Boolean(region));
  return parsed.length > 0 ? parsed : fallbackRegions(flag);
}

function uniqueRegionKey(region: EvidenceRegion) {
  return [
    region.x.toFixed(4),
    region.y.toFixed(4),
    region.width.toFixed(4),
    region.height.toFixed(4),
    region.label ?? "",
  ].join("|");
}

function allTriggeredFlagRegions(flags: Flag[]) {
  const seen = new Set<string>();
  const allRegions: { flag: Flag; region: EvidenceRegion }[] = [];

  flags
    .filter((flag) => flag.status === "triggered")
    .forEach((flag) => {
      flagRegions(flag).forEach((region) => {
        const key = `${flag.id}|${uniqueRegionKey(region)}`;
        if (seen.has(key)) return;
        seen.add(key);
        allRegions.push({ flag, region });
      });
    });

  return allRegions;
}

function triggeredFlagsNeedingManualRegion(flags: Flag[]) {
  return flags.filter((flag) => flag.status === "triggered" && flagRegions(flag).length === 0);
}


type ReceiptTextRow = EvidenceRegion & {
  inkPixels: number;
  index: number;
};

function scanReceiptTextRows(image: HTMLImageElement): ReceiptTextRow[] {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (width <= 0 || height <= 0) return [];

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [];

  try {
    context.drawImage(image, 0, 0, width, height);
  } catch {
    return [];
  }

  let imageData: ImageData;
  try {
    imageData = context.getImageData(0, 0, width, height);
  } catch {
    // This happens when the browser cannot read the image because it is loaded
    // from a cross-origin signed URL. Use the same-origin raw file route in this pack.
    return [];
  }

  const data = imageData.data;
  const rows: { count: number; minX: number; maxX: number }[] = Array.from({ length: height }, () => ({
    count: 0,
    minX: width,
    maxX: 0,
  }));

  for (let y = 0; y < height; y += 1) {
    const row = rows[y];

    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const alpha = data[offset + 3];
      if (alpha < 80) continue;

      const average = (r + g + b) / 3;
      const darkness = 255 - average;
      const saturation = Math.max(r, g, b) - Math.min(r, g, b);

      // Text in the receipt is dark. This also captures dark handwritten/tampered
      // values, but excludes pale background/shadows.
      const isInk = darkness > 58 && average < 205 && saturation < 90;
      if (!isInk) continue;

      row.count += 1;
      row.minX = Math.min(row.minX, x);
      row.maxX = Math.max(row.maxX, x);
    }
  }

  const minPixelsPerRow = Math.max(4, Math.floor(width * 0.006));
  const bands: { top: number; bottom: number; minX: number; maxX: number; inkPixels: number }[] = [];
  let active: { top: number; bottom: number; minX: number; maxX: number; inkPixels: number } | null = null;

  rows.forEach((row, y) => {
    const hasInk = row.count >= minPixelsPerRow;

    if (hasInk && !active) {
      active = { top: y, bottom: y, minX: row.minX, maxX: row.maxX, inkPixels: row.count };
      return;
    }

    if (hasInk && active) {
      active.bottom = y;
      active.minX = Math.min(active.minX, row.minX);
      active.maxX = Math.max(active.maxX, row.maxX);
      active.inkPixels += row.count;
      return;
    }

    if (!hasInk && active) {
      bands.push(active);
      active = null;
    }
  });

  if (active) bands.push(active);

  const merged: typeof bands = [];
  const maxGap = Math.max(3, Math.floor(height * 0.006));

  bands.forEach((band) => {
    const previous = merged[merged.length - 1];
    if (previous && band.top - previous.bottom <= maxGap) {
      previous.bottom = band.bottom;
      previous.minX = Math.min(previous.minX, band.minX);
      previous.maxX = Math.max(previous.maxX, band.maxX);
      previous.inkPixels += band.inkPixels;
    } else {
      merged.push({ ...band });
    }
  });

  return merged
    .map((band, index) => {
      const padX = Math.max(4, width * 0.01);
      const padY = Math.max(3, height * 0.008);
      const left = Math.max(0, band.minX - padX);
      const top = Math.max(0, band.top - padY);
      const right = Math.min(width, band.maxX + padX);
      const bottom = Math.min(height, band.bottom + padY);

      return {
        index,
        x: left / width,
        y: top / height,
        width: (right - left) / width,
        height: (bottom - top) / height,
        inkPixels: band.inkPixels,
        shape: "box" as const,
      };
    })
    .filter((row) => {
      // Ignore tiny specks and horizontal receipt separator lines.
      if (row.width < 0.045 || row.height < 0.012) return false;
      if (row.height < 0.018 && row.width > 0.55) return false;
      return true;
    })
    .sort((a, b) => a.y - b.y)
    .map((row, index) => ({ ...row, index }));
}

function targetAmountLineLabel(flag: Flag) {
  const summary = arithmeticMismatchSummary(flag);
  const label = normalizeArithmeticLabel(summary?.targetLineLabel ?? summary?.expectedLabel ?? summary?.label, "TOTAL");
  const normalized = normalizedSearchText(label);

  if (normalized.includes("balance due")) return "BALANCE DUE";
  if (normalized.includes("amount due")) return "AMOUNT DUE";
  return "TOTAL";
}

function pickArithmeticMismatchRow(flag: Flag, rows: ReceiptTextRow[]): EvidenceRegion | null {
  if (flag.status !== "triggered" || !isArithmeticFlag(flag) || rows.length === 0) return null;

  const summary = arithmeticMismatchSummary(flag);
  if (!summary || summary.actualAmount === null || summary.expectedAmount === null) return null;

  const target = targetAmountLineLabel(flag);
  const centerY = (row: ReceiptTextRow) => row.y + row.height / 2;

  // Main receipt amount block is usually below the store/address header and
  // above footer/date/thank-you text. This is not a fixed box coordinate: it is
  // choosing from detected dark text rows in the actual image.
  let candidates = rows.filter((row) => centerY(row) >= 0.42 && centerY(row) <= 0.86);

  if (target === "TOTAL") {
    // For a TOTAL mismatch, choose the last amount-like row before the footer.
    // Rows after 0.80 are usually Date / Thank-you / footer text in generated
    // receipts, so drop them when there are earlier candidates.
    const beforeFooter = candidates.filter((row) => centerY(row) <= 0.80);
    if (beforeFooter.length > 0) candidates = beforeFooter;

    // If the final candidate is a very wide footer/date row, drop it.
    const sorted = [...candidates].sort((a, b) => centerY(a) - centerY(b));
    while (sorted.length > 1) {
      const last = sorted[sorted.length - 1];
      if (last.width > 0.58 && centerY(last) > 0.68) sorted.pop();
      else break;
    }

    const picked = sorted[sorted.length - 1] ?? candidates[candidates.length - 1] ?? rows[rows.length - 1];
    return {
      x: picked.x,
      y: Math.max(0, picked.y - 0.006),
      width: Math.min(1 - picked.x, picked.width),
      height: Math.min(1 - Math.max(0, picked.y - 0.006), picked.height + 0.012),
      label: `${target}: printed $${summary.expectedAmount.toFixed(2)}, expected $${summary.actualAmount.toFixed(2)}`,
      shape: "box",
      synthetic: true,
    };
  }

  // Balance due / amount due receipts often place the value near the bottom.
  const picked = [...candidates].sort((a, b) => centerY(b) - centerY(a))[0] ?? rows[rows.length - 1];
  return {
    x: picked.x,
    y: Math.max(0, picked.y - 0.006),
    width: Math.min(1 - picked.x, picked.width),
    height: Math.min(1 - Math.max(0, picked.y - 0.006), picked.height + 0.012),
    label: `${target}: printed $${summary.expectedAmount.toFixed(2)}, expected $${summary.actualAmount.toFixed(2)}`,
    shape: "box",
    synthetic: true,
  };
}


function hasVisualEvidence(flag: Flag) {
  return flagRegions(flag).length > 0;
}

function evidenceEntries(flag: Flag) {
  if (!flag.evidence) return [] as [string, unknown][];
  return Object.entries(flag.evidence).filter(([key, value]) => {
    if (["regions", "region", "boxes"].includes(key)) return false;
    return value !== null && value !== undefined;
  });
}

function formatEvidenceKey(key: string) {
  return key
    .replace(/[_-]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

function evidencePlainText(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(evidencePlainText).join(", ");
  if (isRecord(value)) {
    return Object.entries(value)
      .filter(([, entryValue]) => entryValue !== null && entryValue !== undefined)
      .map(([entryKey, entryValue]) => `${formatEvidenceKey(entryKey)}: ${evidencePlainText(entryValue)}`)
      .join(" · ");
  }
  return String(value);
}

function formatMoneyLikeValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? `$${value.toFixed(2)}` : String(value);
  if (typeof value !== "string") return evidenceValue(value);
  const normalized = value.trim();
  if (!normalized) return "—";
  const numeric = Number(normalized.replace(/[$,]/g, ""));
  if (!Number.isNaN(numeric) && normalized.match(/^[$,\d.]+$/)) return `$${numeric.toFixed(2)}`;
  return normalized;
}

function evidenceValue(value: unknown): React.ReactNode {
  if (typeof value === "string") {
    const parts = value.split(",").map((part) => part.trim()).filter((line): line is ClientOcrLine => line !== null);
    if (parts.length > 1) {
      return <ul className="evidence-list">{parts.map((part) => <li key={part}>{part}</li>)}</ul>;
    }
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    return <ul className="evidence-list">{value.map((item, index) => <li key={index}>{evidenceValue(item)}</li>)}</ul>;
  }

  if (isRecord(value)) {
    const label = value.label ?? value.name ?? value.check;
    const actual = value.actual ?? value.calculated ?? value.detected;
    const expected = value.expected ?? value.printed ?? value.total;

    if (label !== undefined && (actual !== undefined || expected !== undefined)) {
      const actualLabel = typeof value.actualLabel === "string" ? value.actualLabel : "Expected amount";
      const expectedLabel = typeof value.expectedLabel === "string" ? value.expectedLabel : "Printed amount";
      return <div className="evidence-mismatch-card">
        <strong>{String(label)}</strong>
        <dl>
          {actual !== undefined && <div><dt>{actualLabel}</dt><dd>{formatMoneyLikeValue(actual)}</dd></div>}
          {expected !== undefined && <div><dt>{expectedLabel}</dt><dd>{formatMoneyLikeValue(expected)}</dd></div>}
        </dl>
        <small>Only OCR-backed coordinates should be used for the overlay. If these values are wrong, fix the backend extraction first.</small>
      </div>;
    }

    const entries = Object.entries(value).filter(([, entryValue]) => entryValue !== null && entryValue !== undefined);
    if (entries.length === 0) return "—";

    return <dl className="evidence-nested">{entries.map(([entryKey, entryValue]) => <div key={entryKey}>
      <dt>{formatEvidenceKey(entryKey)}</dt>
      <dd>{evidenceValue(entryValue)}</dd>
    </div>)}</dl>;
  }

  return String(value);
}


function normalizedCheckList(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => evidencePlainText(item)).filter((line): line is ClientOcrLine => line !== null);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter((line): line is ClientOcrLine => line !== null);
  if (value === null || value === undefined) return [] as string[];
  return [evidencePlainText(value)].filter((line): line is ClientOcrLine => line !== null);
}

function ArithmeticEvidenceDetails({ flag }: { flag: Flag }) {
  const evidence = isRecord(flag.evidence) ? flag.evidence as Record<string, unknown> : {};
  const checks = normalizedCheckList(evidence.checked);
  const summary = arithmeticMismatchSummary(flag);
  const delta = summary?.delta ?? null;
  return <div className="arithmetic-evidence-grid">
    <div className="arithmetic-evidence-card">
      <span>What was checked</span>
      <ul>
        {checks.length > 0 ? checks.map((check) => <li key={check}>{check}</li>) : <li>Receipt amount consistency</li>}
      </ul>
    </div>
    <div className="arithmetic-evidence-card alert">
      <span>Detected issue</span>
      {summary && summary.actualAmount !== null && summary.expectedAmount !== null ? <>
        {summary.basis && <p className="arithmetic-basis">Basis: {formatEvidenceKey(summary.basis)}</p>}
        <strong>{summary.actualLabel}: ${summary.actualAmount.toFixed(2)}</strong>
        <strong>{summary.expectedLabel}: ${summary.expectedAmount.toFixed(2)}</strong>
        <p>Difference: ${Math.abs(delta ?? 0).toFixed(2)}</p>
        <small>The preview only highlights the exact printed amount that the backend attached OCR coordinates to.</small>
      </> : <>
        <strong>Receipt amount mismatch detected.</strong>
        <small>Review the extracted values below and return exact OCR coordinates for the wrong printed amount line.</small>
      </>}
    </div>
  </div>;
}

function visualEvidenceNote(flag: Flag | null) {
  if (!flag) return "Select a check below to see its evidence here.";
  if (flagRegions(flag).length > 0) {
    return isArithmeticFlag(flag)
      ? "The wrong printed amount is highlighted. Use backend OCR regions for the most accurate box."
      : "Highlighted evidence for the selected check.";
  }
  if (isArithmeticFlag(flag)) {
    return "No backend region was returned yet. The preview will try client OCR, or you can draw a box manually.";
  }
  if (flag.id.includes("exif") || flag.id.includes("pdf") || flag.id === "duplicate") {
    return "File-level or metadata evidence. Read the selected flag details below.";
  }
  if (flag.status === "pending") return "Selected check pending. Read the selected flag details below.";
  return "Selected check. Read the selected flag details below.";
}


function clientOcrLineText(line: ClientOcrLine) {
  return normalizedSearchText(line.text);
}



function ocrNodeToClientLine(node: unknown, imageWidth: number, imageHeight: number): ClientOcrLine | null {
  if (!isRecord(node) || imageWidth <= 0 || imageHeight <= 0) return null;

  const text = String(node.text ?? node.label ?? node.name ?? "").trim();
  if (!text) return null;

  const bbox = isRecord(node.bbox) ? node.bbox : node;
  const x0 = readNumber(bbox.x0 ?? bbox.left ?? bbox.x);
  const y0 = readNumber(bbox.y0 ?? bbox.top ?? bbox.y);
  const x1 = readNumber(bbox.x1 ?? bbox.right);
  const y1 = readNumber(bbox.y1 ?? bbox.bottom);
  const width = readNumber(bbox.width ?? bbox.w);
  const height = readNumber(bbox.height ?? bbox.h);

  if (x0 === null || y0 === null) return null;

  const right = x1 ?? (width !== null ? x0 + width : null);
  const bottom = y1 ?? (height !== null ? y0 + height : null);
  if (right === null || bottom === null) return null;

  const normalizedLine = {
    text,
    x: x0 / imageWidth,
    y: y0 / imageHeight,
    width: (right - x0) / imageWidth,
    height: (bottom - y0) / imageHeight,
    shape: "box" as const,
    confidence: readNumber(node.confidence ?? node.conf) ?? undefined,
  };

  if (
    normalizedLine.x < 0 ||
    normalizedLine.y < 0 ||
    normalizedLine.width <= 0 ||
    normalizedLine.height <= 0 ||
    normalizedLine.x > 1 ||
    normalizedLine.y > 1 ||
    normalizedLine.width > 1 ||
    normalizedLine.height > 1
  ) {
    return null;
  }

  return normalizedLine;
}

function collectOcrNodes(value: unknown, imageWidth: number, imageHeight: number, output: ClientOcrLine[] = []) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectOcrNodes(entry, imageWidth, imageHeight, output));
    return output;
  }

  if (!isRecord(value)) return output;

  const line = ocrNodeToClientLine(value, imageWidth, imageHeight);
  if (line) output.push(line);

  for (const key of ["lines", "words", "paragraphs", "blocks", "children", "items"]) {
    const nested = value[key];
    if (Array.isArray(nested)) collectOcrNodes(nested, imageWidth, imageHeight, output);
  }

  return output;
}

function tsvToClientLines(tsv: unknown, imageWidth: number, imageHeight: number): ClientOcrLine[] {
  if (typeof tsv !== "string" || imageWidth <= 0 || imageHeight <= 0) return [];

  const rows = tsv
    .split(/\r?\n/)
    .map((row) => row.trimEnd())
    .filter((line): line is ClientOcrLine => line !== null);

  if (rows.length < 2) return [];

  const header = rows[0].split("\t");
  const indexOf = (name: string) => header.indexOf(name);

  const levelIndex = indexOf("level");
  const pageIndex = indexOf("page_num");
  const blockIndex = indexOf("block_num");
  const parIndex = indexOf("par_num");
  const lineIndex = indexOf("line_num");
  const leftIndex = indexOf("left");
  const topIndex = indexOf("top");
  const widthIndex = indexOf("width");
  const heightIndex = indexOf("height");
  const confIndex = indexOf("conf");
  const textIndex = indexOf("text");

  if ([leftIndex, topIndex, widthIndex, heightIndex, textIndex].some((index) => index < 0)) return [];

  const groups = new Map<string, {
    words: string[];
    left: number;
    top: number;
    right: number;
    bottom: number;
    confidences: number[];
  }>();

  rows.slice(1).forEach((row) => {
    const cols = row.split("\t");
    const word = (cols[textIndex] ?? "").trim();
    if (!word) return;

    const left = readNumber(cols[leftIndex]);
    const top = readNumber(cols[topIndex]);
    const width = readNumber(cols[widthIndex]);
    const height = readNumber(cols[heightIndex]);
    if (left === null || top === null || width === null || height === null || width <= 0 || height <= 0) return;

    const key = [
      pageIndex >= 0 ? cols[pageIndex] : "0",
      blockIndex >= 0 ? cols[blockIndex] : "0",
      parIndex >= 0 ? cols[parIndex] : "0",
      lineIndex >= 0 ? cols[lineIndex] : "0",
    ].join(":");

    const confidence = confIndex >= 0 ? readNumber(cols[confIndex]) : null;
    const current = groups.get(key);

    if (!current) {
      groups.set(key, {
        words: [word],
        left,
        top,
        right: left + width,
        bottom: top + height,
        confidences: confidence !== null && confidence >= 0 ? [confidence] : [],
      });
      return;
    }

    current.words.push(word);
    current.left = Math.min(current.left, left);
    current.top = Math.min(current.top, top);
    current.right = Math.max(current.right, left + width);
    current.bottom = Math.max(current.bottom, top + height);
    if (confidence !== null && confidence >= 0) current.confidences.push(confidence);
  });

  return Array.from(groups.values())
    .map((group) => ({
      text: group.words.join(" "),
      x: group.left / imageWidth,
      y: group.top / imageHeight,
      width: (group.right - group.left) / imageWidth,
      height: (group.bottom - group.top) / imageHeight,
      shape: "box" as const,
      confidence: group.confidences.length
        ? group.confidences.reduce((sum, value) => sum + value, 0) / group.confidences.length
        : undefined,
    }))
    .filter((line) => line.x >= 0 && line.y >= 0 && line.width > 0 && line.height > 0 && line.x <= 1 && line.y <= 1 && line.width <= 1 && line.height <= 1);
}

function uniqueClientLines(lines: ClientOcrLine[]) {
  const seen = new Set<string>();
  return lines.filter((line) => {
    const key = `${line.text}|${line.x.toFixed(4)}|${line.y.toFixed(4)}|${line.width.toFixed(4)}|${line.height.toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function tesseractLinesToClientLines(lines: unknown[], imageWidth: number, imageHeight: number): ClientOcrLine[] {
  if (!Array.isArray(lines) || imageWidth <= 0 || imageHeight <= 0) return [];

  return lines
    .map((line) => {
      if (!isRecord(line)) return null;

      const text = String(line.text ?? "").trim();
      if (!text) return null;

      const bbox = isRecord(line.bbox) ? line.bbox : line;
      const x0 = readNumber(bbox.x0 ?? bbox.left ?? bbox.x);
      const y0 = readNumber(bbox.y0 ?? bbox.top ?? bbox.y);
      const x1 = readNumber(bbox.x1 ?? bbox.right);
      const y1 = readNumber(bbox.y1 ?? bbox.bottom);
      const width = readNumber(bbox.width ?? bbox.w);
      const height = readNumber(bbox.height ?? bbox.h);

      if (x0 === null || y0 === null) return null;

      const right = x1 ?? (width !== null ? x0 + width : null);
      const bottom = y1 ?? (height !== null ? y0 + height : null);
      if (right === null || bottom === null) return null;

      const normalizedLine = {
        text,
        x: x0 / imageWidth,
        y: y0 / imageHeight,
        width: (right - x0) / imageWidth,
        height: (bottom - y0) / imageHeight,
        shape: "box" as const,
        confidence: readNumber(line.confidence) ?? undefined,
      };

      if (
        normalizedLine.x < 0 ||
        normalizedLine.y < 0 ||
        normalizedLine.width <= 0 ||
        normalizedLine.height <= 0 ||
        normalizedLine.x > 1 ||
        normalizedLine.y > 1 ||
        normalizedLine.width > 1 ||
        normalizedLine.height > 1
      ) {
        return null;
      }

      return normalizedLine;
    })
    .filter((line): line is ClientOcrLine => Boolean(line));
}

function wordsToClientLines(words: unknown[], imageWidth: number, imageHeight: number): ClientOcrLine[] {
  if (!Array.isArray(words) || imageWidth <= 0 || imageHeight <= 0) return [];

  const parsedWords = words
    .map((word) => {
      if (!isRecord(word)) return null;
      const text = String(word.text ?? "").trim();
      const bbox = isRecord(word.bbox) ? word.bbox : word;
      const x0 = readNumber(bbox.x0 ?? bbox.left ?? bbox.x);
      const y0 = readNumber(bbox.y0 ?? bbox.top ?? bbox.y);
      const x1 = readNumber(bbox.x1 ?? bbox.right);
      const y1 = readNumber(bbox.y1 ?? bbox.bottom);
      const width = readNumber(bbox.width ?? bbox.w);
      const height = readNumber(bbox.height ?? bbox.h);
      if (!text || x0 === null || y0 === null) return null;

      const right = x1 ?? (width !== null ? x0 + width : null);
      const bottom = y1 ?? (height !== null ? y0 + height : null);
      if (right === null || bottom === null) return null;

      return {
        text,
        x0,
        y0,
        x1: right,
        y1: bottom,
        confidence: readNumber(word.confidence),
      };
    })
    .filter((word): word is { text: string; x0: number; y0: number; x1: number; y1: number; confidence: number | null } => Boolean(word))
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);

  const grouped: typeof parsedWords[] = [];
  for (const word of parsedWords) {
    const wordHeight = Math.max(1, word.y1 - word.y0);
    const centerY = (word.y0 + word.y1) / 2;
    const existing = grouped.find((line) => {
      const lineY = line.reduce((sum, item) => sum + ((item.y0 + item.y1) / 2), 0) / Math.max(1, line.length);
      const lineHeight = line.reduce((sum, item) => sum + Math.max(1, item.y1 - item.y0), 0) / Math.max(1, line.length);
      return Math.abs(centerY - lineY) <= Math.max(wordHeight, lineHeight) * 0.65;
    });

    if (existing) existing.push(word);
    else grouped.push([word]);
  }

  return grouped
    .map((line) => {
      const sorted = [...line].sort((a, b) => a.x0 - b.x0);
      const x0 = Math.min(...sorted.map((word) => word.x0));
      const y0 = Math.min(...sorted.map((word) => word.y0));
      const x1 = Math.max(...sorted.map((word) => word.x1));
      const y1 = Math.max(...sorted.map((word) => word.y1));
      const confidenceValues = sorted.map((word) => word.confidence).filter((value): value is number => value !== null);
      return {
        text: sorted.map((word) => word.text).join(" "),
        x: x0 / imageWidth,
        y: y0 / imageHeight,
        width: (x1 - x0) / imageWidth,
        height: (y1 - y0) / imageHeight,
        shape: "box" as const,
        confidence: confidenceValues.length ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length : undefined,
      };
    })
    .filter((line) => line.x >= 0 && line.y >= 0 && line.width > 0 && line.height > 0 && line.x <= 1 && line.y <= 1 && line.width <= 1 && line.height <= 1);
}

function deriveRegionFromClientOcrLines(flag: Flag | null, lines: ClientOcrLine[]): EvidenceRegion[] {
  if (!flag || !isArithmeticFlag(flag) || lines.length === 0) return [];

  const summary = arithmeticMismatchSummary(flag);
  if (!summary) return [];

  const targetLabel = normalizedSearchText(summary.targetLineLabel || summary.expectedLabel || "total");
  const expectedMoney = moneySearchText(summary.expectedAmount);
  const actualMoney = moneySearchText(summary.actualAmount);

  const scored = lines
    .map((line, index) => {
      const text = clientOcrLineText(line);
      let score = 0;

      if (targetLabel && text.includes(targetLabel)) score += 90;
      if (targetLabel === "total" && /\btotal\b/.test(text) && !text.includes("subtotal")) score += 85;
      if (targetLabel.includes("balance due") && text.includes("balance") && text.includes("due")) score += 90;
      if (targetLabel.includes("amount due") && text.includes("amount") && text.includes("due")) score += 90;

      if (expectedMoney && text.includes(expectedMoney)) score += 70;
      if (actualMoney && text.includes(actualMoney)) score -= 35;

      if (text.includes("subtotal")) score -= 60;
      if (text.includes("gst") || text.includes("tax")) score -= 45;
      if (text.includes("tendered") || text.includes("paid") || text.includes("change")) score -= 70;
      if (text.includes("thank") || text.includes("come again")) score -= 80;

      return { line, score, index };
    })
    .sort((a, b) => b.score - a.score || b.index - a.index);

  const best = scored[0];
  if (!best || best.score <= 0) return [];

  return [{
    x: best.line.x,
    y: best.line.y,
    width: best.line.width,
    height: best.line.height,
    label: arithmeticFallbackLabel(flag),
    shape: "box",
  }];
}


function plainOcrLinesFromText(value: unknown): PlainOcrLine[] {
  if (typeof value !== "string") return [];

  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({ text: line, index }));
}

function scorePlainLineForFlag(flag: Flag | null, lineText: string) {
  if (!flag || !isArithmeticFlag(flag)) return 0;

  const summary = arithmeticMismatchSummary(flag);
  if (!summary) return 0;

  const text = normalizedSearchText(lineText);
  const targetLabel = normalizedSearchText(summary.targetLineLabel || summary.expectedLabel || "total");
  const expectedMoney = moneySearchText(summary.expectedAmount);
  const actualMoney = moneySearchText(summary.actualAmount);

  let score = 0;

  if (targetLabel && text.includes(targetLabel)) score += 100;
  if (targetLabel === "total" && /\btotal\b/.test(text) && !text.includes("subtotal")) score += 95;
  if (targetLabel.includes("balance due") && text.includes("balance") && text.includes("due")) score += 100;
  if (targetLabel.includes("amount due") && text.includes("amount") && text.includes("due")) score += 100;

  if (expectedMoney && text.includes(expectedMoney)) score += 85;
  if (actualMoney && text.includes(actualMoney)) score -= 45;

  if (text.includes("subtotal")) score -= 90;
  if (text.includes("gst") || text.includes("tax")) score -= 70;
  if (text.includes("tendered") || text.includes("paid") || text.includes("change")) score -= 100;
  if (text.includes("thank") || text.includes("come again")) score -= 100;

  return score;
}

function bestPlainLineIndexForFlag(flag: Flag | null, lines: PlainOcrLine[]) {
  if (!flag || lines.length === 0) return null;

  const scored = lines
    .map((line) => ({ line, score: scorePlainLineForFlag(flag, line.text) }))
    .sort((a, b) => b.score - a.score || b.line.index - a.line.index);

  const best = scored[0];
  if (!best || best.score <= 0) return null;
  return best.line.index;
}

function estimateTextRowRegionsFromImage(image: HTMLImageElement): EvidenceRegion[] {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (width <= 0 || height <= 0) return [];

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [];

  context.drawImage(image, 0, 0, width, height);
  const data = context.getImageData(0, 0, width, height).data;

  const rowBounds: { count: number; minX: number; maxX: number }[] = Array.from({ length: height }, () => ({
    count: 0,
    minX: width,
    maxX: 0,
  }));

  for (let y = 0; y < height; y += 1) {
    const row = rowBounds[y];

    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const alpha = data[offset + 3];

      if (alpha < 80) continue;

      const darkness = 255 - ((r + g + b) / 3);
      const isInk = darkness > 65 && r < 210 && g < 210 && b < 210;

      if (!isInk) continue;

      row.count += 1;
      row.minX = Math.min(row.minX, x);
      row.maxX = Math.max(row.maxX, x);
    }
  }

  const minPixelsPerRow = Math.max(4, Math.floor(width * 0.006));
  const bands: { top: number; bottom: number; minX: number; maxX: number; pixels: number }[] = [];
  let active: { top: number; bottom: number; minX: number; maxX: number; pixels: number } | null = null;

  rowBounds.forEach((row, y) => {
    const hasInk = row.count >= minPixelsPerRow;

    if (hasInk && !active) {
      active = { top: y, bottom: y, minX: row.minX, maxX: row.maxX, pixels: row.count };
      return;
    }

    if (hasInk && active) {
      active.bottom = y;
      active.minX = Math.min(active.minX, row.minX);
      active.maxX = Math.max(active.maxX, row.maxX);
      active.pixels += row.count;
      return;
    }

    if (!hasInk && active) {
      bands.push(active);
      active = null;
    }
  });

  if (active) bands.push(active);

  const merged: typeof bands = [];
  bands.forEach((band) => {
    const last = merged[merged.length - 1];
    if (last && band.top - last.bottom <= Math.max(3, height * 0.006)) {
      last.bottom = band.bottom;
      last.minX = Math.min(last.minX, band.minX);
      last.maxX = Math.max(last.maxX, band.maxX);
      last.pixels += band.pixels;
    } else {
      merged.push({ ...band });
    }
  });

  return merged
    .map((band) => {
      const padX = Math.max(3, width * 0.008);
      const padY = Math.max(2, height * 0.004);

      return {
        x: Math.max(0, (band.minX - padX) / width),
        y: Math.max(0, (band.top - padY) / height),
        width: Math.min(1, (band.maxX - band.minX + (padX * 2)) / width),
        height: Math.min(1, (band.bottom - band.top + (padY * 2)) / height),
        shape: "box" as const,
      };
    })
    .filter((region) => region.width > 0.015 && region.height > 0.008)
    .sort((a, b) => a.y - b.y);
}

function estimateRegionFromPlainOcrAndImage(flag: Flag | null, plainLines: PlainOcrLine[], image: HTMLImageElement | null): EvidenceRegion[] {
  if (!flag || !isArithmeticFlag(flag) || plainLines.length === 0 || !image) return [];

  const matchedPlainIndex = bestPlainLineIndexForFlag(flag, plainLines);
  if (matchedPlainIndex === null) return [];

  const imageRows = estimateTextRowRegionsFromImage(image);
  if (imageRows.length === 0) return [];

  // OCR text lines and image pixel rows are both top-to-bottom. We map the matched
  // OCR line index to the equivalent image row. This is not hardcoded to a fixed
  // coordinate; it is derived from the receipt image pixels.
  const rowIndex = Math.round((matchedPlainIndex / Math.max(1, plainLines.length - 1)) * Math.max(0, imageRows.length - 1));
  const candidate = imageRows[Math.min(imageRows.length - 1, Math.max(0, rowIndex))];

  if (!candidate) return [];

  return [{
    ...candidate,
    label: arithmeticFallbackLabel(flag),
    shape: "circle",
    synthetic: true,
  }];
}


function ReceiptFilePreview({
  receipt,
  selectedFlag,
  flags,
  manualRegions,
  onManualRegionChange,
}: {
  receipt: ReceiptRecord;
  selectedFlag: Flag | null;
  flags: Flag[];
  manualRegions: Record<string, EvidenceRegion>;
  onManualRegionChange: (flagId: string, region: EvidenceRegion | null) => void;
}) {
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(100);
  const [autoRegions, setAutoRegions] = useState<Record<string, EvidenceRegion>>({});
  const [detectedRowCount, setDetectedRowCount] = useState(0);
  const [isEditingBox, setIsEditingBox] = useState(false);
  const [editingFlagId, setEditingFlagId] = useState<string | null>(null);
  const [draftRegion, setDraftRegion] = useState<EvidenceRegion | null>(null);
  const [boxComment, setBoxComment] = useState("");
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const triggeredFlags = flags.filter((flag) => flag.status === "triggered");
  const defaultEditFlag = selectedFlag?.status === "triggered" ? selectedFlag : triggeredFlags[0] ?? null;
  const activeEditFlag = flags.find((flag) => flag.id === editingFlagId) ?? defaultEditFlag;

  useEffect(() => {
    setEditingFlagId(defaultEditFlag?.id ?? null);
  }, [defaultEditFlag?.id]);

  useEffect(() => {
    let active = true;
    setFileUrl(null);
    setError("");
    setAutoRegions({});
    setDetectedRowCount(0);

    void (async () => {
      try {
        const response = await fetch(`/api/receipts/${receipt.id}/file`, {
          cache: "no-store",
        });

        const body = (await response.json()) as {
          url?: string;
          error?: string;
        };

        if (!response.ok || !body.url) {
          throw new Error(body.error ?? "Unable to load receipt file.");
        }

        if (active) setFileUrl(body.url);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Unable to load receipt file.");
      }
    })();

    return () => {
      active = false;
    };
  }, [receipt.id]);

  const kind = receipt.fileKind.toUpperCase();
  const imageKind = ["JPEG", "PNG", "JPG"].includes(kind);
  const pdfKind = kind === "PDF";
  const signedOpenUrl = fileUrl;
  const imagePreviewUrl = imageKind ? `/api/receipts/${receipt.id}/file?raw=1` : null;
  const pdfPreviewUrl = fileUrl && pdfKind ? `${fileUrl}#toolbar=0&navpanes=0` : null;

  function refreshAutoBoxes(image: HTMLImageElement) {
    const rows = scanReceiptTextRows(image);
    setDetectedRowCount(rows.length);

    const next: Record<string, EvidenceRegion> = {};
    triggeredFlags.forEach((flag) => {
      if (manualRegions[flag.id]) return;
      if (flagRegions(flag).length > 0) return;

      const picked = pickArithmeticMismatchRow(flag, rows);
      if (picked) next[flag.id] = picked;
    });

    setAutoRegions(next);
  }

  const visibleRegionEntries = triggeredFlags.flatMap((flag) => {
    if (isEditingBox && draftRegion && activeEditFlag?.id === flag.id) {
      return [{ flag, region: draftRegion }];
    }

    const manual = manualRegions[flag.id];
    if (manual) return [{ flag, region: manual }];

    const supplied = flagRegions(flag);
    if (supplied.length > 0) return supplied.map((region) => ({ flag, region }));

    const automatic = autoRegions[flag.id];
    if (automatic) return [{ flag, region: automatic }];

    return [];
  });

  const missingFlags = triggeredFlags.filter((flag) => !visibleRegionEntries.some((entry) => entry.flag.id === flag.id));
  const canEditBox = Boolean(imageKind && activeEditFlag);

  useEffect(() => {
    if (!activeEditFlag) {
      setDraftRegion(null);
      setBoxComment("");
      return;
    }

    const existing = manualRegions[activeEditFlag.id]
      ?? flagRegions(activeEditFlag)[0]
      ?? autoRegions[activeEditFlag.id]
      ?? null;

    setDraftRegion(existing);
    setBoxComment(existing?.label ?? arithmeticFallbackLabel(activeEditFlag));
    setIsEditingBox(false);
    setDrawStart(null);
  }, [activeEditFlag, activeEditFlag?.id, manualRegions, autoRegions]);

  function zoomOut() {
    setZoom((value) => Math.max(50, value - 25));
  }

  function zoomIn() {
    setZoom((value) => Math.min(400, value + 25));
  }

  function resetZoom() {
    setZoom(100);
  }

  function pointerPoint(event: React.PointerEvent<HTMLDivElement>) {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return null;

    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    return { x, y };
  }

  function beginDraw(event: React.PointerEvent<HTMLDivElement>) {
    if (!isEditingBox || !activeEditFlag) return;
    const point = pointerPoint(event);
    if (!point) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    setDrawStart(point);
    setDraftRegion({
      x: point.x,
      y: point.y,
      width: 0.001,
      height: 0.001,
      label: boxComment.trim() || arithmeticFallbackLabel(activeEditFlag),
      shape: "box",
      userEdited: true,
    });
  }

  function updateDraw(event: React.PointerEvent<HTMLDivElement>) {
    if (!isEditingBox || !drawStart || !activeEditFlag) return;
    const point = pointerPoint(event);
    if (!point) return;

    setDraftRegion({
      x: Math.min(drawStart.x, point.x),
      y: Math.min(drawStart.y, point.y),
      width: Math.abs(point.x - drawStart.x),
      height: Math.abs(point.y - drawStart.y),
      label: boxComment.trim() || arithmeticFallbackLabel(activeEditFlag),
      shape: "box",
      userEdited: true,
    });
  }

  function endDraw(event: React.PointerEvent<HTMLDivElement>) {
    if (!isEditingBox) return;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore pointer capture release errors.
    }
    setDrawStart(null);
  }

  function saveManualBox() {
    if (!activeEditFlag || !draftRegion || draftRegion.width < 0.005 || draftRegion.height < 0.005) return;
    onManualRegionChange(activeEditFlag.id, {
      ...draftRegion,
      label: boxComment.trim() || arithmeticFallbackLabel(activeEditFlag),
      shape: "box",
      userEdited: true,
    });
    setIsEditingBox(false);
  }

  function clearManualBox() {
    if (!activeEditFlag) return;
    onManualRegionChange(activeEditFlag.id, null);
  }

  return <section className="evidence-panel">
    <div className="evidence-panel-copy">
      <div>
        <p className="eyebrow">EVIDENCE LOCATION</p>
        <h3>Receipt preview</h3>
        <p>When subtotal plus GST does not match the printed total, the app scans the receipt image rows and draws a box over the detected TOTAL line and its value. You can still correct the box manually.</p>
      </div>

      {triggeredFlags.length > 0 && <div className="bbox-editor-panel">
        <strong>Human bounding-box check</strong>
        <span>{isEditingBox ? "Drag over the selected error, then save." : "The app draws the suspected total mismatch automatically. Use this only if the box needs correction."}</span>

        {triggeredFlags.length > 1 && <label>
          <span>Flag to edit</span>
          <select value={activeEditFlag?.id ?? ""} onChange={(event) => setEditingFlagId(event.target.value)}>
            {triggeredFlags.map((flag) => <option key={flag.id} value={flag.id}>{displayFlagTitle(flag)}</option>)}
          </select>
        </label>}

        <label>
          <span>Box comment</span>
          <textarea
            value={boxComment}
            onChange={(event) => {
              const next = event.target.value;
              setBoxComment(next);
              setDraftRegion((current) => current ? { ...current, label: next.trim() || current.label } : current);
            }}
            placeholder="Example: TOTAL is printed as $999.00, expected $70.85"
            rows={3}
          />
        </label>

        <div>
          <button
            type="button"
            className="text-button dark"
            disabled={!canEditBox}
            onClick={() => {
              setIsEditingBox((value) => {
                const next = !value;
                if (next) {
                  setDraftRegion(null);
                  setDrawStart(null);
                }
                return next;
              });
            }}
          >
            {isEditingBox ? "Cancel drawing" : manualRegions[activeEditFlag?.id ?? ""] ? "Edit box" : "Draw box"}
          </button>
          {isEditingBox && <button type="button" className="primary-button compact bbox-save-button" disabled={!draftRegion || draftRegion.width < 0.005 || draftRegion.height < 0.005} onClick={saveManualBox}>Save box</button>}
          {activeEditFlag && manualRegions[activeEditFlag.id] && <button type="button" className="text-button danger-text" onClick={clearManualBox}>Clear</button>}
        </div>
      </div>}

      <div className="auto-box-status">
        <strong>{visibleRegionEntries.length > 0 ? "Bounding box ready" : "Bounding box pending"}</strong>
        <span>{visibleRegionEntries.length > 0
          ? `${visibleRegionEntries.length} error region${visibleRegionEntries.length === 1 ? "" : "s"} shown. ${detectedRowCount > 0 ? `${detectedRowCount} text rows detected.` : ""}`
          : detectedRowCount > 0
            ? "Text rows were detected, but no matching arithmetic error row was selected. Draw the box manually."
            : "Waiting for the receipt image to load so rows can be detected."}</span>
        {missingFlags.length > 0 && <small>No box yet for: {missingFlags.map((flag) => displayFlagTitle(flag)).join(", ")}.</small>}
      </div>

      {selectedFlag && <div className={`selected-preview-label ${selectedFlag.status}`}><span>{statusLabel[selectedFlag.status]}</span><strong>{displayFlagTitle(selectedFlag)}</strong><small>{visualEvidenceNote(selectedFlag)}</small></div>}
    </div>

    <div className="receipt-preview-area">
      <div className="receipt-preview-shell">
        {(signedOpenUrl || imagePreviewUrl || pdfPreviewUrl) && <div className="preview-floating-actions" aria-label="Receipt zoom controls">
          <button type="button" onClick={zoomOut}>−</button>
          <span>{zoom}%</span>
          <button type="button" onClick={zoomIn}>+</button>
          <button type="button" onClick={resetZoom}>Reset</button>
          {signedOpenUrl && <a href={signedOpenUrl} target="_blank" rel="noreferrer">Open</a>}
        </div>}

        <div className="receipt-preview-scroll">
          {!fileUrl && !error && <div className="receipt-preview-placeholder">Loading receipt preview.</div>}
          {error && <div className="receipt-preview-placeholder">{error}</div>}

          {imagePreviewUrl && imageKind && <div ref={stageRef} className={`receipt-preview-stage ${isEditingBox ? "drawing-active" : ""}`} style={{ width: `${zoom}%` }}>
            <img
              ref={imageRef}
              src={imagePreviewUrl}
              alt={`Preview of ${receipt.fileName}`}
              className="receipt-preview-image"
              onLoad={(event) => refreshAutoBoxes(event.currentTarget)}
            />
            {visibleRegionEntries.length > 0 && <div className="receipt-overlay" aria-hidden="true">
              {visibleRegionEntries.map(({ flag, region }, index) => <div
                key={`${flag.id}-${region.x}-${region.y}-${index}`}
                className={`receipt-box ${flag.status} ${region.shape === "circle" ? "circle" : ""} ${region.synthetic ? "synthetic" : ""} ${region.userEdited ? "user-edited" : ""}` }
                style={{
                  left: `${region.x * 100}%`,
                  top: `${region.y * 100}%`,
                  width: `${region.width * 100}%`,
                  height: `${region.height * 100}%`,
                }}
              >
                <span>{region.label || displayFlagTitle(flag)}</span>
              </div>)}
            </div>}
            {isEditingBox && <div
              className="receipt-draw-layer"
              onPointerDown={beginDraw}
              onPointerMove={updateDraw}
              onPointerUp={endDraw}
              onPointerCancel={endDraw}
              role="application"
              aria-label="Draw corrected bounding box"
            />}
          </div>}

          {pdfPreviewUrl && pdfKind && <iframe
            src={pdfPreviewUrl}
            title={`Preview of ${receipt.fileName}`}
            className="receipt-preview-frame"
            style={{ width: `${zoom}%` }}
          />}

          {fileUrl && !imageKind && !pdfKind && <a className="text-button dark" href={fileUrl} target="_blank" rel="noreferrer">Open receipt file</a>}
        </div>
      </div>
    </div>
  </section>;
}

function ReceiptDetailModal({ receipt, canEdit, onClose, onChange, onDeleted }: {
  receipt: ReceiptRecord;
  canEdit: boolean;
  onClose: () => void;
  onChange: (updated: ReceiptRecord) => void;
  onDeleted: (id: string) => void;
}) {
  const [busy, setBusy] = useState<"authentic" | "rejected" | "delete" | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState("");
  const result: AnalysisResult = receipt.result;
  const flags = [...result.flags].sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);
  const meta = tierMeta[result.tier];
  const [selectedFlagId, setSelectedFlagId] = useState<string | null>(() => flags.find(hasVisualEvidence)?.id ?? flags[0]?.id ?? null);
  const selectedFlag = flags.find((flag) => flag.id === selectedFlagId) ?? flags[0] ?? null;
  const [manualRegions, setManualRegions] = useState<Record<string, EvidenceRegion>>({});

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(`receipt-manual-regions:${receipt.id}`);
      setManualRegions(saved ? JSON.parse(saved) as Record<string, EvidenceRegion> : {});
    } catch {
      setManualRegions({});
    }
  }, [receipt.id]);

  function updateManualRegion(flagId: string, region: EvidenceRegion | null) {
    if (!flagId) return;
    setManualRegions((current) => {
      const next = { ...current };
      if (region) next[flagId] = region;
      else delete next[flagId];
      try { window.localStorage.setItem(`receipt-manual-regions:${receipt.id}`, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) { if (event.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function decide(decision: "authentic" | "rejected") {
    setBusy(decision); setError("");
    try { onChange(await recordDecision(receipt.id, decision)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save the decision."); }
    finally { setBusy(null); }
  }

  async function remove() {
    setBusy("delete"); setError("");
    try { await deleteReceipt(receipt.id); onDeleted(receipt.id); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to delete the receipt."); setBusy(null); }
  }

  return <div className="modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
    <div className="modal-card" onClick={(event) => event.stopPropagation()}>
      <button className="modal-close" aria-label="Close" onClick={onClose}>×</button>

      <div className={`result-banner ${result.tier}`}>
        <div><span className="result-tier-pill">{meta.label}</span><h2>{receipt.fileName}</h2><p>{result.summary}</p></div>
        <ScoreMeter score={result.score} tier={result.tier} />
      </div>

      <div className="receipt-timeframe">
        <div><span>Checked on</span><strong>{formatDateTime(receipt.createdAt)}</strong></div>
        <div><span>Review status</span><strong>{reviewStatusText(receipt)}</strong></div>
      </div>
      <ReceiptFilePreview
        receipt={receipt}
        selectedFlag={selectedFlag}
        flags={flags}
        manualRegions={manualRegions}
        onManualRegionChange={updateManualRegion}
      />
      <ul className="flag-list">{flags.map((flag) => <FlagItem key={flag.id} flag={flag} selected={flag.id === selectedFlag?.id} onSelect={() => setSelectedFlagId(flag.id)} />)}</ul>

      {canEdit ? <div className="modal-decision">
        <div className="modal-decision-head">
          <p className="eyebrow">REVIEW DECISION</p>
          <span className={`decision-pill ${receipt.finalDecision}`}>{decisionLabels[receipt.finalDecision]}</span>
        </div>
        <p className="muted final-check-copy">Re-check the flags, then update or change the decision.</p>
        <div className="decision-buttons">
          <button className="primary-button compact" disabled={busy !== null || receipt.finalDecision === "authentic"} onClick={() => decide("authentic")}>{busy === "authentic" ? "Saving..." : "Mark authentic"}</button>
          <button className="danger-button" disabled={busy !== null || receipt.finalDecision === "rejected"} onClick={() => decide("rejected")}>{busy === "rejected" ? "Saving..." : "Reject"}</button>
        </div>
      </div> : <div className="final-check">
        <div><p className="eyebrow">DECISION</p><p className="muted final-check-copy">Recorded by the member who submitted this receipt.</p></div>
        <span className={`decision-pill ${receipt.finalDecision}`}>{decisionLabels[receipt.finalDecision]}</span>
      </div>}

      {error && <p className="message error" role="alert">{error}</p>}

      {canEdit && <div className="modal-actions">
        {confirmingDelete ? <div className="delete-confirm">
          <span>Delete this receipt permanently?</span>
          <button className="danger-button" disabled={busy !== null} onClick={remove}>{busy === "delete" ? "Deleting..." : "Confirm delete"}</button>
          <button className="text-button dark" disabled={busy !== null} onClick={() => setConfirmingDelete(false)}>Cancel</button>
        </div> : <button className="text-button danger-text" onClick={() => setConfirmingDelete(true)}>Delete receipt</button>}
      </div>}
    </div>
  </div>;
}

function ReceiptHistory({ showMember, canEdit = false, refreshKey = 0, eyebrow, title, emptyText }: { showMember: boolean; canEdit?: boolean; refreshKey?: number; eyebrow: string; title: string; emptyText: string }) {
  const [receipts, setReceipts] = useState<ReceiptRecord[] | null>(null);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setReceipts(null);
    setError("");
    void (async () => {
      try { const data = await getReceipts(); if (active) setReceipts(data); }
      catch (reason) { if (active) setError(reason instanceof Error ? reason.message : "Unable to load receipts."); }
    })();
    return () => { active = false; };
  }, [refreshKey]);

  const selected = receipts?.find((r) => r.id === selectedId) ?? null;

  return <section className="surface wide">
    <div className="history-head"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>{receipts && <span className="step-count">{receipts.length} total</span>}</div>
    {error ? <p className="message error" role="alert">{error}</p>
      : !receipts ? <p className="muted">Loading...</p>
      : receipts.length === 0 ? <div className="empty-state"><span>00</span><p>{emptyText}</p></div>
      : <div className={`history-table ${showMember ? "" : "no-member"}`}>
          <div className="history-row history-header">{showMember && <span>Member</span>}<span>Type</span><span>Risk</span><span className="history-score-col">Score</span><span>Decision</span><span>Checked</span><span>Reviewed</span><span className="history-action-col" /></div>
          {receipts.map((r) => <div className="history-row history-row-static" key={r.id}>
            {showMember && <span className="history-member">{r.uploader?.name ?? "Unknown"}</span>}
            <span>{claimLabels[r.claimType] ?? r.claimType}</span>
            <span><em className={`tier-dot ${r.tier}`} />{tierMeta[r.tier].label}</span>
            <span className="history-score-col">{r.score}</span>
            <span className={`decision-pill ${r.finalDecision}`}>{r.finalDecision}</span>
            <span className="history-date"><span>Checked</span>{formatDateTime(r.createdAt)}</span>
            <span className="history-date"><span>Reviewed</span>{formatHistoryReviewed(r)}</span>
            <button type="button" className="history-review" onClick={() => setSelectedId(r.id)}>Review</button>
          </div>)}
        </div>}
    {selected && <ReceiptDetailModal
      receipt={selected}
      canEdit={canEdit}
      onClose={() => setSelectedId(null)}
      onChange={(updated) => setReceipts((list) => list?.map((r) => r.id === updated.id ? updated : r) ?? list)}
      onDeleted={(id) => { setReceipts((list) => list?.filter((r) => r.id !== id) ?? list); setSelectedId(null); }}
    />}
  </section>;
}

function getLast12Months(): { key: string; label: string }[] {
  const months: { key: string; label: string }[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: new Intl.DateTimeFormat(undefined, { month: "short" }).format(d),
    });
  }
  return months;
}

type UserClaimsSummary = {
  name: string;
  email: string;
  total: number;
  avgScore: number;
  tierCounts: Record<Tier, number>;
  monthlyCounts: number[];
};

function buildUserClaimsSummaries(receipts: ReceiptRecord[], accounts: PublicAccount[], months: { key: string }[]): UserClaimsSummary[] {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 11, 1);
  cutoff.setHours(0, 0, 0, 0);

  const byUser = new Map<string, UserClaimsSummary>();
  for (const account of accounts) {
    byUser.set(account.email, { name: account.name, email: account.email, total: 0, avgScore: 0, tierCounts: { green: 0, amber: 0, red: 0 }, monthlyCounts: months.map(() => 0) });
  }
  for (const r of receipts) {
    const created = new Date(r.createdAt);
    if (created < cutoff) continue;
    const email = r.uploader?.email ?? "unknown";
    const name = r.uploader?.name ?? "Unknown";
    if (!byUser.has(email)) {
      byUser.set(email, { name, email, total: 0, avgScore: 0, tierCounts: { green: 0, amber: 0, red: 0 }, monthlyCounts: months.map(() => 0) });
    }
    const summary = byUser.get(email)!;
    const monthKey = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, "0")}`;
    const monthIndex = months.findIndex((m) => m.key === monthKey);
    if (monthIndex >= 0) summary.monthlyCounts[monthIndex] += 1;
    summary.total += 1;
    summary.tierCounts[r.tier] += 1;
    summary.avgScore += r.score;
  }

  return Array.from(byUser.values())
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    .map((summary) => ({ ...summary, avgScore: summary.total ? Math.round(summary.avgScore / summary.total) : 0 }));
}

function monthKeyOf(dateValue: string) {
  const d = new Date(dateValue);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabelOf(key: string) {
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

function groupReceiptsByKey(receipts: ReceiptRecord[], keyOf: (r: ReceiptRecord) => string): { key: string; receipts: ReceiptRecord[] }[] {
  const groups = new Map<string, ReceiptRecord[]>();
  for (const r of receipts) {
    const key = keyOf(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  return Array.from(groups.entries())
    .map(([key, list]) => ({ key, receipts: list }))
    .sort((a, b) => b.key.localeCompare(a.key));
}

function ReceiptGroupTable({ receipts, onReview }: { receipts: ReceiptRecord[]; onReview: (id: string) => void }) {
  return <div className="history-table no-member">
    <div className="history-row history-header"><span>Type</span><span>Risk</span><span className="history-score-col">Score</span><span>Decision</span><span>Checked</span><span>Reviewed</span><span className="history-action-col" /></div>
    {receipts.map((r) => <div className="history-row history-row-static" key={r.id}>
      <span>{claimLabels[r.claimType] ?? r.claimType}</span>
      <span><em className={`tier-dot ${r.tier}`} />{tierMeta[r.tier].label}</span>
      <span className="history-score-col">{r.score}</span>
      <span className={`decision-pill ${r.finalDecision}`}>{r.finalDecision}</span>
      <span className="history-date"><span>Checked</span>{formatDateTime(r.createdAt)}</span>
      <span className="history-date"><span>Reviewed</span>{formatHistoryReviewed(r)}</span>
      <button type="button" className="history-review" onClick={() => onReview(r.id)}>Review</button>
    </div>)}
  </div>;
}

function MemberReceiptsModal({ name, email, receipts, onClose, onChange, onDeleted }: {
  name: string;
  email: string;
  receipts: ReceiptRecord[];
  onClose: () => void;
  onChange: (updated: ReceiptRecord) => void;
  onDeleted: (id: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"recent" | "history">("recent");
  const selected = receipts.find((r) => r.id === selectedId) ?? null;

  useEffect(() => {
    function onKey(event: KeyboardEvent) { if (event.key === "Escape" && !selectedId) onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, selectedId]);

  const cutoff = useMemo(() => { const d = new Date(); d.setMonth(d.getMonth() - 11, 1); d.setHours(0, 0, 0, 0); return d; }, []);
  const recent = useMemo(() => receipts.filter((r) => new Date(r.createdAt) >= cutoff), [receipts, cutoff]);
  const earlier = useMemo(() => receipts.filter((r) => new Date(r.createdAt) < cutoff), [receipts, cutoff]);
  const monthGroups = useMemo(() => groupReceiptsByKey(recent, (r) => monthKeyOf(r.createdAt)), [recent]);
  const yearGroups = useMemo(() => groupReceiptsByKey(earlier, (r) => String(new Date(r.createdAt).getFullYear())), [earlier]);

  return <div className="modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
    <div className="modal-card" onClick={(event) => event.stopPropagation()}>
      <button className="modal-close" aria-label="Close" onClick={onClose}>×</button>
      <div className="history-head"><div><p className="eyebrow">MEMBER CLAIMS</p><h2>{name}</h2><p className="muted">{email}</p></div><span className="step-count">{receipts.length} total</span></div>

      <div className="member-tabs">
        <button type="button" className={`member-tab ${tab === "recent" ? "active" : ""}`} onClick={() => setTab("recent")}>Past 12 months ({recent.length})</button>
        <button type="button" className={`member-tab ${tab === "history" ? "active" : ""}`} onClick={() => setTab("history")}>Past years ({earlier.length})</button>
      </div>

      {tab === "recent"
        ? (monthGroups.length === 0
          ? <div className="empty-state"><span>00</span><p>No claims in the past 12 months.</p></div>
          : monthGroups.map((group) => <div className="claims-month-group" key={group.key}>
              <h3 className="claims-month-heading">{monthLabelOf(group.key)} <span className="step-count">{group.receipts.length}</span></h3>
              <ReceiptGroupTable receipts={group.receipts} onReview={setSelectedId} />
            </div>))
        : (yearGroups.length === 0
          ? <div className="empty-state"><span>00</span><p>No claims from earlier years.</p></div>
          : yearGroups.map((group) => <div className="claims-month-group" key={group.key}>
              <h3 className="claims-month-heading">{group.key} <span className="step-count">{group.receipts.length}</span></h3>
              <ReceiptGroupTable receipts={group.receipts} onReview={setSelectedId} />
            </div>))}
    </div>
    {selected && <ReceiptDetailModal
      receipt={selected}
      canEdit
      onClose={() => setSelectedId(null)}
      onChange={(updated) => { onChange(updated); }}
      onDeleted={(id) => { onDeleted(id); setSelectedId(null); }}
    />}
  </div>;
}

function UserClaimsDashboard({ accounts }: { accounts: PublicAccount[] }) {
  const [receipts, setReceipts] = useState<ReceiptRecord[] | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedMember, setSelectedMember] = useState<{ name: string; email: string } | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try { const data = await getReceipts(); if (active) setReceipts(data); }
      catch (reason) { if (active) setError(reason instanceof Error ? reason.message : "Unable to load claim data."); }
    })();
    return () => { active = false; };
  }, []);

  const months = useMemo(() => getLast12Months(), []);
  const summaries = useMemo(() => receipts ? buildUserClaimsSummaries(receipts, accounts, months) : [], [receipts, accounts, months]);
  const maxMonthly = Math.max(1, ...summaries.flatMap((s) => s.monthlyCounts));
  const query = search.trim().toLowerCase();
  const visibleSummaries = query
    ? summaries.filter((s) => s.name.toLowerCase().includes(query) || s.email.toLowerCase().includes(query))
    : summaries;
  const activeSummaries = visibleSummaries.filter((s) => s.total > 0);
  const emptySummaries = visibleSummaries.filter((s) => s.total === 0);

  return <section className="surface wide">
    <div className="history-head">
      <div><p className="eyebrow">CLAIM ACTIVITY</p><h2>Past 12 months by member</h2></div>
      {receipts && <span className="step-count">{visibleSummaries.length} of {summaries.length} member{summaries.length === 1 ? "" : "s"}</span>}
    </div>
    {receipts && summaries.length > 0 && <input
      type="search"
      className="claims-search"
      placeholder="Search by name or email"
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      aria-label="Search members by name or email"
    />}
    {error ? <p className="message error" role="alert">{error}</p>
      : !receipts ? <p className="muted">Loading...</p>
      : summaries.length === 0 ? <div className="empty-state"><span>00</span><p>No members yet.</p></div>
      : visibleSummaries.length === 0 ? <div className="empty-state"><span>00</span><p>No members match &ldquo;{search}&rdquo;.</p></div>
      : <>
          {activeSummaries.length > 0 && <div className="claims-dashboard">
            {activeSummaries.map((s) => <button
              type="button"
              className="claims-card claims-card-button"
              key={s.email}
              onClick={() => setSelectedMember({ name: s.name, email: s.email })}
            >
              <div className="claims-card-head">
                <div><strong>{s.name}</strong><span className="claims-card-email">{s.email}</span></div>
                <div className="claims-card-stats">
                  <span className="step-count">{s.total} claim{s.total === 1 ? "" : "s"}</span>
                  <span className="step-count">Avg score {s.avgScore}</span>
                </div>
              </div>
              <div className="claims-tier-row">
                <span><em className="tier-dot green" />{s.tierCounts.green} low</span>
                <span><em className="tier-dot amber" />{s.tierCounts.amber} some</span>
                <span><em className="tier-dot red" />{s.tierCounts.red} high</span>
              </div>
              <div className="claims-bar-chart">
                {s.monthlyCounts.map((count, i) => <div className="claims-bar-col" key={months[i].key}>
                  <div className="claims-bar" style={{ height: count ? `${Math.max(6, (count / maxMonthly) * 64)}px` : "2px" }} title={`${months[i].label}: ${count}`} />
                  <span className="claims-bar-label">{months[i].label}</span>
                </div>)}
              </div>
            </button>)}
            {activeSummaries.length % 2 === 1 && <div className="claims-card claims-card-placeholder" aria-hidden="true" />}
          </div>}

          {emptySummaries.length > 0 && <div className="claims-empty-section">
            <p className="claims-empty-heading">No claims in the past 12 months</p>
            <div className="claims-dashboard">
              {emptySummaries.map((s) => <button
                type="button"
                className="claims-card claims-card-button claims-card-empty"
                key={s.email}
                onClick={() => setSelectedMember({ name: s.name, email: s.email })}
              >
                <div className="claims-card-head">
                  <div><strong>{s.name}</strong><span className="claims-card-email">{s.email}</span></div>
                  <div className="claims-card-stats"><span className="step-count">0 claims</span></div>
                </div>
              </button>)}
              {emptySummaries.length % 2 === 1 && <div className="claims-card claims-card-placeholder" aria-hidden="true" />}
            </div>
          </div>}
        </>}
    {selectedMember && <MemberReceiptsModal
      name={selectedMember.name}
      email={selectedMember.email}
      receipts={(receipts ?? []).filter((r) => r.uploader?.email === selectedMember.email)}
      onClose={() => setSelectedMember(null)}
      onChange={(updated) => setReceipts((list) => list?.map((r) => r.id === updated.id ? updated : r) ?? list)}
      onDeleted={(id) => setReceipts((list) => list?.filter((r) => r.id !== id) ?? list)}
    />}
  </section>;
}

function ProfileTab({ account }: { account: Account }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    if (newPassword.length < 8) return setMessage({ kind: "error", text: "Use at least 8 characters for the new password." });
    if (newPassword !== confirmPassword) return setMessage({ kind: "error", text: "New passwords do not match." });
    setBusy(true);
    try {
      await login(account.email, currentPassword);
      await changePassword(newPassword);
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      setMessage({ kind: "success", text: "Password updated." });
    } catch (reason) {
      setMessage({ kind: "error", text: reason instanceof Error ? reason.message : "Unable to update your password." });
    } finally {
      setBusy(false);
    }
  }

  return <div className="admin-grid">
    <section className="surface">
      <h2>Your details</h2>
      <p>Account information on file with Authentico.</p>
      <div className="member-list">
        <div className="member-row"><span className="avatar">{account.name[0].toUpperCase()}</span><div className="member-details"><strong>{account.name}</strong><span>{account.email}</span><span className="member-role">{account.role}</span></div></div>
      </div>
    </section>
    <section className="surface">
      <h2>Change password</h2>
      <p>Confirm your current password, then choose a new one.</p>
      <form className="member-form" onSubmit={submit}>
        <Field label="Current password" type="password" autoComplete="current-password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Enter your current password" />
        <Field label="New password" type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 8 characters" />
        <Field label="Confirm new password" type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Re-enter the new password" />
        {message && <p className={`message ${message.kind}`}>{message.text}</p>}
        <button className="primary-button compact" disabled={busy}>{busy ? "Updating..." : "Update password"}</button>
      </form>
    </section>
  </div>;
}

function Dashboard({ account, onLogout }: { account: Account; onLogout: () => void }) {
  const [accounts, setAccounts] = useState<PublicAccount[]>([]);
  const [membersError, setMembersError] = useState("");
  const [accountMessage, setAccountMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [memberView, setMemberView] = useState<"overview" | "receipts">("overview");
  const [adminView, setAdminView] = useState<"overview" | "members" | "add">("overview");
  const [showProfile, setShowProfile] = useState(false);
  const isAdmin = account.role === "admin";
  const refresh = useCallback(async () => {
    if (account.role !== "admin") {
      setAccounts([]);
      return;
    }

    try {
      setMembersError("");
      setAccounts(await getAccounts());
    } catch (reason) {
      setMembersError(reason instanceof Error ? reason.message : "Unable to load members.");
    }
  }, [account.role]);
  useEffect(() => { void refresh(); }, [refresh]);
  async function removeAccount(id: string) {
    const target = accounts.find((member) => member.id === id);
    const targetName = target?.name ?? "This user";

    if (!confirm(`Delete ${targetName}? This removes the Authentico profile and login user.`)) return;

    try {
      setMembersError("");
      setAccountMessage(null);
      await deleteAccount(id);
      await refresh();
      setAccountMessage({ kind: "success", text: `User ${targetName} has been deleted.` });
    } catch (reason) {
      setAccountMessage({
        kind: "error",
        text: reason instanceof Error ? reason.message : "Unable to delete account.",
      });
    }
  }

  return <main className="dashboard">
    <header className="topbar"><Logo /><div className="account-menu"><button type="button" className="account-name-button" onClick={() => setShowProfile(true)}><strong>{account.name}</strong><span>{account.role}</span></button><button className="text-button" onClick={onLogout}>Sign out</button></div></header>
    <div className="dashboard-body">
      <aside className="sidebar"><p className="nav-label">WORKSPACE</p>
        {isAdmin ? <>
              <button type="button" className={`nav-item ${!showProfile && adminView === "overview" ? "active" : ""}`} onClick={() => { setShowProfile(false); setAdminView("overview"); }}>Overview</button>
              <button type="button" className={`nav-item ${!showProfile && adminView === "members" ? "active" : ""}`} onClick={() => { setShowProfile(false); setAdminView("members"); }}>Dashboard</button>
              <button type="button" className={`nav-item ${!showProfile && adminView === "add" ? "active" : ""}`} onClick={() => { setShowProfile(false); setAdminView("add"); }}>Add members</button>
            </>
          : <>
              <button type="button" className={`nav-item ${!showProfile && memberView === "overview" ? "active" : ""}`} onClick={() => { setShowProfile(false); setMemberView("overview"); }}>Overview</button>
              <button type="button" className={`nav-item ${!showProfile && memberView === "receipts" ? "active" : ""}`} onClick={() => { setShowProfile(false); setMemberView("receipts"); }}>Submitted receipts</button>
            </>}
        <div className="sidebar-note"><strong>{isAdmin ? "Admin access" : "Member access"}</strong><span>{isAdmin ? "History and account management" : "Receipt checking only"}</span></div></aside>
      <section className="content">
        <div className="page-heading"><div><p className="eyebrow">{showProfile ? "YOUR PROFILE" : account.role.toUpperCase() + " WORKSPACE"}</p><h1>Hello, {account.name}</h1></div></div>
        {showProfile ? <ProfileTab account={account} />
          : isAdmin ? adminView === "overview"
          ? <ReceiptHistory showMember canEdit eyebrow="CHECK HISTORY" title="Receipt checks" emptyText="No receipts have been checked yet." />
          : adminView === "members"
          ? <UserClaimsDashboard accounts={accounts} />
          : <div className="admin-grid">
              <section className="surface"><h2>Add an account</h2><p>Send a private password setup invite to an admin or a member.</p><AddAccount onAdded={refresh} /></section>
              <section className="surface"><h2>Members</h2><p>{accounts.length} account{accounts.length === 1 ? "" : "s"}</p>
                {accountMessage && <p className={`message ${accountMessage.kind}`}>{accountMessage.text}</p>}
                {membersError ? <p className="message error" role="alert">{membersError}</p> : accounts.length ? <div className="member-list">{accounts.map((member) => <div className="member-row" key={member.id}><span className="avatar">{member.name[0].toUpperCase()}</span><div className="member-details"><strong>{member.name}</strong><span>{member.email}</span><span className="member-role">{member.role}</span></div><div className="member-actions"><span className="status member-status">Active</span>{member.id !== account.id && <button type="button" className="delete-member-button" onClick={() => removeAccount(member.id)}>Remove</button>}</div></div>)}</div> : <div className="empty-state"><span>01</span><p>No accounts yet. Add the first account using the form.</p></div>}
              </section>
            </div>
          : memberView === "overview"
          ? <ReceiptUpload />
          : <ReceiptHistory showMember={false} canEdit eyebrow="YOUR RECEIPTS" title="Submitted receipts" emptyText="You haven't submitted any receipts yet." />}
      </section>
    </div>
  </main>;
}

export default function Home() {
  const [ready, setReady] = useState(false); const [hasAccounts, setHasAccounts] = useState(false); const [account, setAccount] = useState<Account | null>(null); const [startupError, setStartupError] = useState("");
  useEffect(() => {
    void (async () => {
      try {
        const [accountsExist, currentAccount] = await Promise.all([hasAnyAccounts(), getCurrentAccount()]);
        setHasAccounts(accountsExist); setAccount(currentAccount);
      } catch {
        setStartupError("Supabase is not configured yet. Add the required environment variables and database migration, then restart the app.");
      } finally { setReady(true); }
    })();
  }, []);
  if (!ready) return <main className="loading">Loading Authentico...</main>;
  if (startupError) return <AuthShell><div className="form-card"><p className="eyebrow">SETUP REQUIRED</p><h2>Connect Supabase</h2><p className="message error">{startupError}</p><p className="muted">See <code>.env.example</code> and <code>supabase/migrations/001_create_profiles.sql</code>.</p></div></AuthShell>;
  if (account) return <Dashboard account={account} onLogout={() => { void logout().then(() => setAccount(null)); }} />;
  if (!hasAccounts) return <SetupForm onCreated={(created) => { setHasAccounts(true); setAccount(created); }} />;
  return <LoginForm onLogin={setAccount} />;
}
