# Prioriza

Um SaaS de organização de tarefas no formato de bloco de notas, em que cada nota
carrega uma **etiqueta de prioridade** colorida. A ideia é escrever solto, como num
bloco de papel, e deixar a cor resolver a pergunta "o que eu faço agora?".

Vive dentro deste repositório em `/notas/`, sem interferir na página da raiz.

- **Página de apresentação:** `/notas/` → `index.html`
- **Aplicativo:** `/notas/app/` → `app/index.html`

## Como rodar

Não tem build, bundler nem dependência: são arquivos estáticos.

```bash
npx http-server . -p 8080
# depois abra http://localhost:8080/notas/
```

Abrir o `index.html` direto pelo `file://` também funciona, mas o `manifest.webmanifest`
e a instalação como aplicativo só valem servindo por HTTP.

## Estrutura

```
notas/
├── index.html                  página de apresentação (recursos, planos, dúvidas)
├── manifest.webmanifest        permite instalar como app no celular
├── app/
│   └── index.html              a casca do aplicativo (sprite de ícones + markup)
└── assets/
    ├── css/
    │   ├── landing.css         estilos da apresentação
    │   └── app.css             estilos do aplicativo (claro + escuro)
    ├── js/
    │   ├── store.js            dados, regras e persistência
    │   └── app.js              interface, eventos e renderização
    └── img/                    logotipo, favicon e ícone do manifest
```

## O que o aplicativo faz

| Recurso | Detalhe |
| --- | --- |
| Etiquetas de prioridade | Urgente, Alta, Média, Baixa e Sem prioridade — fixas, com cor na borda do cartão |
| Etiquetas livres | Criadas pelo usuário, cor automática, várias por nota |
| Cadernos | Agrupam notas por contexto (Trabalho, Pessoal, Estudos…) |
| Checklist | Subtarefas dentro da nota, com barra de progresso no cartão |
| Prazos | Atalhos para hoje / amanhã / 7 dias; atrasado e "hoje" ganham destaque |
| Visualizações | Grade, lista e quadro arrastável por prioridade |
| Ordenação | Prioridade, prazo, edição recente, criação, A→Z e ordem manual (arrastando) |
| Busca | Título, corpo, itens do checklist, etiquetas e caderno, com realce do trecho |
| Fixar / arquivar / lixeira | Lixeira com restauração e "Desfazer" logo após a ação |
| Tema | Claro, escuro ou seguindo o sistema |
| Backup | Exporta e importa um JSON legível |

### Atalhos de teclado

| Tecla | Ação |
| --- | --- |
| `N` | Nova nota |
| `/` | Focar na busca |
| `Esc` | Fechar o painel de cima |
| `E` | Alternar tema |
| `G` / `L` / `Q` | Grade / Lista / Quadro |
| `1`–`5` | Prioridade da nota aberta (com `Alt` quando o cursor está no texto) |
| `Ctrl`+`Enter` | Concluir a nota aberta |
| `?` | Lista de atalhos |

## Onde ficam os dados

No `localStorage` do navegador, sob a chave `prioriza:v1`. Nada sai do aparelho e
não existe servidor. Consequências que o app deixa explícitas para o usuário:

- limpar os dados do navegador apaga as notas — por isso existe o backup em JSON;
- cada navegador/aparelho tem o seu próprio conjunto de notas;
- em aba anônima ou com armazenamento bloqueado, a gravação falha e o app avisa
  na tela em vez de fingir que salvou.

## Levar as notas para o Obsidian

As notas saem como Markdown com frontmatter YAML, que o Obsidian lê como
propriedades — então prioridade, caderno, etiquetas e prazo ficam pesquisáveis
lá dentro, e o checklist vira caixas de marcar nativas.

```markdown
---
prioridade: Urgente
caderno: Trabalho
tags:
  - Reunião
prazo: 2026-09-24
concluida: false
---

# Fechar proposta do cliente novo

Revisar escopo, ajustar valores e enviar até o fim do dia.

## Checklist
- [x] Revisar escopo
- [ ] Ajustar valores
```

Duas saídas, em Configurações:

- **Salvar no meu cofre** — escolhe uma pasta e grava um `.md` por nota, direto
  no cofre. Usa a File System Access API, que só existe no Chrome e no Edge de
  computador. Exportar de novo atualiza os mesmos arquivos em vez de duplicar.
- **Baixar em Markdown** — um arquivo único com tudo. Funciona em qualquer
  navegador, inclusive iPhone.

Notas na lixeira não são exportadas. Nomes de arquivo são higienizados para os
três sistemas e para os links do Obsidian (`/ \ : * ? " < > | # ^ [ ]` saem), com
sufixo numérico quando duas notas têm o mesmo título.

**O que isto não é:** o Obsidian não tem API para um site alcançar seu cofre
pela internet. Isso é exportação, não sincronização de mão dupla — para as
notas acompanharem você entre aparelhos, é a camada abaixo que resolve.

