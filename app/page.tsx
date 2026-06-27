"use client";

/* eslint-disable @next/next/no-img-element */

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Account, PublicAccount, changePassword, createAccount, createFirstAdmin, deleteAccount, getAccounts, getCurrentAccount, hasAnyAccounts, login, logout } from "@/lib/auth";
import { ClaimSubmission, FinalDecision, ReceiptRecord, analyzeReceipt, deleteReceipt, getReceipts, recordDecision } from "@/lib/receipts";
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
      <div className="intro-copy"><p className="eyebrow light">CLAIM INTELLIGENCE</p><h1>Employee claims, ready for HR review</h1></div>
      <p className="footnote">Built for human review. HR makes the final call.</p>
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
    <p className="eyebrow">SECURE ACCESS</p><h2>Welcome back</h2><p className="muted">Sign in with your HR admin or employee account.</p>
    <form onSubmit={submit}>
      <Field label="Email address" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
      <Field label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" />
      {error && <p className="message error" role="alert">{error}</p>}
      <button className="primary-button" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button>
    </form>
    <p className="help-text">Need an account? Ask HR to add you.</p>
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
      await createAccount({ name, email: invitedEmail, password, role: "member" });
      setName("");
      setEmail("");
      setPassword("");
      setMessage({
        kind: "success",
        text: `Employee account created. A password reset email has been sent to ${invitedEmail}.`,
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
    <Field label="Email address" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="employee@company.com" />
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

// Canonical names from the README "Fraud checks" table, keyed by flag id. The
// analysis layer varies each flag's `title` by outcome (and the VLM adds
// claim-specific flags); the UI must show only these checks, each under its one
// fixed table name regardless of pass/fail/pending status.
const CANONICAL_FLAG_TITLES: Record<string, string> = {
  "is-receipt": "Submitted file is a receipt",
  duplicate: "Duplicate / near-duplicate submission",
  "exif-editor": "Edited in image software",
  "exif-camera": "Camera metadata present",
  "pdf-producer": "Created with image/design software",
  "pdf-modified": "Modified after creation",
  arithmetic: "Line-item arithmetic",
  "round-numbers": "Suspiciously round amounts",
  "font-consistency": "Font & spacing consistency",
  "physical-alteration": "Scratches & physical alteration",
};

// The authentic-reference flag id is claim-scoped (e.g. "medical-reference").
function canonicalFlagTitle(flag: Flag): string | null {
  if (flag.id in CANONICAL_FLAG_TITLES) return CANONICAL_FLAG_TITLES[flag.id];
  if (flag.id.endsWith("-reference")) return "Authentic reference comparison";
  return null;
}

// A flag is shown only when it maps to a row in the Fraud checks table. This
// hides the claim-specific checks the VLM adds (identifiers, timing, location,
// tax, service-kind, claim-specific arithmetic).
function isCanonicalFlag(flag: Flag): boolean {
  return canonicalFlagTitle(flag) !== null;
}

// Canonical, table-aligned flags in display order, ready to render.
function visibleFlags(flags: Flag[]): Flag[] {
  return flags
    .filter(isCanonicalFlag)
    .sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);
}

function displayFlagTitle(flag: Flag) {
  return canonicalFlagTitle(flag) ?? flag.title;
}

function parseMoneyAmount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[^\d.-]/g, "").trim();
  if (!normalized) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
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
  return {
    label: typeof mismatch.label === "string" ? mismatch.label : "receipt amount comparison",
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
  if (isArithmeticFlag(flag)) return "Printed TOTAL line on the receipt";
  return `${regionCount} highlighted region${regionCount === 1 ? "" : "s"} on receipt`;
}

function visualRegionHint(flag: Flag) {
  if (isArithmeticFlag(flag)) {
    return "Check the highlighted amount evidence supplied by the receipt analysis.";
  }
  return "Click this card to show the boxed evidence on the receipt preview.";
}

