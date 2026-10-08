-- Processamento "inline" (sem worker dedicado, ex.: Vercel): a própria sessão do
-- usuário dispara o processamento dos SEUS jobs. A função continua restrita ao
-- service_role; a rota de API garante que p_user_id é o usuário autenticado.
create or replace function public.claim_next_job_for_user(
  p_worker text, p_types text[], p_user_id uuid, p_stale_minutes integer default 10
) returns setof public.jobs language plpgsql security definer set search_path = public as $$
begin
  -- Jobs presos (função encerrada no meio) voltam para a fila.
  update public.jobs
     set status = 'queued', locked_at = null, locked_by = null
   where user_id = p_user_id
     and status = 'processing'
     and locked_at < now() - make_interval(mins => greatest(p_stale_minutes, 6));

  return query
  update public.jobs j
     set status = 'processing', locked_at = now(), locked_by = p_worker, attempts = j.attempts + 1
   where j.id = (
     select id from public.jobs
      where status = 'queued' and run_after <= now() and type = any (p_types) and user_id = p_user_id
      order by priority desc, created_at
      for update skip locked
      limit 1
   )
  returning j.*;
end;
$$;

revoke all on function public.claim_next_job_for_user(text, text[], uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_next_job_for_user(text, text[], uuid, integer) to service_role;
