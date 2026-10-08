# EDITAI — Fale. A IA edita.

Editor de vídeo controlado por linguagem natural. O usuário envia um vídeo, **fala** (ou escreve) como quer a edição, a IA transforma a instrução em um **EditingPlan JSON validado**, e um worker com **FFmpeg** renderiza uma nova versão.

```
UPLOAD → ANÁLISE → FALE → SPEECH-TO-TEXT → IA → EDITING PLAN (JSON) → VALIDAÇÃO
      → FILA → WORKER → FFMPEG → STORAGE → PREVIEW → NOVO COMANDO → EXPORTAR
```

## Sumário
1. [Visão geral](#visão-geral)
2. [Arquitetura](#arquitetura)
3. [Instalação](#instalação)
4. [Variáveis de ambiente](#variáveis-de-ambiente)
5. [Supabase: banco, auth e storage](#supabase-banco-auth-e-storage)
6. [FFmpeg e o motor de vídeo](#ffmpeg-e-o-motor-de-vídeo)
7. [IA e Speech-to-Text](#ia-e-speech-to-text)
8. [Workers e jobs](#workers-e-jobs)
9. [Créditos e planos](#créditos-e-planos)
10. [Execução local](#execução-local)
11. [Produção](#produção)
12. [Segurança](#segurança)
13. [Testes](#testes)
14. [Troubleshooting](#troubleshooting)
15. [O que é real e o que está preparado](#o-que-é-real-e-o-que-está-preparado)

## Visão geral

| Área | Stack |
|---|---|
| Frontend | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS v4, componentes no estilo shadcn/ui (Radix) |
| Backend | Route Handlers + Server Actions (TypeScript) |
| Banco / Auth / Storage | Supabase (PostgreSQL + RLS, Supabase Auth, Storage privado) |
| Processamento | Worker Node.js + FFmpeg/FFprobe |
| IA | Camada abstrata: Claude (Anthropic SDK), OpenAI ou planejador por regras local |
| STT | Camada abstrata: OpenAI Whisper, com fallback de transcrição do navegador |

## Arquitetura

```
editai/
├── app/                 # Rotas (UI) e API (app/api/*)
│   ├── (auth)/          # login, cadastro, recuperação de senha + server actions
│   ├── (app)/           # área logada: dashboard, projetos, editor, biblioteca, planos, configurações
│   └── api/             # rotas HTTP finas → chamam services/
├── api/client.ts        # cliente tipado das rotas para o browser
├── components/          # ui/ (primitivos), landing/, app/, project/, editor/
├── hooks/               # useAudioRecorder, usePolling
├── lib/
│   ├── editing-plan/    # SCHEMA Zod do EditingPlan, validação, normalização, descrições
│   ├── supabase/        # clientes browser/server/admin + middleware de sessão
│   ├── api/handler.ts   # envelope das rotas: auth, rate limit, erros amigáveis
│   └── logger.ts, errors.ts, rate-limit.ts, auth.ts
├── services/            # REGRAS DE NEGÓCIO e integrações (sem React)
│   ├── ai/planner/      # AIEditingPlanner: anthropic, openai, rule-based + fallback
│   ├── ai/stt/          # SpeechToTextProvider: openai-whisper, unconfigured
│   ├── video/           # analyzer, timeline, engine (FFmpeg), processors/, processing-service
│   ├── projects/        # projetos, upload, comandos, renders
│   ├── credits/         # débito/crédito atômicos
│   ├── billing/         # PaymentProvider (Stripe preparado)
│   ├── storage/         # StorageProvider (Supabase Storage)
│   └── queue/           # RenderQueue (Postgres SKIP LOCKED)
├── workers/             # render-worker.ts (processo separado) + limpeza de temporários
├── database/migrations/ # SQL: tabelas, RLS, funções, bucket
├── types/               # tipos de domínio e interfaces de serviço
├── config/              # env, planos, custos, limites de upload
├── utils/               # formatação, texto, caminhos de storage
├── scripts/engine-demo.ts
└── tests/
```

Camadas: **UI → API → Business Logic (services) → AI Services → Video Processing → Storage → Database**.

### Interfaces de serviço (`types/services.ts`)

| Interface | Implementações | Onde trocar |
|---|---|---|
| `SpeechToTextProvider` | `OpenAIWhisperProvider`, `UnconfiguredSpeechToText` | `services/ai/stt/index.ts` |
| `AIEditingPlanner` | `AnthropicPlanner`, `OpenAIPlanner`, `RuleBasedPlanner` | `services/ai/planner/index.ts` |
| `VideoProcessor` / `VideoAnalyzer` | `FfmpegVideoProcessor`, `FfmpegVideoAnalyzer` | `services/video/*` |
| `StorageProvider` | `SupabaseStorageProvider` | `services/storage/index.ts` |
| `RenderQueue` | `PostgresRenderQueue` | `services/queue/index.ts` |
| `PaymentProvider` | `StripePaymentProvider` (TODO), `NoPaymentProvider` | `services/billing/index.ts` |

### EditingPlan

Definido em `lib/editing-plan/schema.ts` (Zod → tipos TypeScript). Operações:
`trim`, `cut`, `remove_silence`, `remove_retakes`, `shorten`, `subtitles`, `subtitle_style`, `audio_enhancement`,
`noise_reduction`, `volume`, `background_music`, `speed`, `zoom`, `crop`, `aspect_ratio`, `transitions`,
`text_overlay`, `color_adjustment`, `b_roll`.

Regras:
- O LLM **só produz JSON**. Nada é executado a partir dele.
- `validateEditingPlan` valida **cada operação isoladamente**; as inválidas são rejeitadas e reportadas.
- O worker **revalida** o plano antes do FFmpeg (o banco também não é fonte confiável).
- FFmpeg é chamado com **array de argumentos, sem shell**; textos do usuário vão para arquivos (`textfile=`, `.ass`).
- O plano é **cumulativo** e toda versão é renderizada a partir do **vídeo original**: sem perda de qualidade e com "desfazer" natural ("remova o zoom").

**Adicionar uma operação:** schema em `schema.ts` → descrição em `services/ai/planner/prompt.ts` → processor em `services/video/processors/` (registre em `processors/index.ts`) → rótulo em `describe.ts`.

## Instalação

Requisitos: Node.js ≥ 20, FFmpeg 6+ (com libass, libfreetype e libx264) e uma conta Supabase.

```bash
cd editai
npm install
cp .env.example .env.local   # preencha os valores
```

## Variáveis de ambiente

Veja `.env.example`. Principais:

| Variável | Uso |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Cliente do browser/servidor (RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Somente servidor/worker**. Nunca exponha. |
| `SUPABASE_STORAGE_BUCKET` | Bucket privado (padrão `editai-media`) |
| `AI_PROVIDER` / `AI_API_KEY` / `AI_MODEL` | `anthropic` (padrão `claude-opus-5-5`), `openai` ou `rules` |
| `STT_PROVIDER` / `SPEECH_TO_TEXT_API_KEY` | `openai` (Whisper) ou `browser` |
| `INLINE_JOBS` | `true` (padrão): o próprio app processa os vídeos (ideal na Vercel). `false`: use o worker dedicado |
| `FFMPEG_PATH`, `FFPROBE_PATH`, `FONTS_DIR` | Opcionais. Sem eles, usa o `ffmpeg-static` empacotado e a fonte Inter de `assets/fonts` |
| `MAX_UPLOAD_MB`, `MAX_VIDEO_SECONDS` | Limites de upload (o plano grátis do Supabase aceita até 50 MB por arquivo) |
| `PAYMENT_PROVIDER`, `PAYMENT_API_KEY`, `PAYMENT_WEBHOOK_SECRET` | Gateway de pagamento (preparado) |

## Supabase: banco, auth e storage

1. Crie um projeto em supabase.com.
2. Aplique `database/migrations/0001_init.sql` (SQL Editor ou `supabase db push`). Ele cria:
   - as tabelas `users`, `projects`, `project_versions`, `editing_commands`, `renders`, `credits`, `credit_transactions`, `subscriptions`, `media_assets`, `video_metadata` e `jobs`;
   - **RLS em todas as tabelas** (o usuário só lê o que é dele; escritas sensíveis só via service role);
   - as funções atômicas `consume_credits`, `grant_credits`, `create_project_version` e `claim_next_job`;
   - um trigger que cria perfil, carteira com **30 créditos** e assinatura grátis no cadastro;
   - o bucket privado `editai-media`, com policies por prefixo `users/{uid}/`.
3. Em **Authentication → URL Configuration**, adicione `http://localhost:3000/auth/callback` (e o domínio de produção) às Redirect URLs.

Layout do storage:
```
users/{userId}/projects/{projectId}/original/   vídeo original + thumbnail
users/{userId}/projects/{projectId}/audio/      comandos de voz (expiram em 30 dias)
users/{userId}/projects/{projectId}/versions/   v2.mp4, v3.mp4...
users/{userId}/projects/{projectId}/exports/    exportações
users/{userId}/library/                         músicas da biblioteca
```
Os uploads vão **direto do browser para o storage** com URL assinada (o servidor Next não recebe o vídeo). Os downloads usam URLs assinadas que expiram em 1 hora.

## FFmpeg e o motor de vídeo

- `services/video/analyzer.ts`: ffprobe (duração, resolução, FPS, rotação, codecs), `silencedetect` + `volumedetect`, thumbnail e extração de áudio para o STT.
- `services/video/timeline.ts`: decide quais trechos ficam (trim, cortes, silêncios, erros, versão curta) e mapeia o tempo original para o tempo final.
- `services/video/processors/`: um módulo por operação. `SegmentProcessor` (cortes/silêncios), `SpeedProcessor`, `CropProcessor`/`ScaleProcessor`, `ZoomProcessor`, `ColorProcessor`, `SubtitleProcessor` (ASS/libass, estilo karaokê), `TextOverlayProcessor`, `AudioProcessor`, `MusicProcessor` (com ducking), `TransitionProcessor` e `BRollProcessor`.
- `services/video/engine.ts`: monta um único `filter_complex`, executa com progresso (`-progress pipe:1`) e valida a saída com ffprobe.

Para testar o motor sem Supabase nem IA:
```bash
npm run engine:demo    # gera .worker-tmp/demo/output.mp4 (9:16, legendas, zoom, cortes...)
```

## IA e Speech-to-Text

**Planner** (`services/ai/planner`): recebe a instrução, o plano atual, os dados do vídeo, a transcrição e o histórico, e devolve `{ reply, operations }`. Se o LLM falhar ou não estiver configurado, usa o `RuleBasedPlanner`. Ele entende em português os comandos da lista do produto: silêncios, erros, legendas maiores/menores, zoom por palavra, voz, ruído, música, "primeiros N segundos", Reels/TikTok, versão de N segundos, dinâmico, profissional, cores etc. O campo `provider` salvo no comando indica sempre quem respondeu (ex.: `rules (fallback)`).

**Autopilot**: `mode: "autopilot"` (checkbox no editor) monta um plano de alta retenção (ritmo, legendas dinâmicas, zoom, áudio, 9:16). A arquitetura está preparada para evoluir com análise de retenção.

**Speech-to-Text** (`services/ai/stt`):
- Comando de voz: o áudio é gravado no browser (MediaRecorder), enviado ao storage e transcrito no servidor.
- Vídeo: o worker extrai o áudio e transcreve com **timestamps por palavra** (necessários para legendas e zoom por palavra).
- Sem `SPEECH_TO_TEXT_API_KEY`: os comandos usam a transcrição do **navegador** (Web Speech API, marcada como `browser`); o vídeo fica sem transcrição e a UI avisa que legendas e zoom por palavra não estão disponíveis. Nada é inventado.

## Workers e jobs

```bash
npm run worker
```

- A fila fica na tabela `jobs` (`claim_next_job` com `FOR UPDATE SKIP LOCKED`), com os tipos `analyze` e `render`.
- Estados: `QUEUED → PROCESSING → COMPLETED | FAILED`, com até 3 tentativas. Jobs presos voltam para a fila após 30 minutos.
- O progresso é gravado em `renders.progress/stage/message` ("Preparando vídeo...", "Aplicando cortes...", "Gerando legendas...", "Renderizando...", "Finalizando...").
- Em falha definitiva: mensagem amigável ao usuário, erro detalhado só no log e **reembolso automático e idempotente** dos créditos.
- Para escalar, suba mais workers (`WORKER_CONCURRENCY` por processo).
- A cada hora o worker remove arquivos temporários expirados.

## Créditos e planos

- `credits.balance` tem `CHECK (balance >= 0)`; o débito só acontece via `consume_credits` e só se houver saldo.
- Custo (`config/credits.ts`): 1 crédito a cada 30s de vídeo, ×1,5 em 1080p, +1 com legendas, +1 com música; exportação custa metade. O usuário vê o custo antes de confirmar.
- Planos (`config/plans.ts`): Starter R$29, Creator R$59 (1080p) e Pro R$99 (prioridade na fila).
- Cobrança: `StripePaymentProvider` está preparado com `TODO: CONNECT_REAL_PROVIDER`. Enquanto isso, a UI informa que os pagamentos não estão ativos.

## Execução local

```bash
npm run dev        # http://localhost:3000
npm run worker     # em outro terminal (precisa de FFmpeg)
```

## Produção

### Vercel (mais simples: tudo em um lugar)

O app roda inteiro na Vercel, sem servidor extra: quando há uma análise ou renderização pendente, o navegador do usuário chama `POST /api/jobs/run`, que processa **os jobs daquele usuário** com o `ffmpeg-static` empacotado (máx. 300s por chamada no plano Hobby). A fila no banco garante que cada job roda uma única vez.

1. Importe o projeto na Vercel com **Root Directory = `editai`** (Framework: Next.js).
2. Variáveis obrigatórias: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY`. As demais têm padrão.
3. No Supabase, em **Authentication → URL Configuration**: defina a *Site URL* com o domínio da Vercel e adicione `https://editai*.vercel.app/**` em *Redirect URLs*.
4. O serviço de e-mail padrão do Supabase só envia para membros da organização: para usuários reais, configure um SMTP próprio (Authentication → SMTP) ou desative a confirmação de e-mail.

### Worker dedicado (vídeos longos e volume alto)

- **Web**: Vercel ou qualquer host Node. Configure as variáveis de ambiente públicas e de servidor.
- **Worker**: processo de longa duração com FFmpeg (Docker, Fly.io, Railway, ECS...). Exemplo de imagem:
  ```dockerfile
  FROM node:22-bookworm
  RUN apt-get update && apt-get install -y ffmpeg fonts-inter fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
  WORKDIR /app
  COPY . .
  RUN npm ci
  ENV FFMPEG_PATH=/usr/bin/ffmpeg FFPROBE_PATH=/usr/bin/ffprobe INLINE_JOBS=false
  CMD ["npm", "run", "worker"]
  ```
- O rate limiting é em memória (`lib/rate-limit.ts`). Com várias instâncias web, troque por Redis/Upstash.
- Para vídeos acima de 50 MB, use o upload resumível (TUS) do Supabase no `uploadFile` do worker.

## Segurança

- Autenticação Supabase validada no servidor (`auth.getUser()`); o middleware protege as rotas privadas.
- Autorização: toda rota verifica a posse do recurso (`getOwnedProject`) antes de usar o client de service role; o RLS é a segunda barreira.
- Validação Zod de todo corpo de requisição; tipo e tamanho dos arquivos validados no servidor; caminhos de storage verificados pelo prefixo do usuário.
- Rate limiting por usuário e por rota; URLs assinadas e temporárias; arquivos temporários expiram.
- Erros: mensagens amigáveis para o usuário; stack traces só nos logs estruturados (`lib/logger.ts`, com secrets redigidos).
- Os redirecionamentos de login aceitam apenas caminhos internos.

## Testes

```bash
npm test             # schema, timeline e planner por regras
npm run typecheck
npm run engine:demo  # renderização real com FFmpeg
```

## Troubleshooting

| Sintoma | Causa provável |
|---|---|
| O painel mostra "configure o Supabase" | Faltam as variáveis `NEXT_PUBLIC_SUPABASE_*` |
| O vídeo fica em "Analisando..." | O worker não está rodando (`npm run worker`) ou não acha o FFmpeg |
| As legendas não aparecem e há um aviso | Sem `SPEECH_TO_TEXT_API_KEY`, o vídeo não foi transcrito |
| "Não conseguimos transcrever o áudio" | Sem STT no servidor e o navegador não suporta Web Speech API: escreva o comando |
| Respostas da IA genéricas e `provider` = `rules` | Sem `AI_API_KEY`; o planejador por regras está ativo |
| Legendas sem a fonte certa | Confira se `assets/fonts` foi publicado junto (ou defina `FONTS_DIR`) |
| Vídeo longo para de processar na Vercel | Funções têm limite de 300s no plano Hobby: use vídeos curtos ou um worker dedicado (`INLINE_JOBS=false`) |
| Upload falha com 403 | Bucket ou policies não criados: reaplique a migration |

## O que é real e o que está preparado

| Funciona de verdade | Preparado (TODO: CONNECT_REAL_PROVIDER) |
|---|---|
| Auth, RLS, projetos, upload direto ao storage, versões e histórico | Cobrança Stripe e webhook |
| Análise FFmpeg (silêncios, volume, FPS, thumbnail) | B-roll automático, geração de imagens e vídeos |
| Renderização FFmpeg de todas as operações, exceto `b_roll` | Enquadramento por detecção de rosto (hoje: recorte central) |
| Planner com Claude/OpenAI (com chave) e planner por regras | Análise de retenção para o Autopilot |
| STT Whisper (com chave) e transcrição do navegador | Tradução, dublagem e publicação em redes |
| Fila com retry, progresso, reembolso e exportação 9:16/16:9/1:1 | |
