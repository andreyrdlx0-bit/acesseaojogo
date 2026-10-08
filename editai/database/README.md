# Banco de dados

Aplique as migrations em ordem (SQL Editor do Supabase ou `supabase db push`):

| Arquivo | O que faz |
|---|---|
| `0001_init.sql` | Tabelas, RLS, funções de créditos, fila de jobs e bucket privado de storage |
| `0002_security_hardening.sql` | Ajustes do Security Advisor (search_path fixo, revoga `/rpc/handle_new_user`) |
| `0003_user_scoped_jobs.sql` | `claim_next_job_for_user`: processamento inline na Vercel, só dos jobs do usuário |
| `0004_review_fixes.sql` | Remove escrita direta em `projects` pelo cliente, rate limit compartilhado (`hit_rate_limit`), índice da fila |

Tabelas: `users`, `projects`, `project_versions`, `editing_commands`, `renders`, `credits`,
`credit_transactions`, `subscriptions`, `media_assets`, `video_metadata`, `jobs`, `rate_limits`.

No projeto Supabase `editai` (sa-east-1) todas já foram aplicadas.
