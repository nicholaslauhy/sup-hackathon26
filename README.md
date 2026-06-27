# Authentico

Authentico is a receipt and invoice fraud-triage application for finance and claims teams. This repository currently includes shared admin/member authentication powered by Supabase.

## Fraud checks

When a receipt is submitted, Authentico runs the following checks and combines the triggered flags into a risk score (green / amber / red). The image-forensics checks (font/spacing and physical alteration) run through an OpenAI vision model on every supported file kind — JPEG/PNG and PDF (sent as a file input so the model reads the rendered pages), and HEIC after a sharp decode. When no `OPENAI_API_KEY` is configured, or the vision call fails, they are surfaced to the reviewer as **Pending** and do not affect the score. Checks marked **Planned** are on the roadmap (external-verification layers) and are not yet implemented.

| Check | Applies to | Severity | Status | What it looks for |
| --- | --- | --- | --- | --- |
| Submitted file is a receipt | All files | Medium | Active | A file with none of the monetary amounts or receipt terms of a real receipt — and, for images, no paper-like document shape — suggesting a wrong or unrelated file. |
| Duplicate / near-duplicate submission | All files | High | Active | An identical (content hash) or lightly altered (perceptual hash) file submitted before. |
| Edited in image software | JPEG / PNG | High | Active | EXIF metadata naming an editor (Photoshop, GIMP, Canva, etc.). |
| Camera metadata present | JPEG / PNG | Medium | Active | Missing camera make/model and capture timestamp, typical of screenshots, exports, or AI-generated images. |
| Created with image/design software | PDF | High | Active | PDF producer/creator naming editing software unusual for a genuine merchant invoice. |
| Modified after creation | PDF | Medium | Active | PDF modification date later than its creation date. |
| Line-item arithmetic | All files | High | Active | Line items, subtotal, tax and total not adding up. |
| Suspiciously round amounts | All files | Low | Active | Unusually round figures. |
| Font & spacing consistency | JPEG / PNG / PDF / HEIC | Medium | Active (AI) | A value-bearing field (amount, date, total) rendered in a font, weight, size or baseline inconsistent with the surrounding print, typical of a digitally edited region. Runs via the OpenAI vision pass; pending only when no key is configured or the call fails. |
| Scratches & physical alteration | JPEG / PNG / PDF / HEIC | High | Active (AI) | Visible scratch-outs, correction fluid/tape, erasures, smudges, or overwriting that conceal or replace original values (amount, date, merchant). Runs via the OpenAI vision pass; pending only when no key is configured or the call fails. |
| Authentic reference comparison | Selected claim type | Info | Active | Exact or visually close matches against the private authentic-example folder. No-match results never increase risk while the sample set is small. |

### Claim-specific checks

The common OCR, arithmetic, receipt-document, metadata, duplicate, and image-forensics checks always run. Structured extraction then adds rules for the selected claim type:

| Claim type | Additional checks |
| --- | --- |
| Medical | Clinic, visit date, receipt number and registration details; treatment arithmetic; contextual weekend/after-hours timing. |
| Purchase | Merchant, date and receipt number; quantity/unit-price arithmetic; discounts, subtotal, tax and total consistency. |
| Grab | Service-aware transport, GrabFood/delivery, and parcel checks; booking/order identifiers; route or delivery details; event timing; complete signed charge-row arithmetic. |

The private reference bucket supplies supporting evidence only; it is not training and an unmatched receipt is not considered suspicious. For Grab arithmetic, a mismatch is scored only when structured extraction confirms every visible charge and discount row was captured. Partial extraction remains pending.

> HEIC files currently run only exact-duplicate detection; HEIC metadata extraction is not yet supported.

## Account roles

- There can be only one admin.
- The admin can create member accounts and will eventually be able to view receipt-check history.
- Members can sign in and will eventually be able to submit receipts for checking.
- Members cannot create other members or view the full check history.
- The admin cannot submit receipts for checking.

## Requirements

- Node.js 20 or newer
- npm
- Access to the team's Supabase project

## Supabase database setup

Only one developer needs to initialize a new Supabase project:

1. Create a project at `https://supabase.com/dashboard`.
2. Open **SQL Editor** in that project.
3. Run the complete contents of `supabase/migrations/001_create_profiles.sql`.
4. Run the complete contents of `supabase/migrations/002_create_receipts.sql`.
5. Confirm that `public.profiles` and `public.receipts` appear in **Table Editor**.

`001` creates the profile table, enables Row Level Security, and enforces the single-admin rule in the database. `002` creates the `receipts` table and a private `receipts` storage bucket for uploaded files, with RLS that lets members read only their own checks and the admin read all.

## Local environment setup

Install the project dependencies:

```bash
npm install
```

Create a private environment file from the committed template:

```bash
cp .env.example .env.local
```

