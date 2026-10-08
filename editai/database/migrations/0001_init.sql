-- =====================================================================
-- EDITAI — schema inicial (Supabase / PostgreSQL)
-- Aplicar com: supabase db push   (ou colar no SQL Editor)
--
-- Princípios:
--  * RLS habilitado em TODAS as tabelas: o usuário só lê o que é dele.
--  * Escritas sensíveis (créditos, renders, versões, fila) só via service_role
--    (rotas de API no servidor e worker), nunca direto do browser.
--  * Colunas *_url guardam a CHAVE no storage privado; URLs assinadas e
--    temporárias são geradas sob demanda.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- helpers
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------- users
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger users_updated_at before update on public.users
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- subscriptions
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users (id) on delete cascade,
  plan_id text not null default 'free' check (plan_id in ('free', 'starter', 'creator', 'pro')),
  status text not null default 'active' check (status in ('active', 'trialing', 'past_due', 'canceled', 'incomplete')),
  provider text not null default 'none',
  provider_customer_id text,
  provider_subscription_id text,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- credits
create table public.credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users (id) on delete cascade,
  balance integer not null default 0 check (balance >= 0), -- nunca negativo
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger credits_updated_at before update on public.credits
  for each row execute function public.set_updated_at();

create table public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  amount integer not null check (amount <> 0),
  balance_after integer not null check (balance_after >= 0),
  reason text not null check (reason in ('signup_bonus', 'render', 'export', 'refund', 'purchase', 'subscription_grant', 'adjustment')),
  reference_id uuid,
  description text,
  created_at timestamptz not null default now()
);
create index credit_transactions_user_idx on public.credit_transactions (user_id, created_at desc);
-- Idempotência: um mesmo render não é cobrado nem reembolsado duas vezes.
create unique index credit_transactions_ref_reason_idx
  on public.credit_transactions (reference_id, reason) where reference_id is not null;

-- ---------------------------------------------------------------- projects
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  status text not null default 'draft'
    check (status in ('draft', 'uploading', 'analyzing', 'ready', 'processing', 'failed', 'archived')),
  original_video_url text,
  original_file_name text,
  thumbnail_url text,
  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_user_idx on public.projects (user_id, updated_at desc);
create trigger projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- media assets
create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  kind text not null check (kind in ('original_video', 'audio_command', 'version_video', 'export', 'thumbnail', 'music', 'image')),
  storage_path text not null unique,
  file_name text,
  mime_type text,
  size_bytes bigint,
  duration_seconds numeric(10, 3),
  metadata jsonb not null default '{}'::jsonb,
  expires_at timestamptz, -- arquivos temporários (ex.: áudios de comando) expiram
  created_at timestamptz not null default now()
);
create index media_assets_user_idx on public.media_assets (user_id, kind, created_at desc);
create index media_assets_expires_idx on public.media_assets (expires_at) where expires_at is not null;

-- ---------------------------------------------------------------- video metadata
create table public.video_metadata (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  analysis_status text not null default 'pending' check (analysis_status in ('pending', 'processing', 'completed', 'failed')),
  analysis_error text,
  -- Campos principais desnormalizados para consulta/listagem.
  duration numeric(10, 3),
  width integer,
  height integer,
  fps numeric(6, 2),
  has_audio boolean,
  -- Estrutura completa (VideoMetadata em types/video.ts): silêncios, fala, transcrição...
  metadata jsonb,
  analyzed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger video_metadata_updated_at before update on public.video_metadata
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- editing commands
create table public.editing_commands (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  audio_url text,
  audio_duration numeric(8, 2),
  transcription text,
  transcription_source text not null default 'text' check (transcription_source in ('stt', 'browser', 'text')),
  instruction_text text not null check (char_length(instruction_text) between 1 and 2000),
  editing_plan jsonb not null default '{"version":1,"operations":[]}'::jsonb,
  assistant_reply text not null default '',
  rejected_operations jsonb not null default '[]'::jsonb,
  planner_provider text not null default 'rules',
  status text not null default 'planned' check (status in ('planned', 'confirmed', 'rendered', 'failed', 'discarded')),
  base_version_id uuid,
  result_version_id uuid,
  estimated_credits integer not null default 0,
  created_at timestamptz not null default now()
);
create index editing_commands_project_idx on public.editing_commands (project_id, created_at);

-- ---------------------------------------------------------------- project versions
create table public.project_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  version_number integer not null check (version_number >= 1),
  label text not null default '',
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  video_url text,
  editing_plan jsonb not null default '{"version":1,"operations":[]}'::jsonb,
  command_id uuid references public.editing_commands (id) on delete set null,
  duration numeric(10, 3),
  width integer,
  height integer,
  size_bytes bigint,
  created_at timestamptz not null default now(),
  unique (project_id, version_number)
);
create index project_versions_project_idx on public.project_versions (project_id, version_number desc);