## Sincronização entre aparelhos (SaaS)

Existe uma camada de nuvem opcional. Ela é **local-first**: o navegador continua
sendo a fonte da verdade e o app funciona inteiro sem rede — a nuvem sincroniza
por cima. Se o servidor cair, ninguém percebe; volta a sincronizar depois.

Enquanto `assets/js/config.js` estiver com `url` e `chave` vazias, nada disso
aparece: nenhuma tela de conta, nenhum dado sai do aparelho, e a biblioteca do
Supabase (218 KB) nem é baixada.

### Como ligar

1. Criar um projeto no Supabase.
2. Rodar `backend/001_espacos.sql` no SQL Editor do projeto.
3. Em Authentication → Providers, deixar e-mail/senha ligado. Desligar
   "Confirm email" faz a conta valer na hora; deixando ligado, a pessoa precisa
   clicar no link do e-mail antes de entrar (o app avisa os dois casos).
4. Preencher `assets/js/config.js` com a URL do projeto e a **chave publicável**.

A chave publicável é pública de propósito: ela só permite o que as políticas de
RLS autorizam, e elas restringem cada pessoa ao próprio espaço. A chave secreta
(`service_role`) nunca deve entrar neste arquivo.

### Como os dados ficam guardados

Uma linha por pessoa na tabela `espacos`, com o espaço inteiro num campo `jsonb`
no mesmo formato que o app usa no navegador. Isso mantém o cliente simples — não
há camada de tradução entre o que está na tela e o que está no banco.

### Edição em dois aparelhos ao mesmo tempo

A coluna `versao` sobe a cada gravação. Se o celular grava enquanto o computador
ainda estava na versão anterior, a função `salvar_espaco` devolve `conflito` com
os dados do servidor em vez de deixar um sobrescrever o outro. O cliente então
junta os dois espaços:

- **Notas** — união por id; vence a de `atualizadaEm` mais recente.
- **Apagadas de vez** — cada exclusão definitiva deixa uma *lápide* (`removidas`)
  com id e data. Sem isso, apagar uma nota no celular seria desfeito pelo
  computador na sincronização seguinte. Uma edição posterior à lápide ganha,
  para não perder trabalho; no empate exato de horário, apagar vence. Lápides
  expiram em 90 dias.
- **Cadernos e etiquetas** — união por id; no empate vale a versão local.
- **Preferências** — ficam com o aparelho. Tema e visualização são escolha de
  quem está nesta tela, não algo a herdar de outro aparelho.

A junção é testável isoladamente: `Nuvem.juntar(local, remoto)` é uma função
pura, sem rede.

## Trocando o `localStorage` por um backend

`store.js` isola toda a persistência num **adaptador** com três métodos assíncronos.
Para sincronizar na nuvem, basta escrever outro objeto com a mesma forma e apontar
`Store.adapter` para ele antes de `Store.iniciar()`:

```js
Store.adapter = {
  nome: 'remoto',
  ler:     ()       => fetch('/api/espaco').then(r => r.ok ? r.json() : null),
  gravar:  (estado) => fetch('/api/espaco', {
                         method: 'PUT',
                         headers: { 'Content-Type': 'application/json' },
                         body: JSON.stringify(estado)
                       }).then(r => r.ok || Promise.reject(r.status)),
  limpar:  ()       => fetch('/api/espaco', { method: 'DELETE' })
};
```

O resto do app não muda: ele nunca toca em `localStorage` diretamente. Gravações
seguidas já vêm agrupadas (120 ms), e `Store.gravarAgora()` força a gravação
imediata — é o que roda quando a aba é fechada ou minimizada.

### Formato do estado

```js
{
  versao: 1,
  perfil:    { nome, plano, criadoEm },
  cadernos:  [{ id, nome, cor, ordem }],
  etiquetas: [{ id, nome, cor }],
  notas: [{
    id, titulo, conteudo,
    prioridade,            // 'urgente' | 'alta' | 'media' | 'baixa' | 'nenhuma'
    cadernoId, etiquetas,  // id e lista de ids
    checklist: [{ id, texto, feito }],
    prazo,                 // 'AAAA-MM-DD' ou null
    concluida, fixada, arquivada, naLixeira,
    criadaEm, atualizadaEm, concluidaEm, ordem
  }],
  prefs: { tema, visualizacao, ordenacao, filtro, ocultarConcluidas,
           cadernoAtivo, etiquetaAtiva, densidade }
}
```

Tudo que entra passa por `normalizar()`, que descarta campo estranho, referência
quebrada (etiqueta apagada, caderno inexistente) e prioridade desconhecida — então
um backup adulterado ou de versão antiga não derruba o app.

## Planos

A versão publicada é o plano **Free** inteiro: gratuito, sem conta e sem cobrança.
**Pro** e **Time** aparecem na página de apresentação como roteiro do produto e
dependem da sincronização na nuvem; nenhum pagamento é processado em lugar nenhum
do código.
