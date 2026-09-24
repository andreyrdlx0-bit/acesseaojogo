-- =============================================================================
-- Prioriza — espaço de trabalho na nuvem
--
-- Cada pessoa tem um espaço, guardado como um documento JSON com o mesmo
-- formato que o app já usa no navegador. Isso mantém o cliente simples: o
-- adaptador de nuvem grava e lê exatamente o mesmo objeto que o adaptador
-- local, sem camada de tradução.
--
-- A coluna "versao" existe para não perder edição. Dois aparelhos abertos ao
-- mesmo tempo gravariam por cima um do outro; com a versão, o segundo recebe
-- "conflito" e os dados do servidor, e o cliente junta nota a nota pela data
-- de edição em vez de descartar o trabalho de alguém.
-- =============================================================================

create table if not exists public.espacos (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  dados         jsonb       not null default '{}'::jsonb,
  versao        bigint      not null default 1,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table  public.espacos is 'Um espaço de notas por pessoa, no mesmo formato do app.';
comment on column public.espacos.versao is 'Sobe a cada gravação; usada para detectar edição concorrente.';

-- Sem isto qualquer pessoa autenticada leria o espaço de qualquer outra.
alter table public.espacos enable row level security;

drop policy if exists "dono lê o próprio espaço"      on public.espacos;
drop policy if exists "dono cria o próprio espaço"    on public.espacos;
drop policy if exists "dono atualiza o próprio espaço" on public.espacos;
drop policy if exists "dono apaga o próprio espaço"   on public.espacos;

create policy "dono lê o próprio espaço"
  on public.espacos for select
  using (auth.uid() = user_id);

create policy "dono cria o próprio espaço"
  on public.espacos for insert
  with check (auth.uid() = user_id);

create policy "dono atualiza o próprio espaço"
  on public.espacos for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "dono apaga o próprio espaço"
  on public.espacos for delete
  using (auth.uid() = user_id);


-- Gravação atômica com checagem de versão.
-- Devolve {conflito:false, versao, atualizado_em} quando gravou, ou
-- {conflito:true, versao, dados} com o estado do servidor quando alguém
-- gravou antes — aí o cliente junta e tenta de novo.
create or replace function public.salvar_espaco(p_dados jsonb, p_versao bigint)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_atual  bigint;
  v_dados  jsonb;
  v_nova   bigint;
  v_quando timestamptz;
begin
  if auth.uid() is null then
    raise exception 'é preciso estar autenticado';
  end if;

  select versao, dados into v_atual, v_dados
    from espacos where user_id = auth.uid();

  -- primeira gravação desta pessoa
  if v_atual is null then
    insert into espacos (user_id, dados, versao)
         values (auth.uid(), p_dados, 1)
      returning versao, atualizado_em into v_nova, v_quando;
    return jsonb_build_object('conflito', false, 'versao', v_nova, 'atualizado_em', v_quando);
  end if;

  -- outro aparelho gravou depois da nossa leitura
  if v_atual <> p_versao then
    return jsonb_build_object('conflito', true, 'versao', v_atual, 'dados', v_dados);
  end if;

  update espacos
     set dados = p_dados,
         versao = v_atual + 1,
         atualizado_em = now()
   where user_id = auth.uid()
  returning versao, atualizado_em into v_nova, v_quando;

  return jsonb_build_object('conflito', false, 'versao', v_nova, 'atualizado_em', v_quando);
end;
$$;

revoke all on function public.salvar_espaco(jsonb, bigint) from public, anon;
grant execute on function public.salvar_espaco(jsonb, bigint) to authenticated;