alter table public.projects
  add constraint projects_current_version_fk
  foreign key (current_version_id) references public.project_versions (id) on delete set null;
alter table public.editing_commands
  add constraint editing_commands_base_version_fk foreign key (base_version_id) references public.project_versions (id) on delete set null,
  add constraint editing_commands_result_version_fk foreign key (result_version_id) references public.project_versions (id) on delete set null;

-- ---------------------------------------------------------------- renders
create table public.renders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  version_id uuid not null references public.project_versions (id) on delete cascade,
  command_id uuid references public.editing_commands (id) on delete set null,
  kind text not null default 'edit' check (kind in ('edit', 'export')),
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed')),
  progress integer not null default 0 check (progress between 0 and 100),
  stage text,
  message text,
  output_url text,
  output_size_bytes bigint,
  output_duration numeric(10, 3),
  output_width integer,
  output_height integer,
  error text,
  warnings jsonb not null default '[]'::jsonb,
  options jsonb not null default '{"quality":"720p"}'::jsonb,
  credits_charged integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index renders_project_idx on public.renders (project_id, created_at desc);
create index renders_user_status_idx on public.renders (user_id, status);
create trigger renders_updated_at before update on public.renders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- jobs (fila)
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('analyze', 'render')),
  user_id uuid not null references public.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed')),
  priority integer not null default 0,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_claim_idx on public.jobs (status, priority desc, run_after, created_at) where status = 'queued';
create trigger jobs_updated_at before update on public.jobs
  for each row execute function public.set_updated_at();

-- =====================================================================
-- Funções de negócio (SECURITY DEFINER, executáveis só pelo service_role)
-- =====================================================================

-- Novo usuário: perfil + carteira com bônus + assinatura grátis.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  bonus integer := 30;
begin
  insert into public.users (id, email, full_name)
  values (new.id, coalesce(new.email, ''), new.raw_user_meta_data ->> 'full_name');
  insert into public.credits (user_id, balance) values (new.id, bonus);
  insert into public.credit_transactions (user_id, amount, balance_after, reason, description)
  values (new.id, bonus, bonus, 'signup_bonus', 'Créditos de boas-vindas');
  insert into public.subscriptions (user_id, plan_id, status) values (new.id, 'free', 'active');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Débito atômico: falha (e não altera nada) se o saldo for insuficiente.
create or replace function public.consume_credits(
  p_user_id uuid, p_amount integer, p_reason text, p_reference_id uuid, p_description text default null
) returns integer language plpgsql security definer set search_path = public as $$
declare
  new_balance integer;
begin
  if p_amount <= 0 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;
  update public.credits
     set balance = balance - p_amount
   where user_id = p_user_id and balance >= p_amount
  returning balance into new_balance;
  if new_balance is null then
    raise exception 'INSUFFICIENT_CREDITS' using errcode = 'P0001';
  end if;
  insert into public.credit_transactions (user_id, amount, balance_after, reason, reference_id, description)
  values (p_user_id, -p_amount, new_balance, p_reason, p_reference_id, p_description);
  return new_balance;
end;
$$;

-- Crédito (compra, plano, reembolso). Idempotente por (reference_id, reason).
create or replace function public.grant_credits(
  p_user_id uuid, p_amount integer, p_reason text, p_reference_id uuid, p_description text default null
) returns integer language plpgsql security definer set search_path = public as $$
declare
  new_balance integer;
begin
  if p_amount <= 0 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;
  if p_reference_id is not null and exists (
    select 1 from public.credit_transactions where reference_id = p_reference_id and reason = p_reason
  ) then
    select balance into new_balance from public.credits where user_id = p_user_id;
    return new_balance;
  end if;
  update public.credits set balance = balance + p_amount where user_id = p_user_id
  returning balance into new_balance;
  if new_balance is null then
    insert into public.credits (user_id, balance) values (p_user_id, p_amount) returning balance into new_balance;
  end if;
  insert into public.credit_transactions (user_id, amount, balance_after, reason, reference_id, description)
  values (p_user_id, p_amount, new_balance, p_reason, p_reference_id, p_description);
  return new_balance;
end;
$$;

-- Próximo número de versão (com lock no projeto para evitar corrida).
create or replace function public.create_project_version(
  p_project_id uuid, p_user_id uuid, p_label text, p_plan jsonb, p_command_id uuid,
  p_status text default 'pending', p_video_url text default null
) returns public.project_versions language plpgsql security definer set search_path = public as $$
declare
  next_number integer;
  result public.project_versions;
