-- Apply manually after review to the existing ICB-v3 Supabase project.
-- These tables are server-only, not accessible to anon/authenticated clients.
create table if not exists public.icb_bot_messages (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('whatsapp','facebook','instagram')),
  account_id text not null,
  contact_id text not null,
  external_message_id text,
  direction text not null check (direction in ('inbound','outbound')),
  body text not null,
  status text not null check (status in ('queued','processing','done','draft','ready','sending','sent','failed','ignored')),
  reply_to uuid references public.icb_bot_messages(id) on delete set null,
  attempts integer not null default 0,
  claimed_at timestamptz,
  error text,
  model text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint inbound_requires_external_id check (direction <> 'inbound' or external_message_id is not null),
  constraint bot_message_unique_external unique (platform, account_id, external_message_id),
  constraint bot_message_unique_reply unique (reply_to)
);
create index if not exists icb_bot_messages_work_idx on public.icb_bot_messages (status, created_at) where direction = 'inbound';
create index if not exists icb_bot_messages_history_idx on public.icb_bot_messages (platform, account_id, contact_id, created_at desc);

create table if not exists public.icb_bot_profiles (
  platform text not null check (platform in ('whatsapp','facebook','instagram')),
  account_id text not null,
  contact_id text not null,
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (platform, account_id, contact_id)
);

alter table public.icb_bot_messages enable row level security;
alter table public.icb_bot_profiles enable row level security;
revoke all on public.icb_bot_messages from public, anon, authenticated;
revoke all on public.icb_bot_profiles from public, anon, authenticated;
-- service_role is the only application identity to access these tables.
grant select, insert, update, delete on public.icb_bot_messages to service_role;
grant select, insert, update, delete on public.icb_bot_profiles to service_role;
-- No permissive policies: RLS denies anon/authenticated access.
