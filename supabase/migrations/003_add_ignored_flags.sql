-- HR can mark individual fraud-check flags as false positives (e.g. an AI image-
-- forensics flag that misfired). The ignored flag ids are stored per receipt so
-- the dismissal survives reloads. Writes go through the service-role client in
-- the receipts PATCH route, gated on the admin role.

alter table public.receipts
  add column if not exists ignored_flags text[] not null default '{}';