begin
  perform 1 from public.projects where id = p_project_id and user_id = p_user_id for update;
  if not found then
    raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002';
  end if;
  select coalesce(max(version_number), 0) + 1 into next_number
    from public.project_versions where project_id = p_project_id;
  insert into public.project_versions (project_id, user_id, version_number, label, editing_plan, command_id, status, video_url)
  values (p_project_id, p_user_id, next_number, p_label, p_plan, p_command_id, p_status, p_video_url)
  returning * into result;
  return result;
end;
$$;

-- Fila: pega o próximo job livre sem disputa entre workers (SKIP LOCKED).
-- Jobs presos (worker caiu) voltam para a fila após 30 minutos.
create or replace function public.claim_next_job(p_worker text, p_types text[])
returns setof public.jobs language plpgsql security definer set search_path = public as $$
begin
  update public.jobs
     set status = 'queued', locked_at = null, locked_by = null
   where status = 'processing' and locked_at < now() - interval '30 minutes';

  return query
  update public.jobs j
     set status = 'processing', locked_at = now(), locked_by = p_worker, attempts = j.attempts + 1
   where j.id = (
     select id from public.jobs
      where status = 'queued' and run_after <= now() and type = any (p_types)
      order by priority desc, created_at
      for update skip locked
      limit 1
   )
  returning j.*;
end;
$$;

revoke all on function public.consume_credits(uuid, integer, text, uuid, text) from public, anon, authenticated;
revoke all on function public.grant_credits(uuid, integer, text, uuid, text) from public, anon, authenticated;
revoke all on function public.create_project_version(uuid, uuid, text, jsonb, uuid, text, text) from public, anon, authenticated;
revoke all on function public.claim_next_job(text, text[]) from public, anon, authenticated;
grant execute on function public.consume_credits(uuid, integer, text, uuid, text) to service_role;
grant execute on function public.grant_credits(uuid, integer, text, uuid, text) to service_role;
grant execute on function public.create_project_version(uuid, uuid, text, jsonb, uuid, text, text) to service_role;
grant execute on function public.claim_next_job(text, text[]) to service_role;

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.users enable row level security;
alter table public.subscriptions enable row level security;
alter table public.credits enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.projects enable row level security;
alter table public.media_assets enable row level security;
alter table public.video_metadata enable row level security;
alter table public.editing_commands enable row level security;
alter table public.project_versions enable row level security;
alter table public.renders enable row level security;
alter table public.jobs enable row level security; -- sem policies: só service_role

create policy "users: read own" on public.users for select using (auth.uid() = id);
create policy "users: update own" on public.users for update using (auth.uid() = id) with check (auth.uid() = id);

create policy "subscriptions: read own" on public.subscriptions for select using (auth.uid() = user_id);
create policy "credits: read own" on public.credits for select using (auth.uid() = user_id);
create policy "credit_transactions: read own" on public.credit_transactions for select using (auth.uid() = user_id);

create policy "projects: read own" on public.projects for select using (auth.uid() = user_id);
create policy "projects: insert own" on public.projects for insert with check (auth.uid() = user_id);
create policy "projects: update own" on public.projects for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "projects: delete own" on public.projects for delete using (auth.uid() = user_id);

create policy "media_assets: read own" on public.media_assets for select using (auth.uid() = user_id);
create policy "video_metadata: read own" on public.video_metadata for select using (auth.uid() = user_id);
create policy "editing_commands: read own" on public.editing_commands for select using (auth.uid() = user_id);
create policy "project_versions: read own" on public.project_versions for select using (auth.uid() = user_id);
create policy "renders: read own" on public.renders for select using (auth.uid() = user_id);

-- Usuário não pode alterar campos sensíveis do projeto pelo client.
create or replace function public.protect_project_columns()
returns trigger language plpgsql as $$
begin
  if auth.role() = 'authenticated' then
    new.user_id := old.user_id;
    new.original_video_url := old.original_video_url;
    new.thumbnail_url := old.thumbnail_url;
    new.status := old.status;
  end if;
  return new;
end;
$$;
create trigger projects_protect_columns before update on public.projects
  for each row execute function public.protect_project_columns();

-- =====================================================================
-- Storage: bucket privado e isolamento por usuário (users/{uid}/...)
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('editai-media', 'editai-media', false, 524288000)
on conflict (id) do nothing;

create policy "storage: read own files" on storage.objects for select
  using (bucket_id = 'editai-media' and (storage.foldername(name))[1] = 'users' and (storage.foldername(name))[2] = auth.uid()::text);
create policy "storage: upload own files" on storage.objects for insert
  with check (bucket_id = 'editai-media' and (storage.foldername(name))[1] = 'users' and (storage.foldername(name))[2] = auth.uid()::text);
create policy "storage: delete own files" on storage.objects for delete
  using (bucket_id = 'editai-media' and (storage.foldername(name))[1] = 'users' and (storage.foldername(name))[2] = auth.uid()::text);