Fill `.env.local` with values from the shared Supabase project:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
NEXT_PUBLIC_APP_URL=http://localhost:3000
OPENAI_API_KEY=sk-...
OPENAI_VISION_MODEL=gpt-4o
OPENAI_RECEIPT_MODEL=gpt-5-mini
CLAIM_REFERENCE_BUCKET=claim types
```

Developers connecting to the same shared database use the same Supabase URL and publishable key. Trusted backend developers also need an authorized secret key.

Find these values in the Supabase dashboard under **Project Settings → API Keys** or through the project's **Connect** dialog.

## Secret handling

- Never commit `.env.local`.
- Never place `SUPABASE_SECRET_KEY` in frontend code.
- Never post the secret key in screenshots, GitHub issues, chat, or documentation.
- Share secrets through a password manager or another encrypted secret-sharing tool.
- Prefer granting trusted developers access to the Supabase project instead of broadly sharing one secret key.
- Regular users of the deployed application need only their Authentico email and password; they do not need Supabase keys.

The repository intentionally commits `.env.example` but ignores `.env.local` through `.gitignore`.

## Authentic reference bucket

Create a private Supabase Storage bucket named `claim types` with:

```text
medical authentic/
purchase authentic/
grab authentic/
```

The server reads only the folder matching the selected claim type. Local authentic examples belong under the Git-ignored `claim_types/` directory, not in the repository.

## Run locally

Start the Next.js development server:

```bash
npm run dev
```

Open `http://localhost:3000`.

With an empty database, Authentico displays the one-time admin setup page. After creating the admin, use the admin dashboard to create member accounts.

## Team workflow

After cloning the repository, each developer should:

1. Run `npm install`.
2. Create their own `.env.local` from `.env.example`.
3. Obtain authorized environment values for the shared Supabase project.
4. Run `npm run dev`.

All developers configured for the same Supabase project will see the same accounts and roles. Browser-local accounts from the earlier prototype are not migrated and must be recreated.

## Deployment

For a hosted deployment, add the same three environment variables to the hosting provider, such as Vercel. Do not upload `.env.local` or commit production secrets to GitHub.

### Document extraction and OCR

The line-item and amount checks read figures off each receipt with two libraries: `pdfjs-dist` for the embedded text layer of digital PDFs, and `tesseract.js` for OCR of image receipts (JPEG/PNG) and any PDF without a usable text layer. Both are listed under `serverExternalPackages` in `next.config.mjs` so Next does not bundle their worker/runtime files into `.next/` — without this, OCR fails at runtime with `Cannot find module .next/worker-script/node/index.js`.

`tesseract.js` runs OCR in a Node worker and downloads its `eng.traineddata` language file to the working directory at runtime (git-ignored). On a serverless host such as Vercel the filesystem is read-only apart from `/tmp`, so point tesseract's `cachePath`/`langPath` at a writable location or bundle the traineddata with the deployment. PDFs that carry an embedded text layer never invoke OCR and are unaffected.

Additional Supabase details are available in `SUPABASE_SETUP.md`.

## Testing

The `samples/` folder includes prepared receipts for exercising the analysis flow. Sign in as a member to upload them.

### Ready-made flagged samples

These files are crafted so every **deterministic** check triggers. Each trips two metadata flags on its own; upload the same file a second time to also trigger the duplicate check.

| File | Flags triggered on upload |
| --- | --- |
| `samples/flagged-receipt.jpg` | Edited in image software (EXIF `Software` names Photoshop) + missing camera metadata |
| `samples/flagged-receipt.pdf` | Created with image/design software (PDF producer/creator names GIMP/Photoshop) + modified after creation |

The line-item arithmetic and round-amount checks now run on every readable receipt via the text-extraction layer. On these crafted samples the printed figures are internally consistent, so both checks **pass** (their math adds up) rather than triggering - the red tier comes from the metadata and duplicate flags. With `OPENAI_API_KEY` set, the font/spacing and physical-alteration checks also run through the vision pass on these JPEGs and **pass** (no tampering on the crafted samples); without a key they stay **pending**.

### What to expect

1. Upload `flagged-receipt.jpg` (or `.pdf`). The result should be a **red** risk tier with the two metadata flags triggered; the arithmetic and round-amount checks pass (the sample's figures add up) and font/spacing shows as planned.
2. Upload the **same file again**. The duplicate check now triggers as well, because an identical file already exists in the database.
3. Upload a clean phone photo of a real receipt for the opposite case: it should pass the metadata checks and land **green**.

### AI-check trigger samples

These samples isolate the text-based checks: their metadata and dates are clean, so neither the metadata nor duplicate flags fire and you see only the line-item arithmetic or round-amount flag. Each is read through the text-extraction layer — embedded PDF text, or OCR for the image.

| File | Read via | Flag triggered | Why |
| --- | --- | --- | --- |
| `samples/test-math-mismatch.pdf` | PDF text layer | Line-item arithmetic | Subtotal 65.00 + GST 5.85 = 70.85, but the printed total is 999.00 |
| `samples/test-math-mismatch.jpg` | OCR | Line-item arithmetic | Same figures as an image, exercising the OCR path |
| `samples/test-round-amount.pdf` | PDF text layer | Suspiciously round amounts | 137.61 + 12.39 = 150.00 (math is consistent, but the total is a round figure) |
| `samples/test-not-a-receipt.jpg` | Shape + OCR | Submitted file is a receipt | A non-document image (no paper-like field, no amounts or receipt terms) — flagged as likely the wrong file. |

Arithmetic is high severity, so `test-math-mismatch.*` raises the risk tier on its own; round amounts is low severity and is surfaced without dominating the score. The "submitted file is a receipt" gate runs before the others: it reads the extracted text for monetary amounts and receipt terms and, for images, a lightweight `sharp`-based paper-vs-photo shape signal — no AI is involved.

### Regenerating the samples

The flagged samples are generated with `sharp` and `pdf-lib` (already project dependencies); no external tools are required. To recreate them, set the EXIF `Software` tag to an editor name on an image, and set a PDF's producer/creator to an editor name with its modification date later than its creation date. See the check definitions in `lib/analysis/metadata.ts` for the exact strings each flag matches.
