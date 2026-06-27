-- Receipt checks. One row per uploaded receipt/invoice and its analysis result.
-- Writes are performed by the service-role client in the API routes (mirroring
-- the members route), so authenticated users get SELECT only via RLS.

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid not null references public.profiles(id) on delete cascade,
  claim_type text not null check (claim_type in ('medical', 'purchase', 'grab')),
  file_name text not null,
  file_path text not null,
  file_kind text not null,
  content_hash text not null,
  perceptual_hash text,
  score int not null check (score between 0 and 100),
  tier text not null check (tier in ('green', 'amber', 'red')),
  result jsonb not null,
  final_decision text not null default 'pending' check (final_decision in ('pending', 'authentic', 'rejected')),
  status text not null default 'complete' check (status in ('analyzing', 'complete', 'error')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists receipts_uploaded_by_idx on public.receipts (uploaded_by);
create index if not exists receipts_content_hash_idx on public.receipts (content_hash);
create index if not exists receipts_created_at_idx on public.receipts (created_at desc);

alter table public.receipts enable row level security;

revoke all on table public.receipts from anon;
revoke insert, update, delete on table public.receipts from authenticated;
grant select on table public.receipts to authenticated;

drop policy if exists "Members can read their own receipts" on public.receipts;
create policy "Members can read their own receipts"
  on public.receipts for select
  to authenticated
  using ((select auth.uid()) = uploaded_by);

drop policy if exists "Admins can read all receipts" on public.receipts;
create policy "Admins can read all receipts"
  on public.receipts for select
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Private storage bucket for the uploaded files. Access is mediated by the
-- service-role client in the API layer; no public read.
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;
