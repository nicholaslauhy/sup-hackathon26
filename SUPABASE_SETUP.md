# Supabase setup

Authentico uses one Supabase project for shared authentication and account roles.

## 1. Create the project

Create a Supabase project at `https://supabase.com/dashboard`. Keep its database password private.

## 2. Create the profiles table

In the Supabase dashboard, open **SQL Editor**, create a new query, and run the complete contents of:

```text
supabase/migrations/001_create_profiles.sql
```

The migration creates the `profiles` table, enforces one admin at the database level, enables Row Level Security, and prevents browser clients from modifying roles.

## 2b. Create the receipts table and storage bucket

Run the complete contents of:

```text
supabase/migrations/002_create_receipts.sql
```

This creates the `receipts` table (one row per checked receipt and its analysis result), enables Row Level Security so members see only their own checks while the admin sees all, and creates a private `receipts` storage bucket for the uploaded files. Uploaded files are written by the server using the secret key; the bucket is not publicly readable.

## 2c. Add the ignored-flags column

Run the complete contents of:

```text
supabase/migrations/003_add_ignored_flags.sql
```

This adds the `ignored_flags` column so HR can mark individual fraud-check flags as false positives. It is additive (existing rows default to an empty array). Skipping it makes `GET /api/receipts` return 500 for the admin, because the receipts query selects this column.

## 3. Configure environment variables

Copy `.env.example` to `.env.local` and fill in the three values from the Supabase project's API settings:

```bash
cp .env.example .env.local
```

- `NEXT_PUBLIC_SUPABASE_URL`: the project URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: the publishable key
- `SUPABASE_SECRET_KEY`: the server-only secret key
- `OPENAI_API_KEY`: optional server-only key for structured receipt extraction
- `OPENAI_RECEIPT_MODEL`: optional extraction model override (defaults to `gpt-5-mini`)
- `CLAIM_REFERENCE_BUCKET`: private authentic-example bucket (defaults to `claim types`)

Never commit `.env.local` or expose `SUPABASE_SECRET_KEY` in browser code. It grants administrative access to Auth.

For authentic reference comparison, create a private Storage bucket named `claim types` with `medical authentic`, `purchase authentic`, and `grab authentic` folders. A small or empty folder is supported; unmatched submissions are not penalized.

## 4. Start Authentico

```bash
npm run dev
```

Open `http://localhost:3000`. With an empty Supabase project, the app displays the one-time admin setup screen. The admin can then create member accounts.

## 5. Deploy

Add the same three environment variables to the hosting provider, then redeploy. Every device using that deployment will authenticate against the same Supabase project.

Do not share `.env.local` through GitHub. Teammates who run the app locally should create their own `.env.local`, while the deployed app should receive secrets through the host's environment-variable settings.

## Existing prototype accounts

Accounts previously created in browser local storage are not migrated. Create them again after connecting Supabase. Their old SHA-256 hashes cannot be converted back into passwords or imported safely into Supabase Auth.
