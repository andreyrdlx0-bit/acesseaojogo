-- Correções da revisão pré-deploy.

-- 1) O app nunca grava `projects` com o JWT do usuário (tudo passa pelo servidor).
--    Sem isso, um INSERT direto via anon key poderia apontar original_video_url /
--    thumbnail_url para arquivos de outra pessoa, que o servidor assinaria.
drop policy if exists "projects: insert own" on public.projects;
drop policy if exists "projects: update own" on public.projects;
revoke insert, update on public.projects from anon, authenticated;

-- 2) Rate limiting compartilhado entre instâncias (funções serverless não
--    compartilham memória). Janela fixa por chave.
create table if not exists public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);
alter table public.rate_limits enable row level security; -- sem policies: só service_role

create or replace function public.hit_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  n integer;
begin
  insert into public.rate_limits (key, window_start, hits) values (p_key, w, 1)
  on conflict (key, window_start) do update set hits = public.rate_limits.hits + 1
  returning hits into n;
  -- Limpeza oportunista de janelas antigas.
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;
  return n <= p_limit;
end;
$$;
revoke all on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;

-- 3) Fila: um job vivo renova locked_at (heartbeat); só jobs realmente
--    abandonados voltam para a fila. Índice para a contagem por usuário.
create index if not exists jobs_user_status_idx on public.jobs (user_id, status);
