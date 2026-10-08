-- Ajustes apontados pelo Security Advisor do Supabase.
alter function public.set_updated_at() set search_path = public;
alter function public.protect_project_columns() set search_path = public;
-- handle_new_user só deve rodar pelo trigger em auth.users, nunca via /rpc.
revoke all on function public.handle_new_user() from public, anon, authenticated;
comment on table public.jobs is 'Fila de processamento. Sem policies de propósito: acesso só via service_role.';
