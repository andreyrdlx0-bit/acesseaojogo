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