function flagCaught(flag: Flag) {
  if (flag.status === "passed") return "Nothing suspicious found for this check.";
  if (flag.status === "pending") return "This check is pending, so it should not be used for the final decision yet.";
  if (isArithmeticFlag(flag)) {
    const summary = arithmeticMismatchSummary(flag);
    if (summary && summary.actualAmount !== null && summary.expectedAmount !== null) {
      return `${formatEvidenceKey(summary.label)}: calculated $${summary.actualAmount.toFixed(2)}, printed $${summary.expectedAmount.toFixed(2)}.`;
    }
    return "The printed TOTAL does not match the amount calculated from the receipt values. Review the extracted values below.";
  }
  const evidence = flag.evidence ? Object.entries(flag.evidence).filter(([, v]) => v !== null && v !== undefined) : [];
  if (evidence.length === 0) return flag.explanation;
  return evidence.map(([key, value]) => `${formatEvidenceKey(key)}: ${evidencePlainText(value)}`).join(" · ");
}

function displayFlagExplanation(flag: Flag) {
  if (!isArithmeticFlag(flag)) return flag.explanation;
  const summary = arithmeticMismatchSummary(flag);
  if (summary && summary.actualAmount !== null && summary.expectedAmount !== null) {
    return `${formatEvidenceKey(summary.label)} calculated $${summary.actualAmount.toFixed(2)}, while the printed value is $${summary.expectedAmount.toFixed(2)}.`;
  }
  return flag.explanation;
}

// Which engine decided a flag. AI-driven checks (the vision forensics, and the
// arithmetic / round-amount checks when the AI receipt model supplied the
// figures) are attributed to the OpenAI model and the explanation above is the
// model's own curated assessment. Every other check is deterministic, so we name
// the specific external library that produced the decision.
function flagDecisionSource(flag: Flag): { ai: boolean; tool: string } {
  if (flag.id === "font-consistency" || flag.id === "physical-alteration") {
    const model = isRecord(flag.evidence) && typeof flag.evidence.model === "string" ? flag.evidence.model : "gpt-4o";
    return { ai: true, tool: `OpenAI vision model (${model})` };
  }
  if (flag.id === "arithmetic" || flag.id === "round-numbers") {
    const engine = isRecord(flag.evidence) ? flag.evidence.decisionEngine : undefined;
    if (engine === "ai-receipt") return { ai: true, tool: "OpenAI receipt model (gpt-5-mini)" };
    if (engine === "pdfjs") return { ai: false, tool: "pdfjs-dist (embedded PDF text layer)" };
    return { ai: false, tool: "tesseract.js (OCR)" };
  }
  if (flag.id === "duplicate") return { ai: false, tool: "SHA-256 content hashing + perceptual image hashing" };
  if (flag.id.endsWith("-reference")) return { ai: false, tool: "content & perceptual hash comparison against the reference bucket" };
  if (flag.id === "exif-editor" || flag.id === "exif-camera") return { ai: false, tool: "exifr (EXIF metadata reader)" };
  if (flag.id === "pdf-producer" || flag.id === "pdf-modified") return { ai: false, tool: "pdf-lib (PDF metadata reader)" };
  if (flag.id === "is-receipt") return { ai: false, tool: "tesseract.js / pdfjs text extraction + sharp document-shape analysis" };
  return { ai: false, tool: "an external tool" };
}

function flagDecisionMessage(flag: Flag): string {
  const { ai, tool } = flagDecisionSource(flag);
  if (flag.status === "pending") {
    return ai
      ? `AI not yet run — awaiting the ${tool}.`
      : `Not yet determined — the external tool (${tool}) could not read enough to decide.`;
  }
  return ai
    ? `AI decision — assessed by the ${tool} (the explanation above is the model's own reasoning).`
    : `No AI used — an external tool was used: ${tool}.`;
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
      <span className={`flag-decision-source ${flagDecisionSource(flag).ai ? "ai" : "external"}`}>{flagDecisionMessage(flag)}</span>
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
  const flags = visibleFlags(result.flags);
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

    <button className="text-button dark" onClick={onReset}>Submit another claim</button>
  </section>;
}

