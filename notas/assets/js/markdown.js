/*
 * Prioriza — notas como arquivos Markdown (formato Obsidian)
 *
 * Duas saídas, porque os navegadores diferem no que permitem:
 *
 *  - escreverNoCofre(): usa a File System Access API para gravar um arquivo
 *    .md por nota direto numa pasta escolhida — o cofre do Obsidian. Só existe
 *    no Chrome e no Edge de computador; iPhone e Firefox não têm.
 *  - arquivoUnico(): junta tudo num .md só, para baixar. Funciona em todo
 *    lugar e serve de saída universal.
 *
 * O frontmatter YAML é o que o Obsidian lê como "propriedades" da nota, então
 * prioridade, etiquetas e prazo viram campos pesquisáveis lá dentro.
 */
(function (global) {
  'use strict';

  var Store = global.Store;

  /* Nome de arquivo seguro no Windows, no macOS e no Linux. */
  function nomeArquivo(nota, usados) {
    var base = (nota.titulo || 'sem titulo')
      .replace(/[\\/:*?"<>|#^\[\]]/g, ' ')  // proibidos, e # ^ [ ] atrapalham links do Obsidian
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'sem titulo';

    var nome = base;
    var n = 2;
    while (usados[nome.toLowerCase()]) { nome = base + ' ' + n; n++; }
    usados[nome.toLowerCase()] = true;
    return nome + '.md';
  }

  /* Só põe aspas quando o YAML precisa, para o arquivo ficar legível. */
  function yaml(valor) {
    var s = String(valor);
    return /^[\w À-ÿ.\/-]+$/.test(s) && s.trim() === s ? s : JSON.stringify(s);
  }

  function paraMarkdown(nota) {
    var p = Store.MAPA_PRIORIDADE[nota.prioridade] || Store.MAPA_PRIORIDADE.nenhuma;
    var caderno = Store.obterCaderno(nota.cadernoId);
    var etiquetas = nota.etiquetas
      .map(function (id) { var e = Store.obterEtiqueta(id); return e && e.nome; })
      .filter(Boolean);

    var cabeca = ['---'];
    cabeca.push('prioridade: ' + yaml(p.nome));
    if (caderno) cabeca.push('caderno: ' + yaml(caderno.nome));
    if (etiquetas.length) {
      cabeca.push('tags:');
      etiquetas.forEach(function (t) { cabeca.push('  - ' + yaml(t)); });
    }
    if (nota.prazo) cabeca.push('prazo: ' + nota.prazo);
    cabeca.push('concluida: ' + (nota.concluida ? 'true' : 'false'));
    if (nota.fixada) cabeca.push('fixada: true');
    cabeca.push('criada: ' + nota.criadaEm);
    cabeca.push('atualizada: ' + nota.atualizadaEm);
    cabeca.push('---');

    var corpo = ['', '# ' + (nota.titulo || 'Sem título'), ''];
    if (nota.conteudo) corpo.push(nota.conteudo, '');
    if (nota.checklist.length) {
      corpo.push('## Checklist', '');
      nota.checklist.forEach(function (i) {
        corpo.push('- [' + (i.feito ? 'x' : ' ') + '] ' + i.texto);
      });
      corpo.push('');
    }

    return cabeca.join('\n') + corpo.join('\n');
  }

  function exportaveis() {
    return Store.estado.notas.filter(function (n) { return !n.naLixeira; });
  }

  function arquivoUnico() {
    var notas = exportaveis();
    var partes = [
      '# Prioriza — ' + notas.length + (notas.length === 1 ? ' nota' : ' notas'),
      '',
      'Exportado em ' + new Date().toLocaleString('pt-BR') + '.',
      '',
      '---',
      ''
    ];

    notas.forEach(function (nota) {
      var p = Store.MAPA_PRIORIDADE[nota.prioridade] || Store.MAPA_PRIORIDADE.nenhuma;
      var caderno = Store.obterCaderno(nota.cadernoId);
      var etiquetas = nota.etiquetas
        .map(function (id) { var e = Store.obterEtiqueta(id); return e && e.nome; })
        .filter(Boolean);

      partes.push('## ' + (nota.concluida ? '~~' : '') +
        (nota.titulo || 'Sem título') + (nota.concluida ? '~~' : ''), '');

      var meta = ['**Prioridade:** ' + p.nome];
      if (caderno) meta.push('**Caderno:** ' + caderno.nome);
      if (etiquetas.length) meta.push('**Etiquetas:** ' + etiquetas.join(', '));
      if (nota.prazo) meta.push('**Prazo:** ' + nota.prazo);
      partes.push(meta.join(' · '), '');

      if (nota.conteudo) partes.push(nota.conteudo, '');
      if (nota.checklist.length) {
        nota.checklist.forEach(function (i) {
          partes.push('- [' + (i.feito ? 'x' : ' ') + '] ' + i.texto);
        });
        partes.push('');
      }
      partes.push('---', '');
    });

    return partes.join('\n');
  }

  function temCofre() {
    return typeof global.showDirectoryPicker === 'function';
  }

  /*
   * Grava um .md por nota na pasta escolhida. Sobrescreve arquivo de mesmo
   * nome — quem exporta duas vezes para o mesmo cofre atualiza, não duplica.
   */
  function escreverNoCofre() {
    if (!temCofre()) return Promise.reject(new Error('sem-suporte'));

    return global.showDirectoryPicker({ mode: 'readwrite' }).then(function (pasta) {
      var notas = exportaveis();
      var usados = {};
      var gravadas = 0;

      return notas.reduce(function (fila, nota) {
        return fila.then(function () {
          return pasta.getFileHandle(nomeArquivo(nota, usados), { create: true })
            .then(function (arquivo) { return arquivo.createWritable(); })
            .then(function (fluxo) {
              return fluxo.write(paraMarkdown(nota)).then(function () { return fluxo.close(); });
            })
            .then(function () { gravadas++; });
        });
      }, Promise.resolve()).then(function () {
        return { gravadas: gravadas, pasta: pasta.name };
      });
    });
  }

  global.Markdown = {
    paraMarkdown: paraMarkdown,
    arquivoUnico: arquivoUnico,
    escreverNoCofre: escreverNoCofre,
    temCofre: temCofre,
    nomeArquivo: nomeArquivo
  };
})(window);
