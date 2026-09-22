/*
 * Prioriza — interface
 * Depende de store.js (window.Store).
 */
(function () {
  'use strict';

  var Store = window.Store;

  /* =============================================================== utils */

  function $(sel, raiz) { return (raiz || document).querySelector(sel); }
  function $$(sel, raiz) { return Array.prototype.slice.call((raiz || document).querySelectorAll(sel)); }

  function esc(txt) {
    return String(txt == null ? '' : txt).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function realcar(txt, termo) {
    var saida = esc(txt);
    if (!termo || termo.length < 2) return saida;
    var alvo = esc(termo).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      return saida.replace(new RegExp('(' + alvo + ')', 'gi'), '<mark>$1</mark>');
    } catch (e) {
      return saida;
    }
  }

  function icone(nome, extra) {
    return '<svg' + (extra ? ' class="' + extra + '"' : '') + ' aria-hidden="true"><use href="#ic-' + nome + '"/></svg>';
  }

  /* datas em horário local — nada de UTC, senão "hoje" vira "ontem" à noite */
  function paraISO(data) {
    var d = new Date(data.getTime() - data.getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 10);
  }
  function hojeISO() { return paraISO(new Date()); }
  function maisDias(n) {
    var d = new Date();
    d.setDate(d.getDate() + n);
    return paraISO(d);
  }
  function diffDias(iso) {
    var a = new Date(hojeISO() + 'T00:00:00');
    var b = new Date(iso + 'T00:00:00');
    return Math.round((b - a) / 86400000);
  }

  var MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  function rotuloPrazo(iso) {
    var d = diffDias(iso);
    if (d === 0) return 'Hoje';
    if (d === 1) return 'Amanhã';
    if (d === -1) return 'Ontem';
    if (d < -1) return Math.abs(d) + ' dias atrás';
    if (d > 1 && d <= 7) return 'Em ' + d + ' dias';
    var data = new Date(iso + 'T00:00:00');
    var texto = data.getDate() + ' de ' + MESES[data.getMonth()];
    if (data.getFullYear() !== new Date().getFullYear()) texto += ' de ' + data.getFullYear();
    return texto;
  }

  function dataCurta(isoCompleto) {
    var d = new Date(isoCompleto);
    if (isNaN(d)) return '';
    return d.getDate() + ' ' + MESES[d.getMonth()] + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function plural(n, um, muitos) { return n + ' ' + (n === 1 ? um : muitos); }

  /* ============================================================== filtros */

  var FILTROS_RAPIDOS = [
    { id: 'todas', nome: 'Todas as notas', icone: '📄', sub: 'Tudo que está ativo no seu espaço' },
    { id: 'hoje', nome: 'Para hoje', icone: '🎯', sub: 'Vence hoje ou já passou do prazo' },
    { id: 'atrasadas', nome: 'Atrasadas', icone: '🔥', sub: 'Passou do prazo e continua em aberto' },
    { id: 'semana', nome: 'Próximos 7 dias', icone: '🗓️', sub: 'O que vence na próxima semana' },
    { id: 'fixadas', nome: 'Fixadas', icone: '📌', sub: 'As notas que você fixou no topo' }
  ];

  var FILTROS_GUARDADOS = [
    { id: 'concluidas', nome: 'Concluídas', icone: '✅', sub: 'Tudo que você já riscou da lista' },
    { id: 'arquivadas', nome: 'Arquivadas', icone: '📦', sub: 'Fora do caminho, mas guardadas' },
    { id: 'lixeira', nome: 'Lixeira', icone: '🗑️', sub: 'Dá para restaurar enquanto estiver aqui' }
  ];

  function descreveFiltro(id) {
    var todos = FILTROS_RAPIDOS.concat(FILTROS_GUARDADOS);
    for (var i = 0; i < todos.length; i++) if (todos[i].id === id) return todos[i];
    if (id.indexOf('prio:') === 0) {
      var p = Store.MAPA_PRIORIDADE[id.slice(5)];
      if (p) return { id: id, nome: p.nome, icone: '●', sub: 'Notas marcadas como ' + p.nome.toLowerCase() };
    }
    return FILTROS_RAPIDOS[0];
  }

  function passaFiltro(nota, filtro) {
    var hoje = hojeISO();

    if (filtro === 'lixeira') return nota.naLixeira;
    if (nota.naLixeira) return false;
    if (filtro === 'arquivadas') return nota.arquivada;
    if (nota.arquivada) return false;

    if (filtro.indexOf('prio:') === 0) return nota.prioridade === filtro.slice(5) && !nota.concluida;

    switch (filtro) {
      case 'hoje': return !!nota.prazo && nota.prazo <= hoje && !nota.concluida;
      case 'atrasadas': return !!nota.prazo && nota.prazo < hoje && !nota.concluida;
      case 'semana': return !!nota.prazo && nota.prazo >= hoje && nota.prazo <= maisDias(7) && !nota.concluida;
      case 'fixadas': return nota.fixada;
      case 'concluidas': return nota.concluida;
      default: return true;
    }
  }

  function combinaBusca(nota, termo) {
    if (!termo) return true;
    var alvo = [nota.titulo, nota.conteudo];
    nota.etiquetas.forEach(function (id) {
      var e = Store.obterEtiqueta(id);
      if (e) alvo.push(e.nome);
    });
    var cad = Store.obterCaderno(nota.cadernoId);
    if (cad) alvo.push(cad.nome);
    nota.checklist.forEach(function (i) { alvo.push(i.texto); });
    return alvo.join(' ').toLowerCase().indexOf(termo.toLowerCase()) >= 0;
  }

  function notasVisiveis() {
    var prefs = Store.estado.prefs;
    var termo = ui.busca.trim();
    var filtro = termo ? 'todas' : prefs.filtro;

    var lista = Store.estado.notas.filter(function (n) {
      if (termo && n.naLixeira) return false;
      if (!passaFiltro(n, filtro)) return false;
      if (prefs.cadernoAtivo && n.cadernoId !== prefs.cadernoAtivo) return false;
      if (prefs.etiquetaAtiva && n.etiquetas.indexOf(prefs.etiquetaAtiva) < 0) return false;
      if (prefs.ocultarConcluidas && n.concluida && filtro !== 'concluidas') return false;
      return combinaBusca(n, termo);
    });

    return ordenar(lista, prefs.ordenacao);
  }

  function ordenar(lista, modo) {
    var copia = lista.slice();
    var peso = function (n) { return (Store.MAPA_PRIORIDADE[n.prioridade] || {}).peso || 0; };
    var prazoOrd = function (n) { return n.prazo || '9999-12-31'; };

    copia.sort(function (a, b) {
      // concluídas sempre descem
      if (a.concluida !== b.concluida) return a.concluida ? 1 : -1;
      // fixadas sempre sobem (exceto na ordenação manual, que é a do usuário)
      if (modo !== 'manual' && a.fixada !== b.fixada) return a.fixada ? -1 : 1;

      switch (modo) {
        case 'prazo':
          if (prazoOrd(a) !== prazoOrd(b)) return prazoOrd(a) < prazoOrd(b) ? -1 : 1;
          return peso(b) - peso(a);
        case 'recentes':
          return a.atualizadaEm < b.atualizadaEm ? 1 : -1;
        case 'criacao':
          return a.criadaEm < b.criadaEm ? 1 : -1;
        case 'alfabetica':
          return (a.titulo || '￿').localeCompare(b.titulo || '￿', 'pt-BR');
        case 'manual':
          return a.ordem - b.ordem;
        default: // prioridade
          if (peso(a) !== peso(b)) return peso(b) - peso(a);
          if (prazoOrd(a) !== prazoOrd(b)) return prazoOrd(a) < prazoOrd(b) ? -1 : 1;
          return a.ordem - b.ordem;
      }
    });
    return copia;
  }

  function contar(filtro) {
    return Store.estado.notas.filter(function (n) { return passaFiltro(n, filtro); }).length;
  }

  /* =========================================================== estado UI */

  var ui = {
    busca: '',
    notaAberta: null,
    arrastando: null,
    confirmarResolve: null,
    salvarTimer: null
  };

  /* ============================================================== toasts */

  function toast(mensagem, acao, duracao) {
    var caixa = $('#toasts');
    var el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = '<span>' + esc(mensagem) + '</span>';
    if (acao) {
      var btn = document.createElement('button');
      btn.textContent = acao.rotulo;
      btn.addEventListener('click', function () {
        acao.fn();
        remover();
      });
      el.appendChild(btn);
    }
    caixa.appendChild(el);

    var timer = setTimeout(remover, duracao || (acao ? 6000 : 3000));
    function remover() {
      clearTimeout(timer);
      if (!el.parentNode) return;
      el.classList.add('saindo');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 200);
    }
    return remover;
  }

  function confirmar(texto, rotuloSim) {
    $('#confirmaTexto').textContent = texto;
    $('#confirmaSim').textContent = rotuloSim || 'Confirmar';
    abrirModal('#modalConfirma');
    return new Promise(function (resolve) { ui.confirmarResolve = resolve; });
  }

  function abrirModal(sel) { $(sel).classList.add('visivel'); }
  function fecharModal(sel) { $(sel).classList.remove('visivel'); }

  /* ============================================================ renderers */

  function renderLateral() {
    var prefs = Store.estado.prefs;

    function itemHTML(f, ativo, cont, pontoCor) {
      return '<button class="item' + (ativo ? ' ativo' : '') + '" data-filtro="' + f.id + '">' +
        (pontoCor
          ? '<span class="ponto" style="background:' + pontoCor + '"></span>'
          : '<span class="item__icone">' + f.icone + '</span>') +
        '<span class="item__rotulo">' + esc(f.nome) + '</span>' +
        (cont ? '<span class="item__cont">' + cont + '</span>' : '') +
        '</button>';
    }

    $('#filtrosRapidos').innerHTML = FILTROS_RAPIDOS.map(function (f) {
      return itemHTML(f, prefs.filtro === f.id, contar(f.id));
    }).join('');

    $('#filtrosPrioridade').innerHTML = Store.PRIORIDADES.map(function (p) {
      var id = 'prio:' + p.id;
      return itemHTML({ id: id, nome: p.nome }, prefs.filtro === id, contar(id), p.cor);
    }).join('');

    $('#filtrosGuardados').innerHTML = FILTROS_GUARDADOS.map(function (f) {
      return itemHTML(f, prefs.filtro === f.id, contar(f.id));
    }).join('');

    var cadernos = Store.estado.cadernos.slice().sort(function (a, b) { return a.ordem - b.ordem; });
    $('#listaCadernos').innerHTML = cadernos.length
      ? cadernos.map(function (c) {
          var n = Store.estado.notas.filter(function (x) {
            return x.cadernoId === c.id && !x.naLixeira && !x.arquivada;
          }).length;
          return '<button class="item' + (prefs.cadernoAtivo === c.id ? ' ativo' : '') + '" data-caderno="' + c.id + '">' +
            '<span class="ponto" style="background:' + c.cor + '"></span>' +
            '<span class="item__rotulo">' + esc(c.nome) + '</span>' +
            '<span class="item__cont">' + n + '</span></button>';
        }).join('')
      : '<p style="padding:4px 9px;font-size:12px;color:var(--tinta-fraca)">Nenhum caderno ainda.</p>';

    $('#listaEtiquetas').innerHTML = Store.estado.etiquetas.length
      ? Store.estado.etiquetas.map(function (e) {
          var n = Store.estado.notas.filter(function (x) {
            return x.etiquetas.indexOf(e.id) >= 0 && !x.naLixeira && !x.arquivada;
          }).length;
          return '<button class="item' + (prefs.etiquetaAtiva === e.id ? ' ativo' : '') + '" data-etiqueta="' + e.id + '">' +
            '<span class="ponto ponto--anel" style="color:' + e.cor + '"></span>' +
            '<span class="item__rotulo">' + esc(e.nome) + '</span>' +
            '<span class="item__cont">' + n + '</span></button>';
        }).join('')
      : '<p style="padding:4px 9px;font-size:12px;color:var(--tinta-fraca)">Nenhuma etiqueta ainda.</p>';

    var nome = Store.estado.perfil.nome || 'Meu espaço';
    $('#perfilNome').textContent = nome;
    $('#avatar').textContent = nome.trim().slice(0, 2).toUpperCase();
    $('#perfilPlano').textContent = 'Plano ' + (Store.estado.perfil.plano === 'pro' ? 'Pro' : 'Free');
  }

  function renderBarraFiltros() {
    var prefs = Store.estado.prefs;
    var partes = [];

    if (prefs.cadernoAtivo) {
      var c = Store.obterCaderno(prefs.cadernoAtivo);
      if (c) partes.push('<button class="chip ativo" data-limpar="caderno" style="background:' + c.cor +
        '22;color:' + c.cor + '"><span class="chip__ponto" style="background:' + c.cor + '"></span>' +
        esc(c.nome) + '<span class="chip__x">&times;</span></button>');
    }
    if (prefs.etiquetaAtiva) {
      var e = Store.obterEtiqueta(prefs.etiquetaAtiva);
      if (e) partes.push('<button class="chip ativo" data-limpar="etiqueta" style="background:' + e.cor +
        '22;color:' + e.cor + '"><span class="chip__ponto" style="background:' + e.cor + '"></span>' +
        esc(e.nome) + '<span class="chip__x">&times;</span></button>');
    }

    partes.push('<button class="chip' + (prefs.ocultarConcluidas ? ' ativo' : '') + '" data-toggle="ocultarConcluidas"' +
      (prefs.ocultarConcluidas ? ' style="background:var(--marca-fraca);color:var(--marca-forte)"' : '') +
      '>' + (prefs.ocultarConcluidas ? 'Concluídas ocultas' : 'Mostrando concluídas') + '</button>');

    partes.push(
      '<div class="barra-filtros__dir">' +
        '<select class="seletor" id="ordenacao" aria-label="Ordenar por">' +
          [['prioridade', 'Prioridade'], ['prazo', 'Prazo'], ['recentes', 'Editadas há pouco'],
           ['criacao', 'Mais recentes'], ['alfabetica', 'A → Z'], ['manual', 'Ordem manual']]
            .map(function (o) {
              return '<option value="' + o[0] + '"' + (prefs.ordenacao === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
            }).join('') +
        '</select>' +
      '</div>');

    $('#barraFiltros').innerHTML = partes.join('');
  }

  function renderResumo() {
    var ativas = Store.estado.notas.filter(function (n) { return !n.naLixeira && !n.arquivada; });
    var abertas = ativas.filter(function (n) { return !n.concluida; });
    var quentes = abertas.filter(function (n) { return n.prioridade === 'urgente' || n.prioridade === 'alta'; });
    var hoje = abertas.filter(function (n) { return n.prazo && n.prazo <= hojeISO(); });
    var atrasadas = abertas.filter(function (n) { return n.prazo && n.prazo < hojeISO(); });

    var cards = [
      { rot: 'Em aberto', num: abertas.length, cor: 'var(--tinta)', filtro: 'todas' },
      { rot: 'Urgente + alta', num: quentes.length, cor: 'var(--p-urgente)', filtro: 'prio:urgente' },
      { rot: 'Para hoje', num: hoje.length, cor: 'var(--p-alta)', filtro: 'hoje' },
      { rot: 'Atrasadas', num: atrasadas.length, cor: atrasadas.length ? 'var(--p-urgente)' : 'var(--tinta-fraca)', filtro: 'atrasadas' }
    ];

    $('#resumo').innerHTML = cards.map(function (c) {
      return '<button class="resumo__card" data-filtro="' + c.filtro + '">' +
        '<span class="resumo__rot">' + c.rot + '</span>' +
        '<span class="resumo__num" style="color:' + c.cor + '">' + c.num + '</span></button>';
    }).join('');
  }

  function etiquetaHTML(id) {
    var e = Store.obterEtiqueta(id);
    if (!e) return '';
    return '<span class="etq" style="background:' + e.cor + '1f;color:' + e.cor + '">' +
      '<span class="etq__ponto"></span>' + esc(e.nome) + '</span>';
  }

  function cartaoHTML(nota) {
    var p = Store.MAPA_PRIORIDADE[nota.prioridade] || Store.MAPA_PRIORIDADE.nenhuma;
    var feitos = nota.checklist.filter(function (i) { return i.feito; }).length;
    var total = nota.checklist.length;
    var termo = ui.busca.trim();
    var naLixeira = nota.naLixeira;

    var html = '<article class="nota' + (nota.concluida ? ' concluida' : '') +
      (ui.notaAberta === nota.id ? ' selecionada' : '') + '"' +
      ' style="--cor-prio:' + p.cor + '" data-nota="' + nota.id + '" draggable="true" tabindex="0">';

    html += '<div class="nota__topo">';
    if (!naLixeira) {
      html += '<button class="caixa' + (nota.concluida ? ' marcada' : '') + '" data-acao="concluir" ' +
        'aria-label="' + (nota.concluida ? 'Reabrir' : 'Concluir') + ' tarefa">' + icone('check') + '</button>';
    }
    html += '<h3 class="nota__titulo">' + realcar(nota.titulo, termo) + '</h3>';
    if (nota.fixada) html += '<span class="nota__pin" title="Fixada">' + icone('pin') + '</span>';
    html += '</div>';

    if (nota.conteudo) {
      html += '<p class="nota__corpo">' + realcar(nota.conteudo, termo) + '</p>';
    }

    if (total) {
      html += '<div class="nota__progresso"><div class="nota__barra"><i style="width:' +
        Math.round((feitos / total) * 100) + '%"></i></div><span>' + feitos + '/' + total + '</span></div>';
    }

    var pe = [];
    if (nota.prioridade !== 'nenhuma') {
      pe.push('<span class="etq etq--prio" style="background:' + p.cor + '1f;color:' + p.cor + '">' +
        '<span class="etq__ponto"></span>' + p.nome + '</span>');
    }
    if (nota.prazo) {
      var d = diffDias(nota.prazo);
      var classe = d < 0 && !nota.concluida ? ' prazo--atrasado' : (d === 0 && !nota.concluida ? ' prazo--hoje' : '');
      pe.push('<span class="prazo' + classe + '">' + icone('relogio') + rotuloPrazo(nota.prazo) + '</span>');
    }
    nota.etiquetas.forEach(function (id) { pe.push(etiquetaHTML(id)); });
    var cad = Store.obterCaderno(nota.cadernoId);
    if (cad) {
      pe.push('<span class="etq" style="background:transparent;color:var(--tinta-fraca);border:1px solid var(--linha)">' +
        '<span class="etq__ponto" style="background:' + cad.cor + '"></span>' + esc(cad.nome) + '</span>');
    }
    if (pe.length) html += '<div class="nota__pe">' + pe.join('') + '</div>';

    html += '<div class="nota__acoes">';
    if (naLixeira) {
      html += '<button data-acao="restaurar" title="Restaurar">' + icone('voltar') + '</button>' +
        '<button data-acao="apagar" class="perigo" title="Excluir para sempre">' + icone('lixo') + '</button>';
    } else {
      html += '<button data-acao="fixar" title="' + (nota.fixada ? 'Desafixar' : 'Fixar') + '">' + icone('pin') + '</button>' +
        '<button data-acao="arquivar" title="' + (nota.arquivada ? 'Desarquivar' : 'Arquivar') + '">' + icone('arquivo') + '</button>' +
        '<button data-acao="lixeira" class="perigo" title="Mover para a lixeira">' + icone('lixo') + '</button>';
    }
    html += '</div></article>';

    return html;
  }

  function vazioHTML(emoji, titulo, texto, botao) {
    return '<div class="vazio"><div class="vazio__icone">' + emoji + '</div>' +
      '<h3>' + esc(titulo) + '</h3><p>' + esc(texto) + '</p>' +
      (botao || '') + '</div>';
  }

  function renderArea() {
    var prefs = Store.estado.prefs;
    var lista = notasVisiveis();
    var area = $('#area');
    var termo = ui.busca.trim();

    // cabeçalho
    var desc = termo
      ? { nome: 'Resultados da busca', sub: plural(lista.length, 'nota encontrada', 'notas encontradas') + ' para "' + termo + '"' }
      : descreveFiltro(prefs.filtro);
    $('#tituloVista').textContent = desc.nome;

    var abertas = lista.filter(function (n) { return !n.concluida; }).length;
    var feitas = lista.length - abertas;
    var sub = desc.sub;
    if (!termo && lista.length) {
      sub = plural(abertas, 'nota em aberto', 'notas em aberto') +
        (feitas ? ' · ' + plural(feitas, 'concluída', 'concluídas') : '') + ' · ' + desc.sub;
    }
    $('#subtituloVista').textContent = sub;

    // estado vazio
    if (!lista.length) {
      if (termo) {
        area.innerHTML = vazioHTML('🔍', 'Nada encontrado',
          'Nenhuma nota combina com "' + termo + '". Tente outra palavra ou limpe a busca.',
          '<button class="btn btn--fantasma" id="vazioLimpar">Limpar busca</button>');
        var bl = $('#vazioLimpar');
        if (bl) bl.addEventListener('click', function () { definirBusca(''); });
      } else if (prefs.filtro === 'lixeira') {
        area.innerHTML = vazioHTML('🗑️', 'Lixeira vazia', 'Nada aqui. Notas que você excluir aparecem nesta lista antes de sumir de vez.');
      } else {
        area.innerHTML = vazioHTML('📝', 'Nenhuma nota por aqui',
          descreveFiltro(prefs.filtro).sub + '. Que tal começar uma agora?',
          '<button class="btn btn--principal" id="vazioNova">' + icone('mais') + ' Criar primeira nota</button>');
        var bn = $('#vazioNova');
        if (bn) bn.addEventListener('click', function () { criarNota(); });
      }
      return;
    }

    if (prefs.visualizacao === 'quadro') {
      renderQuadro(lista);
    } else {
      area.className = '';
      area.innerHTML = '<div class="notas notas--' + (prefs.visualizacao === 'lista' ? 'lista' : 'grade') + '">' +
        lista.map(cartaoHTML).join('') + '</div>';
    }

    if (prefs.filtro === 'lixeira') renderBotaoEsvaziar();
  }

  function renderBotaoEsvaziar() {
    var alvo = $('#area');
    var barra = document.createElement('div');
    barra.style.cssText = 'margin-top:18px;display:flex;justify-content:center';
    barra.innerHTML = '<button class="btn btn--perigo btn--pequeno" id="esvaziarLixeira">' +
      icone('lixo') + ' Esvaziar lixeira</button>';
    alvo.appendChild(barra);
    $('#esvaziarLixeira').addEventListener('click', function () {
      confirmar('Isso apaga para sempre todas as notas da lixeira. Não dá para desfazer.', 'Apagar tudo')
        .then(function (ok) {
          if (!ok) return;
          var n = Store.esvaziarLixeira();
          toast(plural(n, 'nota apagada', 'notas apagadas') + ' definitivamente.');
        });
    });
  }

  function renderQuadro(lista) {
    var area = $('#area');
    var colunas = Store.PRIORIDADES.map(function (p) {
      var doGrupo = lista.filter(function (n) { return n.prioridade === p.id; });
      return '<section class="coluna" data-coluna="' + p.id + '">' +
        '<header class="coluna__topo" style="color:' + p.cor + '">' +
          '<span class="ponto" style="background:' + p.cor + '"></span>' + p.nome +
          '<span class="item__cont">' + doGrupo.length + '</span>' +
        '</header>' +
        '<div class="coluna__lista">' +
          (doGrupo.length
            ? doGrupo.map(cartaoHTML).join('')
            : '<p class="coluna__vazia">Arraste notas para cá</p>') +
        '</div></section>';
    }).join('');
    area.innerHTML = '<div class="quadro">' + colunas + '</div>';
  }

  function renderTudo() {
    renderLateral();
    renderBarraFiltros();
    renderResumo();
    renderArea();
    sincronizarBotoesVisualizacao();
  }

  function sincronizarBotoesVisualizacao() {
    var v = Store.estado.prefs.visualizacao;
    $('#visGrade').classList.toggle('ativo', v === 'grade');
    $('#visLista').classList.toggle('ativo', v === 'lista');
    $('#visQuadro').classList.toggle('ativo', v === 'quadro');
  }

  /* ============================================================== editor */

  function abrirEditor(id) {
    gravarPendente();
    var nota = Store.obterNota(id);
    if (!nota) return;
    ui.notaAberta = id;

    $('#editorTitulo').value = nota.titulo;
    $('#editorTexto').value = nota.conteudo;
    $('#editorPrazo').value = nota.prazo || '';
    $('#editorEstado').textContent = nota.naLixeira ? 'Na lixeira' : (nota.arquivada ? 'Arquivada' : (nota.concluida ? 'Concluída' : 'Editando'));
    $('#editorFixar').classList.toggle('ativo', nota.fixada);
    $('#editorMeta').innerHTML = 'Criada em ' + dataCurta(nota.criadaEm) + '<br>Editada em ' + dataCurta(nota.atualizadaEm);
    $('#editorArquivar').innerHTML = icone('arquivo') + (nota.arquivada ? ' Desarquivar' : ' Arquivar');

    $('#editorCaderno').innerHTML = '<option value="">Sem caderno</option>' +
      Store.estado.cadernos.map(function (c) {
        return '<option value="' + c.id + '"' + (nota.cadernoId === c.id ? ' selected' : '') + '>' + esc(c.nome) + '</option>';
      }).join('');

    $('#editorPrioridades').innerHTML = Store.PRIORIDADES.map(function (p) {
      var ativo = nota.prioridade === p.id;
      return '<button class="prio-btn' + (ativo ? ' ativo' : '') + '" data-prio="' + p.id + '"' +
        (ativo ? ' style="background:' + p.cor + '1f;color:' + p.cor + '"' : '') + '>' +
        '<span class="ponto" style="background:' + p.cor + '"></span>' + p.nome + '</button>';
    }).join('');

    renderEtiquetasEditor(nota);
    renderChecklistEditor(nota);

    $('#editor').classList.add('aberto');
    $('#cortina').classList.add('visivel');
    $('.app').classList.add('com-editor');
    autoAltura($('#editorTitulo'));
    autoAltura($('#editorTexto'));
    renderArea();

    if (!nota.titulo && !nota.conteudo) setTimeout(function () { $('#editorTitulo').focus(); }, 180);
  }

  function renderEtiquetasEditor(nota) {
    $('#editorEtiquetas').innerHTML = Store.estado.etiquetas.length
      ? Store.estado.etiquetas.map(function (e) {
          var ativa = nota.etiquetas.indexOf(e.id) >= 0;
          return '<button class="etq' + (ativa ? '' : ' inativa') + '" data-etq="' + e.id + '"' +
            ' style="background:' + e.cor + '26;color:' + e.cor + '">' +
            '<span class="etq__ponto"></span>' + esc(e.nome) + '</button>';
        }).join('')
      : '<p style="font-size:12.5px;color:var(--tinta-fraca)">Nenhuma etiqueta criada ainda.</p>';
  }

  function renderChecklistEditor(nota) {
    var feitos = nota.checklist.filter(function (i) { return i.feito; }).length;
    $('#editorChkContador').textContent = nota.checklist.length ? '(' + feitos + '/' + nota.checklist.length + ')' : '';
    $('#editorChecklist').innerHTML = nota.checklist.map(function (item) {
      return '<div class="chk-item' + (item.feito ? ' feito' : '') + '" data-item="' + item.id + '">' +
        '<button class="chk-item__caixa' + (item.feito ? ' marcada' : '') + '" data-chk="alternar" aria-label="Alternar item">' +
          icone('check') + '</button>' +
        '<span class="chk-item__txt">' + esc(item.texto) + '</span>' +
        '<button class="chk-item__x" data-chk="remover" aria-label="Remover item">&times;</button></div>';
    }).join('');
  }

  function fecharEditor() {
    gravarPendente();
    ui.notaAberta = null;
    $('#editor').classList.remove('aberto');
    $('#cortina').classList.remove('visivel');
    $('#lateral').classList.remove('aberta');
    $('.app').classList.remove('com-editor');
    renderTudo();
  }

  function autoAltura(el) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  /*
   * Título e corpo dividem o mesmo atraso de digitação. Guardamos as mudanças
   * num acumulador e gravamos todas juntas — se cada campo tivesse seu próprio
   * timer solto, o segundo campo cancelaria a gravação pendente do primeiro e
   * o texto se perdia.
   */
  var pendente = { id: null, mudancas: {} };

  function salvarCampo(campo, valor) {
    if (!ui.notaAberta) return;
    if (pendente.id && pendente.id !== ui.notaAberta) gravarPendente();
    pendente.id = ui.notaAberta;
    pendente.mudancas[campo] = valor;
    clearTimeout(ui.salvarTimer);
    ui.salvarTimer = setTimeout(gravarPendente, 320);
  }

  function gravarPendente() {
    clearTimeout(ui.salvarTimer);
    ui.salvarTimer = null;
    if (!pendente.id) return;

    var id = pendente.id;
    var mudancas = pendente.mudancas;
    pendente = { id: null, mudancas: {} };
    if (!Object.keys(mudancas).length) return;

    Store.atualizarNota(id, mudancas);
    var nota = Store.obterNota(id);
    if (nota && ui.notaAberta === id) {
      $('#editorMeta').innerHTML = 'Criada em ' + dataCurta(nota.criadaEm) +
        '<br>Editada em ' + dataCurta(nota.atualizadaEm);
    }
    renderLateral();
    renderResumo();
    renderArea();
  }

  /* ============================================================== ações */

  function criarNota(extras) {
    var prefs = Store.estado.prefs;
    var base = {
      cadernoId: prefs.cadernoAtivo || null,
      etiquetas: prefs.etiquetaAtiva ? [prefs.etiquetaAtiva] : [],
      prioridade: prefs.filtro.indexOf('prio:') === 0 ? prefs.filtro.slice(5) : 'nenhuma'
    };
    if (prefs.filtro === 'hoje') base.prazo = hojeISO();
    if (prefs.filtro === 'semana') base.prazo = maisDias(7);
    if (prefs.filtro === 'fixadas') base.fixada = true;

    var nota = Store.criarNota(Object.assign(base, extras || {}));
    if (['concluidas', 'arquivadas', 'lixeira'].indexOf(prefs.filtro) >= 0) {
      Store.definirPref('filtro', 'todas');
    }
    definirBusca('');
    renderTudo();
    abrirEditor(nota.id);
    return nota;
  }

  function definirBusca(valor) {
    ui.busca = valor;
    $('#busca').value = valor;
    $('#limparBusca').classList.toggle('oculto', !valor);
    renderArea();
  }

  function acaoNoCartao(acao, id) {
    var nota = Store.obterNota(id);
    if (!nota) return;

    switch (acao) {
      case 'concluir':
        var estavaConcluida = nota.concluida;
        Store.alternarConcluida(id);
        if (!estavaConcluida) toast('Concluída: ' + (nota.titulo || 'nota sem título'), {
          rotulo: 'Desfazer',
          fn: function () { Store.atualizarNota(id, { concluida: false }); renderTudo(); }
        });
        break;
      case 'fixar':
        Store.alternarFixada(id);
        break;
      case 'arquivar':
        var estavaArquivada = nota.arquivada;
        Store.arquivarNota(id, !estavaArquivada);
        toast(estavaArquivada ? 'Nota desarquivada.' : 'Nota arquivada.', {
          rotulo: 'Desfazer',
          fn: function () { Store.arquivarNota(id, estavaArquivada); renderTudo(); }
        });
        break;
      case 'lixeira':
        Store.enviarParaLixeira(id);
        if (ui.notaAberta === id) fecharEditor();
        toast('Movida para a lixeira.', {
          rotulo: 'Desfazer',
          fn: function () { Store.restaurarNota(id); renderTudo(); }
        });
        break;
      case 'restaurar':
        Store.restaurarNota(id);
        toast('Nota restaurada.');
        break;
      case 'apagar':
        confirmar('Excluir "' + (nota.titulo || 'nota sem título') + '" para sempre? Não dá para desfazer.', 'Excluir')
          .then(function (ok) {
            if (!ok) return;
            Store.excluirDefinitivamente(id);
            if (ui.notaAberta === id) fecharEditor();
            toast('Nota excluída definitivamente.');
            renderTudo();
          });
        return;
    }
    renderTudo();
  }

  /* =========================================================== tema ==== */

  function aplicarTema() {
    var pref = Store.estado.prefs.tema;
    var escuro = pref === 'escuro' ||
      (pref === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.tema = escuro ? 'escuro' : 'claro';
    $('#alternarTema').innerHTML = icone(escuro ? 'sol' : 'lua');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = escuro ? '#121214' : '#5a4fcf';
  }

  function alternarTema() {
    var atual = document.documentElement.dataset.tema;
    Store.definirPref('tema', atual === 'escuro' ? 'claro' : 'escuro');
    aplicarTema();
    sincronizarConfig();
  }

  /* ====================================================== configurações */

  function sincronizarConfig() {
    $('#cfgNome').value = Store.estado.perfil.nome || '';
    $$('#cfgTema button').forEach(function (b) {
      b.classList.toggle('ativo', b.dataset.tema === Store.estado.prefs.tema);
    });

    $('#cfgCadernos').innerHTML = Store.estado.cadernos.map(function (c) {
      return '<div class="lista-gerencia__item" data-cad="' + c.id + '">' +
        '<span class="ponto" style="background:' + c.cor + '"></span>' +
        '<input value="' + esc(c.nome) + '" data-campo="nome" maxlength="30">' +
        '<button class="icone-btn" data-remover title="Excluir caderno">' + icone('lixo') + '</button></div>';
    }).join('') || '<p style="font-size:12.5px;color:var(--tinta-fraca);padding:4px">Nenhum caderno.</p>';

    $('#cfgEtiquetas').innerHTML = Store.estado.etiquetas.map(function (e) {
      return '<div class="lista-gerencia__item" data-etq="' + e.id + '">' +
        '<span class="ponto ponto--anel" style="color:' + e.cor + '"></span>' +
        '<input value="' + esc(e.nome) + '" data-campo="nome" maxlength="30">' +
        '<button class="icone-btn" data-remover title="Excluir etiqueta">' + icone('lixo') + '</button></div>';
    }).join('') || '<p style="font-size:12.5px;color:var(--tinta-fraca);padding:4px">Nenhuma etiqueta.</p>';
  }

  function baixarBackup() {
    var conteudo = Store.exportar();
    var blob = new Blob([conteudo], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'prioriza-backup-' + hojeISO() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('Backup baixado.');
  }

  /* ======================================================== drag & drop */

  function ligarArrasto() {
    var conteudo = $('#conteudo');

    conteudo.addEventListener('dragstart', function (ev) {
      var card = ev.target.closest('[data-nota]');
      if (!card) return;
      ui.arrastando = card.dataset.nota;
      card.classList.add('arrastando');
      ev.dataTransfer.effectAllowed = 'move';
      try { ev.dataTransfer.setData('text/plain', ui.arrastando); } catch (e) { /* IE */ }
    });

    conteudo.addEventListener('dragend', function () {
      ui.arrastando = null;
      $$('.arrastando').forEach(function (el) { el.classList.remove('arrastando'); });
      $$('.recebendo').forEach(function (el) { el.classList.remove('recebendo'); });
      $$('.alvo-drop').forEach(function (el) { el.classList.remove('alvo-drop'); });
    });

    conteudo.addEventListener('dragover', function (ev) {
      if (!ui.arrastando) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';

      var coluna = ev.target.closest('[data-coluna]');
      $$('.recebendo').forEach(function (el) { if (el !== coluna) el.classList.remove('recebendo'); });
      if (coluna) coluna.classList.add('recebendo');

      var card = ev.target.closest('[data-nota]');
      $$('.alvo-drop').forEach(function (el) { if (el !== card) el.classList.remove('alvo-drop'); });
      if (card && card.dataset.nota !== ui.arrastando && Store.estado.prefs.ordenacao === 'manual') {
        card.classList.add('alvo-drop');
      }
    });

    conteudo.addEventListener('drop', function (ev) {
      if (!ui.arrastando) return;
      ev.preventDefault();
      var id = ui.arrastando;

      var coluna = ev.target.closest('[data-coluna]');
      if (coluna) {
        var nova = coluna.dataset.coluna;
        var nota = Store.obterNota(id);
        if (nota && nota.prioridade !== nova) {
          Store.atualizarNota(id, { prioridade: nova });
          toast('Prioridade alterada para ' + Store.MAPA_PRIORIDADE[nova].nome.toLowerCase() + '.');
        }
        renderTudo();
        return;
      }

      var destino = ev.target.closest('[data-nota]');
      if (!destino || destino.dataset.nota === id) return;

      if (Store.estado.prefs.ordenacao !== 'manual') {
        // sem isso o arrasto simplesmente não faz nada e parece defeito
        toast('Para reordenar arrastando, troque a ordenação para "Ordem manual".', {
          rotulo: 'Trocar agora',
          fn: function () { Store.definirPref('ordenacao', 'manual'); renderTudo(); }
        });
        return;
      }

      var ids = notasVisiveis().map(function (n) { return n.id; });
      var de = ids.indexOf(id);
      if (de >= 0) ids.splice(de, 1);
      var para = ids.indexOf(destino.dataset.nota);
      ids.splice(para < 0 ? ids.length : para, 0, id);
      Store.reordenarNotas(ids);
      renderTudo();
    });
  }

  /* ============================================================ eventos */

  function ligarEventos() {

    /* --- lateral --- */
    $('#lateral').addEventListener('click', function (ev) {
      var alvo = ev.target.closest('[data-filtro],[data-caderno],[data-etiqueta]');
      if (!alvo) return;

      if (alvo.dataset.filtro) {
        Store.definirPref('filtro', alvo.dataset.filtro);
      } else if (alvo.dataset.caderno) {
        var cad = alvo.dataset.caderno;
        Store.definirPref('cadernoAtivo', Store.estado.prefs.cadernoAtivo === cad ? null : cad);
      } else if (alvo.dataset.etiqueta) {
        var etq = alvo.dataset.etiqueta;
        Store.definirPref('etiquetaAtiva', Store.estado.prefs.etiquetaAtiva === etq ? null : etq);
      }
      definirBusca('');
      $('#lateral').classList.remove('aberta');
      $('#conteudo').scrollTop = 0;
      renderTudo();
    });

    $('#novoCaderno').addEventListener('click', function (ev) {
      ev.stopPropagation();
      sincronizarConfig();
      abrirModal('#modalConfig');
      setTimeout(function () { $('#cfgNovoCaderno').focus(); }, 120);
    });

    $('#gerenciarEtiquetas').addEventListener('click', function (ev) {
      ev.stopPropagation();
      sincronizarConfig();
      abrirModal('#modalConfig');
      setTimeout(function () { $('#cfgNovaEtiqueta').focus(); }, 120);
    });

    $('#abrirLateral').addEventListener('click', function () {
      $('#lateral').classList.add('aberta');
      $('#cortina').classList.add('visivel');
    });
    $('#fecharLateral').addEventListener('click', function () {
      $('#lateral').classList.remove('aberta');
      $('#cortina').classList.remove('visivel');
    });
    $('#cortina').addEventListener('click', function () {
      $('#lateral').classList.remove('aberta');
      if (ui.notaAberta) fecharEditor();
      else $('#cortina').classList.remove('visivel');
    });

    /* --- topo --- */
    $('#busca').addEventListener('input', function () { definirBusca(this.value); });
    $('#limparBusca').addEventListener('click', function () { definirBusca(''); $('#busca').focus(); });
    $('#novaNota').addEventListener('click', function () { criarNota(); });
    $('#alternarTema').addEventListener('click', alternarTema);
    $('#abrirAtalhos').addEventListener('click', function () { abrirModal('#modalAtalhos'); });

    ['grade', 'lista', 'quadro'].forEach(function (v) {
      $('#vis' + v.charAt(0).toUpperCase() + v.slice(1)).addEventListener('click', function () {
        Store.definirPref('visualizacao', v);
        renderTudo();
      });
    });

    /* --- barra de filtros --- */
    $('#barraFiltros').addEventListener('click', function (ev) {
      var limpar = ev.target.closest('[data-limpar]');
      if (limpar) {
        Store.definirPref(limpar.dataset.limpar === 'caderno' ? 'cadernoAtivo' : 'etiquetaAtiva', null);
        renderTudo();
        return;
      }
      var toggle = ev.target.closest('[data-toggle]');
      if (toggle) {
        Store.definirPref('ocultarConcluidas', !Store.estado.prefs.ocultarConcluidas);
        renderTudo();
      }
    });

    $('#barraFiltros').addEventListener('change', function (ev) {
      if (ev.target.id === 'ordenacao') {
        Store.definirPref('ordenacao', ev.target.value);
        renderTudo();
      }
    });

    /* --- área de notas --- */
    $('#conteudo').addEventListener('click', function (ev) {
      var resumo = ev.target.closest('[data-filtro]');
      if (resumo) {
        Store.definirPref('filtro', resumo.dataset.filtro);
        definirBusca('');
        renderTudo();
        return;
      }

      var botao = ev.target.closest('[data-acao]');
      var card = ev.target.closest('[data-nota]');
      if (!card) return;

      if (botao) {
        ev.stopPropagation();
        acaoNoCartao(botao.dataset.acao, card.dataset.nota);
        return;
      }
      abrirEditor(card.dataset.nota);
    });

    $('#conteudo').addEventListener('keydown', function (ev) {
      var card = ev.target.closest('[data-nota]');
      if (!card) return;
      if (ev.key === 'Enter') { ev.preventDefault(); abrirEditor(card.dataset.nota); }
      if (ev.key === ' ') { ev.preventDefault(); acaoNoCartao('concluir', card.dataset.nota); }
    });

    /* --- editor --- */
    $('#editorFechar').addEventListener('click', fecharEditor);

    $('#editorTitulo').addEventListener('input', function () {
      autoAltura(this);
      salvarCampo('titulo', this.value);
    });
    $('#editorTitulo').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); $('#editorTexto').focus(); }
    });

    $('#editorTexto').addEventListener('input', function () {
      autoAltura(this);
      salvarCampo('conteudo', this.value);
    });

    $('#editorPrioridades').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-prio]');
      if (!btn || !ui.notaAberta) return;
      gravarPendente();
      Store.atualizarNota(ui.notaAberta, { prioridade: btn.dataset.prio });
      abrirEditor(ui.notaAberta);
      renderLateral();
      renderResumo();
    });

    $('#editorEtiquetas').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-etq]');
      if (!btn || !ui.notaAberta) return;
      var nota = Store.obterNota(ui.notaAberta);
      var id = btn.dataset.etq;
      var i = nota.etiquetas.indexOf(id);
      if (i >= 0) nota.etiquetas.splice(i, 1);
      else nota.etiquetas.push(id);
      Store.atualizarNota(ui.notaAberta, { etiquetas: nota.etiquetas });
      renderEtiquetasEditor(nota);
      renderLateral();
      renderArea();
    });

    function criarEtiquetaDoEditor() {
      var campo = $('#novaEtiquetaTxt');
      var nome = campo.value.trim();
      if (!nome || !ui.notaAberta) return;
      var etq = Store.criarEtiqueta(nome);
      var nota = Store.obterNota(ui.notaAberta);
      if (etq && nota.etiquetas.indexOf(etq.id) < 0) {
        nota.etiquetas.push(etq.id);
        Store.atualizarNota(ui.notaAberta, { etiquetas: nota.etiquetas });
      }
      campo.value = '';
      renderEtiquetasEditor(nota);
      renderLateral();
      renderArea();
    }
    $('#novaEtiquetaBtn').addEventListener('click', criarEtiquetaDoEditor);
    $('#novaEtiquetaTxt').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); criarEtiquetaDoEditor(); }
    });

    $('#editorCaderno').addEventListener('change', function () {
      if (!ui.notaAberta) return;
      Store.atualizarNota(ui.notaAberta, { cadernoId: this.value || null });
      renderLateral();
      renderArea();
    });

    $('#editorPrazo').addEventListener('change', function () {
      if (!ui.notaAberta) return;
      Store.atualizarNota(ui.notaAberta, { prazo: this.value || null });
      renderLateral();
      renderResumo();
      renderArea();
    });

    $$('.prazo-rapido .chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!ui.notaAberta) return;
        var d = this.dataset.prazo;
        var valor = d === '' ? null : maisDias(parseInt(d, 10));
        $('#editorPrazo').value = valor || '';
        Store.atualizarNota(ui.notaAberta, { prazo: valor });
        renderLateral();
        renderResumo();
        renderArea();
      });
    });

    function addItemChecklist() {
      var campo = $('#novoItemTxt');
      if (!campo.value.trim() || !ui.notaAberta) return;
      Store.adicionarItemChecklist(ui.notaAberta, campo.value);
      campo.value = '';
      renderChecklistEditor(Store.obterNota(ui.notaAberta));
      renderArea();
      campo.focus();
    }
    $('#novoItemBtn').addEventListener('click', addItemChecklist);
    $('#novoItemTxt').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); addItemChecklist(); }
    });

    $('#editorChecklist').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-chk]');
      var item = ev.target.closest('[data-item]');
      if (!btn || !item || !ui.notaAberta) return;
      if (btn.dataset.chk === 'alternar') Store.alternarItemChecklist(ui.notaAberta, item.dataset.item);
      else Store.removerItemChecklist(ui.notaAberta, item.dataset.item);
      renderChecklistEditor(Store.obterNota(ui.notaAberta));
      renderArea();
    });

    $('#editorFixar').addEventListener('click', function () {
      if (!ui.notaAberta) return;
      gravarPendente();
      Store.alternarFixada(ui.notaAberta);
      this.classList.toggle('ativo', Store.obterNota(ui.notaAberta).fixada);
      renderLateral();
      renderArea();
    });

    $('#editorDuplicar').addEventListener('click', function () {
      if (!ui.notaAberta) return;
      gravarPendente();
      var copia = Store.duplicarNota(ui.notaAberta);
      renderTudo();
      abrirEditor(copia.id);
      toast('Nota duplicada.');
    });

    $('#editorArquivar').addEventListener('click', function () {
      if (!ui.notaAberta) return;
      var id = ui.notaAberta;
      acaoNoCartao('arquivar', id);
      fecharEditor();
    });

    $('#editorExcluir').addEventListener('click', function () {
      if (!ui.notaAberta) return;
      gravarPendente();
      acaoNoCartao(Store.obterNota(ui.notaAberta).naLixeira ? 'apagar' : 'lixeira', ui.notaAberta);
    });

    /* --- modais --- */
    $$('[data-fechar-modal]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        this.closest('.modal-fundo').classList.remove('visivel');
      });
    });
    $$('.modal-fundo').forEach(function (fundo) {
      fundo.addEventListener('click', function (ev) {
        if (ev.target === fundo && fundo.id !== 'modalConfirma') fundo.classList.remove('visivel');
      });
    });

    $('#confirmaSim').addEventListener('click', function () {
      fecharModal('#modalConfirma');
      if (ui.confirmarResolve) ui.confirmarResolve(true);
      ui.confirmarResolve = null;
    });
    $('#confirmaNao').addEventListener('click', function () {
      fecharModal('#modalConfirma');
      if (ui.confirmarResolve) ui.confirmarResolve(false);
      ui.confirmarResolve = null;
    });

    /* --- configurações --- */
    $('#abrirConfig').addEventListener('click', function () { sincronizarConfig(); abrirModal('#modalConfig'); });
    $('#abrirConta').addEventListener('click', function () {
      sincronizarConfig();
      abrirModal('#modalConfig');
      setTimeout(function () { $('#cfgNome').focus(); }, 120);
    });

    $('#cfgNome').addEventListener('input', function () {
      Store.definirPerfil({ nome: this.value.trim() });
      renderLateral();
    });

    $('#cfgTema').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-tema]');
      if (!btn) return;
      Store.definirPref('tema', btn.dataset.tema);
      aplicarTema();
      sincronizarConfig();
    });

    $('#cfgAddCaderno').addEventListener('click', function () {
      var campo = $('#cfgNovoCaderno');
      if (!campo.value.trim()) return;
      var cor = Store.CORES_ETIQUETA[Store.estado.cadernos.length % Store.CORES_ETIQUETA.length];
      Store.criarCaderno(campo.value, cor);
      campo.value = '';
      sincronizarConfig();
      renderTudo();
    });

    $('#cfgAddEtiqueta').addEventListener('click', function () {
      var campo = $('#cfgNovaEtiqueta');
      if (!campo.value.trim()) return;
      Store.criarEtiqueta(campo.value);
      campo.value = '';
      sincronizarConfig();
      renderTudo();
    });

    ['cfgNovoCaderno', 'cfgNovaEtiqueta'].forEach(function (id) {
      $('#' + id).addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        $(id === 'cfgNovoCaderno' ? '#cfgAddCaderno' : '#cfgAddEtiqueta').click();
      });
    });

    $('#cfgCadernos').addEventListener('input', function (ev) {
      var linha = ev.target.closest('[data-cad]');
      if (linha && ev.target.dataset.campo === 'nome') {
        Store.renomearCaderno(linha.dataset.cad, ev.target.value);
        renderLateral();
      }
    });
    $('#cfgCadernos').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-remover]');
      if (!btn) return;
      var linha = btn.closest('[data-cad]');
      var cad = Store.obterCaderno(linha.dataset.cad);
      confirmar('Excluir o caderno "' + cad.nome + '"? As notas dele continuam existindo, só ficam sem caderno.', 'Excluir')
        .then(function (ok) {
          if (!ok) return;
          Store.excluirCaderno(linha.dataset.cad);
          sincronizarConfig();
          renderTudo();
        });
    });

    $('#cfgEtiquetas').addEventListener('input', function (ev) {
      var linha = ev.target.closest('[data-etq]');
      if (linha && ev.target.dataset.campo === 'nome') {
        Store.renomearEtiqueta(linha.dataset.etq, ev.target.value);
        renderLateral();
        renderArea();
      }
    });
    $('#cfgEtiquetas').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-remover]');
      if (!btn) return;
      var linha = btn.closest('[data-etq]');
      var etq = Store.obterEtiqueta(linha.dataset.etq);
      confirmar('Excluir a etiqueta "' + etq.nome + '"? Ela sai de todas as notas que a usam.', 'Excluir')
        .then(function (ok) {
          if (!ok) return;
          Store.excluirEtiqueta(linha.dataset.etq);
          sincronizarConfig();
          renderTudo();
        });
    });

    $('#cfgExportar').addEventListener('click', baixarBackup);
    $('#cfgImportar').addEventListener('click', function () { $('#arquivoImport').click(); });
    $('#arquivoImport').addEventListener('change', function () {
      var arquivo = this.files[0];
      if (!arquivo) return;
      var leitor = new FileReader();
      leitor.onload = function () {
        confirmar('Importar este backup substitui TUDO que está no app agora. Continuar?', 'Importar')
          .then(function (ok) {
            if (!ok) return;
            try {
              Store.importar(leitor.result);
              aplicarTema();
              sincronizarConfig();
              renderTudo();
              toast('Backup importado com sucesso.');
            } catch (e) {
              toast('Não consegui ler esse arquivo. Ele é um backup do Prioriza?');
            }
          });
      };
      leitor.readAsText(arquivo);
      this.value = '';
    });

    $('#cfgApagar').addEventListener('click', function () {
      confirmar('Isso apaga todas as notas, cadernos e etiquetas deste navegador. Não dá para desfazer — exporte um backup antes se quiser guardar.', 'Apagar tudo')
        .then(function (ok) {
          if (!ok) return;
          Store.reiniciar(false);
          aplicarTema();
          sincronizarConfig();
          fecharEditor();
          renderTudo();
          toast('Tudo apagado. Seu espaço está limpo.');
        });
    });

    /* --- atalhos --- */
    document.addEventListener('keydown', function (ev) {
      var emCampo = /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) || ev.target.isContentEditable;

      if (ev.key === 'Escape') {
        // fecha o modal de cima: com "Apagar tudo" há um confirmar sobre as configurações
        var modalAberto = $$('.modal-fundo.visivel').pop();
        if (modalAberto) {
          modalAberto.classList.remove('visivel');
          if (modalAberto.id === 'modalConfirma' && ui.confirmarResolve) {
            ui.confirmarResolve(false);
            ui.confirmarResolve = null;
          }
          return;
        }
        if (ui.notaAberta) { fecharEditor(); return; }
        if ($('#lateral').classList.contains('aberta')) {
          $('#lateral').classList.remove('aberta');
          $('#cortina').classList.remove('visivel');
          return;
        }
        if (ui.busca) { definirBusca(''); $('#busca').blur(); }
        return;
      }

      if (ev.ctrlKey || ev.metaKey) {
        if (ev.key === 'Enter' && ui.notaAberta) {
          ev.preventDefault();
          Store.alternarConcluida(ui.notaAberta);
          abrirEditor(ui.notaAberta);
          renderLateral();
          renderResumo();
        }
        return;
      }

      // 1–5 mudam a prioridade da nota aberta, mesmo com o foco no texto
      if (ui.notaAberta && /^[1-5]$/.test(ev.key) && (ev.altKey || !emCampo)) {
        var p = Store.PRIORIDADES.filter(function (x) { return x.atalho === ev.key; })[0];
        if (p) {
          ev.preventDefault();
          Store.atualizarNota(ui.notaAberta, { prioridade: p.id });
          abrirEditor(ui.notaAberta);
          renderLateral();
          renderResumo();
          toast('Prioridade: ' + p.nome);
          return;
        }
      }

      if (emCampo) return;

      switch (ev.key.toLowerCase()) {
        case 'n': ev.preventDefault(); criarNota(); break;
        case '/': ev.preventDefault(); $('#busca').focus(); break;
        case 'e': alternarTema(); break;
        case 'g': Store.definirPref('visualizacao', 'grade'); renderTudo(); break;
        case 'l': Store.definirPref('visualizacao', 'lista'); renderTudo(); break;
        case 'q': Store.definirPref('visualizacao', 'quadro'); renderTudo(); break;
        case '?': abrirModal('#modalAtalhos'); break;
      }
    });

    /* --- sistema mudou de tema --- */
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      if (Store.estado.prefs.tema === 'auto') aplicarTema();
    });

    /* --- avisa quando o armazenamento falha (aba anônima, disco cheio) --- */
    Store.aoFalharGravacao = function () {
      toast('Não consegui salvar neste navegador. Exporte um backup para não perder nada.', null, 8000);
    };

    /* fechar a aba ou minimizar no celular não pode comer a última frase */
    var salvarAgora = function () { gravarPendente(); Store.gravarAgora(); };
    window.addEventListener('beforeunload', salvarAgora);
    window.addEventListener('pagehide', salvarAgora);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') salvarAgora();
    });

    ligarArrasto();
  }

  /* ================================================================ boot */

  function iniciar() {
    Store.iniciar().then(function () {
      // preferência que pode não existir em backups antigos
      if (typeof Store.estado.prefs.ocultarConcluidas !== 'boolean') {
        Store.estado.prefs.ocultarConcluidas = false;
      }
      aplicarTema();
      ligarEventos();
      renderTudo();
      sincronizarConfig();

      var params = new URLSearchParams(location.search);
      if (params.get('nova') === '1') criarNota();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();

})();
