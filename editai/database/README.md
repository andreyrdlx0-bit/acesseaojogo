# Banco de dados

- `migrations/0001_init.sql` — tabelas, RLS, funções de créditos, fila de jobs e bucket de storage.

Aplicação:

```bash
# Supabase CLI (recomendado)
supabase link --project-ref <ref>
supabase db push            # usa supabase/migrations -> veja README principal

# ou cole o conteúdo do arquivo no SQL Editor do painel do Supabase
```

Tabelas: `users`, `projects`, `project_versions`, `editing_commands`, `renders`,
`credits`, `credit_transactions`, `subscriptions`, `media_assets`, `video_metadata`, `jobs`.