function ReceiptUpload({ onAnalyzed }: { onAnalyzed?: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [receiptType, setReceiptType] = useState<ReceiptType | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<"form" | "analyzing">("form");
  const [submission, setSubmission] = useState<ClaimSubmission | null>(null);

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
    setSubmission(null);
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
      setSubmission(await analyzeReceipt(file, receiptType));
      onAnalyzed?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to submit the claim.");
      setPhase("form");
    }
  }

  if (submission) return <section className="receipt-workflow submission-success">
    <div className="success-mark">✓</div>
    <p className="eyebrow">CLAIM SUBMITTED</p>
    <h2>Thank you! HR will process your claim before rolling out the reimbursement.</h2>
    <div className="submission-details">
      <div><span>Receipt</span><strong>{submission.fileName}</strong></div>
      <div><span>Claim type</span><strong>{claimLabels[submission.claimType]}</strong></div>
      <div><span>Submitted</span><strong>{formatDateTime(submission.createdAt)}</strong></div>
    </div>
    <button className="primary-button compact" onClick={reset}>Submit another claim</button>
  </section>;

  const selectedType = receiptTypes.find((type) => type.id === receiptType);
  const selectedFileKind = file ? fileKind(file) : null;
  const analyzing = phase === "analyzing";

  return <section className="receipt-workflow">
    <div className="workflow-heading">
      <div><p className="eyebrow">NEW REIMBURSEMENT CLAIM</p><h2>Submit your receipt to HR</h2><p>Select the claim category, then attach one receipt file for HR review.</p></div>
      <span className="step-count">2 steps</span>
    </div>

    <form onSubmit={submit}>
      <fieldset className="receipt-type-fieldset" disabled={analyzing}>
        <legend><span>01</span> Choose a claim type</legend>
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
      <button className="primary-button receipt-submit" disabled={!receiptType || !file || analyzing}>{analyzing ? "Submitting..." : "Submit claim"}</button>
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
};

type FlagWithRegionEvidence = Flag & {
  evidence?: Flag["evidence"] & {
    regions?: unknown;
    region?: unknown;
    boxes?: unknown;
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
  if (!isRecord(value)) return null;

  const rawX = readNumber(value.x ?? value.left);
  const rawY = readNumber(value.y ?? value.top);
  const rawWidth = readNumber(value.width ?? value.w);
  const rawHeight = readNumber(value.height ?? value.h);

  if (rawX === null || rawY === null || rawWidth === null || rawHeight === null) return null;

  const x = normalizeCoordinate(rawX);
  const y = normalizeCoordinate(rawY);
  const width = normalizeCoordinate(rawWidth);
  const height = normalizeCoordinate(rawHeight);

  if (x < 0 || y < 0 || width <= 0 || height <= 0) return null;
  if (x > 1 || y > 1 || width > 1 || height > 1) return null;

  const label = typeof value.label === "string" ? value.label : undefined;
  const rawShape = typeof value.shape === "string" ? value.shape : undefined;
  const shape = rawShape === "circle" ? "circle" : "box";
  return { x, y, width, height, label, shape };
}

function fallbackRegions(flag: Flag | null): EvidenceRegion[] {
  void flag;
  return [];
}

function flagRegions(flag: Flag | null): EvidenceRegion[] {
  if (!flag) return [];
  const evidence = (flag as FlagWithRegionEvidence).evidence;
  if (!evidence) return fallbackRegions(flag);

  const rawRegions = Array.isArray(evidence.regions)
    ? evidence.regions
    : Array.isArray(evidence.boxes)
      ? evidence.boxes
      : evidence.region
        ? [evidence.region]
        : [];

  const parsed = rawRegions
    .map(parseRegion)
    .filter((region): region is EvidenceRegion => Boolean(region));

  return parsed.length > 0 ? parsed : fallbackRegions(flag);
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
    const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
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
      return <div className="evidence-mismatch-card">
        <strong>{String(label)}</strong>
        <dl>
          {actual !== undefined && <div><dt>Calculated / extracted</dt><dd>{formatMoneyLikeValue(actual)}</dd></div>}
          {expected !== undefined && <div><dt>Printed / expected</dt><dd>{formatMoneyLikeValue(expected)}</dd></div>}
        </dl>
        <small>These values come from the current OCR/extraction result. If they look wrong, the backend extraction needs to be corrected or supplied with exact OCR boxes.</small>
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
  if (Array.isArray(value)) return value.map((item) => evidencePlainText(item)).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  if (value === null || value === undefined) return [] as string[];
  return [evidencePlainText(value)].filter(Boolean);
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
        <strong>{formatEvidenceKey(summary.label)}: calculated ${summary.actualAmount.toFixed(2)}</strong>
        <strong>Printed value: ${summary.expectedAmount.toFixed(2)}</strong>
        <p>Difference: ${Math.abs(delta ?? 0).toFixed(2)}</p>
        <small>These values come from the current extraction result and should be reviewed against the receipt.</small>
      </> : <>
        <strong>Total value does not reconcile.</strong>
        <small>Review the relevant printed amount values on the receipt.</small>
      </>}
    </div>
  </div>;
}

function visualEvidenceNote(flag: Flag | null) {
  if (!flag) return "Select a check below to see its evidence here.";
  if (flagRegions(flag).length > 0) return isArithmeticFlag(flag) ? "The preview highlight is anchored to the printed TOTAL line." : "Highlighted evidence for the selected check.";
  if (flag.id.includes("exif") || flag.id.includes("pdf") || flag.id === "duplicate") {
    return "File-level or metadata evidence. Read the selected flag details below.";
  }
  if (flag.status === "pending") return "Selected check pending. Read the selected flag details below.";
  return "Selected check. Read the selected flag details below.";
}

function ReceiptFilePreview({ receipt, selectedFlag }: { receipt: ReceiptRecord; selectedFlag: Flag | null }) {
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(100);
  const regions = flagRegions(selectedFlag);

  useEffect(() => {
    let active = true;
    setFileUrl(null);
    setError("");

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
        if (active) {
          setError(reason instanceof Error ? reason.message : "Unable to load receipt file.");
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [receipt.id]);

  const kind = receipt.fileKind.toUpperCase();
  const imageKind = ["JPEG", "PNG", "JPG"].includes(kind);
  const pdfKind = kind === "PDF";
  const previewUrl = fileUrl && pdfKind ? `${fileUrl}#toolbar=0&navpanes=0` : fileUrl;

  function zoomOut() {
    setZoom((value) => Math.max(50, value - 25));
  }

  function zoomIn() {
    setZoom((value) => Math.min(400, value + 25));
  }

  function resetZoom() {
    setZoom(100);
  }

  return <section className="evidence-panel">
    <div className="evidence-panel-copy">
      <div>
        <p className="eyebrow">EVIDENCE LOCATION</p>
        <h3>Receipt preview</h3>
        <p>Use the receipt preview to inspect the original upload. If a selected check has visual coordinates, a box will appear on the receipt. Otherwise, the preview stays clean with only the zoom controls.</p>
      </div>

      {selectedFlag && <div className={`selected-preview-label ${selectedFlag.status}`}>
        <span>{statusLabel[selectedFlag.status]}</span>
        <strong>{displayFlagTitle(selectedFlag)}</strong>
        <small>{visualEvidenceNote(selectedFlag)}</small>
      </div>}
    </div>

    <div className="receipt-preview-area">
      <div className="receipt-preview-shell">
        {fileUrl && (imageKind || pdfKind) && <div className="preview-floating-actions" aria-label="Receipt zoom controls">
          <button type="button" onClick={zoomOut}>−</button>
          <span>{zoom}%</span>
          <button type="button" onClick={zoomIn}>+</button>
          <button type="button" onClick={resetZoom}>Reset</button>
          <a href={fileUrl} target="_blank" rel="noreferrer">Open</a>
        </div>}

        <div className="receipt-preview-scroll">
          {!fileUrl && !error && <div className="receipt-preview-placeholder">Loading receipt preview.</div>}
          {error && <div className="receipt-preview-placeholder">{error}</div>}

          {previewUrl && imageKind && <div className="receipt-preview-stage" style={{ width: `${zoom}%` }}>
            <img src={previewUrl} alt={`Preview of ${receipt.fileName}`} className="receipt-preview-image" />
            {regions.length > 0 && <div className="receipt-overlay" aria-hidden="true">
              {regions.map((region, index) => <div
                key={`${region.x}-${region.y}-${index}`}
                className={`receipt-box ${selectedFlag?.status ?? "pending"} ${region.shape === "circle" ? "circle" : ""} ${region.synthetic ? "synthetic" : ""}` }
                style={{
                  left: `${region.x * 100}%`,
                  top: `${region.y * 100}%`,
                  width: `${region.width * 100}%`,
                  height: `${region.height * 100}%`,
                }}
              >
                {region.label && <span>{region.label}</span>}
              </div>)}
            </div>}
          </div>}

          {previewUrl && pdfKind && <iframe
            src={previewUrl}
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
  const flags = visibleFlags(result.flags);
  const meta = tierMeta[result.tier];
  const [selectedFlagId, setSelectedFlagId] = useState<string | null>(() => flags.find(hasVisualEvidence)?.id ?? flags[0]?.id ?? null);
  const selectedFlag = flags.find((flag) => flag.id === selectedFlagId) ?? flags[0] ?? null;

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
      <ReceiptFilePreview receipt={receipt} selectedFlag={selectedFlag} />
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
        <div><p className="eyebrow">DECISION</p><p className="muted final-check-copy">Recorded by HR after reviewing this claim.</p></div>
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
              <button type="button" className={`nav-item ${!showProfile && adminView === "overview" ? "active" : ""}`} onClick={() => { setShowProfile(false); setAdminView("overview"); }}>Claims review</button>
              <button type="button" className={`nav-item ${!showProfile && adminView === "members" ? "active" : ""}`} onClick={() => { setShowProfile(false); setAdminView("members"); }}>Claim activity</button>
              <button type="button" className={`nav-item ${!showProfile && adminView === "add" ? "active" : ""}`} onClick={() => { setShowProfile(false); setAdminView("add"); }}>Employees</button>
            </>
          : <>
              <button type="button" className={`nav-item ${!showProfile ? "active" : ""}`} onClick={() => setShowProfile(false)}>Submit claim</button>
            </>}
        <div className="sidebar-note"><strong>{isAdmin ? "HR access" : "Employee access"}</strong><span>{isAdmin ? "Review claims and manage employees" : "Submit receipts for reimbursement"}</span></div></aside>
      <section className="content">
        <div className="page-heading"><div><p className="eyebrow">{showProfile ? "YOUR PROFILE" : isAdmin ? "HR WORKSPACE" : "EMPLOYEE WORKSPACE"}</p><h1>Hello, {account.name}</h1></div></div>
        {showProfile ? <ProfileTab account={account} />
          : isAdmin ? adminView === "overview"
          ? <ReceiptHistory showMember canEdit eyebrow="HR REVIEW QUEUE" title="Employee reimbursement claims" emptyText="No employee claims have been submitted yet." />
          : adminView === "members"
          ? <UserClaimsDashboard accounts={accounts} />
          : <div className="admin-grid">
              <section className="surface"><h2>Add an employee</h2><p>Send a private password setup invite to an employee who needs to submit claims.</p><AddAccount onAdded={refresh} /></section>
              <section className="surface"><h2>Employees</h2><p>{accounts.length} account{accounts.length === 1 ? "" : "s"}</p>
                {accountMessage && <p className={`message ${accountMessage.kind}`}>{accountMessage.text}</p>}
                {membersError ? <p className="message error" role="alert">{membersError}</p> : accounts.length ? <div className="member-list">{accounts.map((member) => <div className="member-row" key={member.id}><span className="avatar">{member.name[0].toUpperCase()}</span><div className="member-details"><strong>{member.name}</strong><span>{member.email}</span><span className="member-role">{member.role}</span></div><div className="member-actions"><span className="status member-status">Active</span>{member.id !== account.id && <button type="button" className="delete-member-button" onClick={() => removeAccount(member.id)}>Remove</button>}</div></div>)}</div> : <div className="empty-state"><span>01</span><p>No accounts yet. Add the first account using the form.</p></div>}
              </section>
            </div>
          : <ReceiptUpload />}
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
