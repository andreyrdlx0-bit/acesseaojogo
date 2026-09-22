/*
 * Prioriza — camada de dados
 *
 * Toda a persistencia passa por um "adaptador". Hoje existe apenas o adaptador
 * local (localStorage), mas a interface e assincrona de proposito: trocar por
 * uma API remota (Supabase, Firebase, backend proprio) significa escrever outro
 * objeto com os mesmos tres metodos e apontar `Store.adapter` para ele.
 */
(function (global) {
  'use strict';

  var CHAVE = 'prioriza:v1';
  var VERSAO = 1;

  /* ---------------------------------------------------------------- utils */

  function uid(prefixo) {
    return (prefixo || 'id') + '_' +
      Date.now().toString(36) + '_' +
      Math.random().toString(36).slice(2, 8);
  }

  function agora() {
    return new Date().toISOString();
  }

  function clonar(valor) {
    return JSON.parse(JSON.stringify(valor));
  }

  /* --------------------------------------------------------- prioridades */

  var PRIORIDADES = [
    { id: 'urgente', nome: 'Urgente', cor: '#e5484d', peso: 4, atalho: '1' },
    { id: 'alta', nome: 'Alta', cor: '#f76808', peso: 3, atalho: '2' },
    { id: 'media', nome: 'Média', cor: '#eaa900', peso: 2, atalho: '3' },
    { id: 'baixa', nome: 'Baixa', cor: '#3e8fd6', peso: 1, atalho: '4' },
    { id: 'nenhuma', nome: 'Sem prioridade', cor: '#9a978e', peso: 0, atalho: '5' }
  ];

  var MAPA_PRIORIDADE = PRIORIDADES.reduce(function (acc, p) {
    acc[p.id] = p;
    return acc;
  }, {});

  var CORES_ETIQUETA = [
    '#5a4fcf', '#e5484d', '#f76808', '#eaa900', '#2f9e6b',
    '#3e8fd6', '#9333ea', '#d6336c', '#0d9488', '#7c6f5a'
  ];

  /* ------------------------------------------------------------- adapters */

  var adaptadorLocal = {
    nome: 'local',
    ler: function () {
      return new Promise(function (resolve) {
        var bruto = null;
        try {
          bruto = global.localStorage.getItem(CHAVE);
        } catch (e) {
          bruto = null;
        }
        if (!bruto) return resolve(null);
        try {
          resolve(JSON.parse(bruto));
        } catch (e) {
          resolve(null);
        }
      });
    },
    gravar: function (estado) {
      return new Promise(function (resolve, reject) {
        try {
          global.localStorage.setItem(CHAVE, JSON.stringify(estado));
          resolve(true);
        } catch (e) {
          reject(e);
        }
      });
    },
    limpar: function () {
      return new Promise(function (resolve) {
        try {
          global.localStorage.removeItem(CHAVE);
        } catch (e) { /* ignora */ }
        resolve(true);
      });
    }
  };

  /* ---------------------------------------------------------- estado base */

  function estadoVazio() {
    return {
      versao: VERSAO,
      perfil: {
        nome: '',
        plano: 'free',
        criadoEm: agora()
      },
      cadernos: [],
      etiquetas: [],
      notas: [],
      prefs: {
        tema: 'auto',
        visualizacao: 'grade',
        ordenacao: 'prioridade',
        filtro: 'todas',
        ocultarConcluidas: false,
        cadernoAtivo: null,
        etiquetaAtiva: null,
        densidade: 'confortavel'
      }
    };
  }

  function estadoInicial() {
    var estado = estadoVazio();
    var hoje = new Date();

    function emDias(n) {
      var d = new Date(hoje.getTime());
      d.setDate(d.getDate() + n);
      return d.toISOString().slice(0, 10);
    }

    var cadTrabalho = { id: uid('cad'), nome: 'Trabalho', cor: '#5a4fcf', ordem: 0 };
    var cadPessoal = { id: uid('cad'), nome: 'Pessoal', cor: '#2f9e6b', ordem: 1 };
    var cadEstudos = { id: uid('cad'), nome: 'Estudos', cor: '#3e8fd6', ordem: 2 };
    estado.cadernos = [cadTrabalho, cadPessoal, cadEstudos];

    var etReuniao = { id: uid('etq'), nome: 'Reunião', cor: '#9333ea' };
    var etFinanceiro = { id: uid('etq'), nome: 'Financeiro', cor: '#0d9488' };
    var etIdeia = { id: uid('etq'), nome: 'Ideia', cor: '#eaa900' };
    estado.etiquetas = [etReuniao, etFinanceiro, etIdeia];

    estado.prefs.cadernoAtivo = null;

    estado.notas = [
      novaNotaBase({
        titulo: 'Fechar proposta do cliente novo',
        conteudo: 'Revisar escopo, ajustar valores e enviar até o fim do dia.\nAnexar o portfólio atualizado.',
        prioridade: 'urgente',
        cadernoId: cadTrabalho.id,
        etiquetas: [etReuniao.id],
        prazo: emDias(0),
        fixada: true,
        checklist: [
          { id: uid('chk'), texto: 'Revisar escopo', feito: true },
          { id: uid('chk'), texto: 'Ajustar valores', feito: false },
          { id: uid('chk'), texto: 'Enviar por e-mail', feito: false }
        ]
      }),
      novaNotaBase({
        titulo: 'Pagar contas do mês',
        conteudo: 'Luz, internet e cartão. Conferir se o boleto da internet já caiu.',
        prioridade: 'alta',
        cadernoId: cadPessoal.id,
        etiquetas: [etFinanceiro.id],
        prazo: emDias(2)
      }),
      novaNotaBase({
        titulo: 'Estudar 1 capítulo do curso',
        conteudo: 'Capítulo 4 — funis de venda. Fazer os exercícios no fim.',
        prioridade: 'media',
        cadernoId: cadEstudos.id,
        etiquetas: [],
        prazo: emDias(5)
      }),
      novaNotaBase({
        titulo: 'Ideia: newsletter semanal',
        conteudo: 'Mandar um resumo toda sexta com o que aprendi na semana. Testar por 1 mês.',
        prioridade: 'baixa',
        cadernoId: cadTrabalho.id,
        etiquetas: [etIdeia.id]
      }),
      novaNotaBase({
        titulo: 'Organizar a mesa de trabalho',
        conteudo: 'Trocar o cabo da luminária e jogar fora os papéis velhos.',
        prioridade: 'nenhuma',
        cadernoId: cadPessoal.id,
        etiquetas: [],
        concluida: true
      })
    ];

    estado.notas.forEach(function (n, i) { n.ordem = i; });
    return estado;
  }

  function novaNotaBase(dados) {
    dados = dados || {};
    var t = agora();
    return {
      id: uid('nota'),
      titulo: dados.titulo || '',
      conteudo: dados.conteudo || '',
      prioridade: dados.prioridade || 'nenhuma',
      cadernoId: dados.cadernoId || null,
      etiquetas: dados.etiquetas ? dados.etiquetas.slice() : [],
      checklist: dados.checklist ? clonar(dados.checklist) : [],
      prazo: dados.prazo || null,
      concluida: !!dados.concluida,
      fixada: !!dados.fixada,
      arquivada: !!dados.arquivada,
      naLixeira: false,
      criadaEm: t,
      atualizadaEm: t,
      concluidaEm: dados.concluida ? t : null,
      ordem: typeof dados.ordem === 'number' ? dados.ordem : 0
    };
  }

  /* --------------------------------------------------------- normalizacao */

  function normalizar(estado) {
    var base = estadoVazio();
    if (!estado || typeof estado !== 'object') return estadoInicial();

    var saida = {
      versao: VERSAO,
      perfil: Object.assign({}, base.perfil, estado.perfil || {}),
      prefs: Object.assign({}, base.prefs, estado.prefs || {}),
      cadernos: Array.isArray(estado.cadernos) ? estado.cadernos : [],
      etiquetas: Array.isArray(estado.etiquetas) ? estado.etiquetas : [],
      notas: []
    };

    saida.cadernos = saida.cadernos
      .filter(function (c) { return c && c.id; })
      .map(function (c, i) {
        return {
          id: String(c.id),
          nome: String(c.nome || 'Sem nome'),
          cor: c.cor || '#5a4fcf',
          ordem: typeof c.ordem === 'number' ? c.ordem : i
        };
      });

    saida.etiquetas = saida.etiquetas
      .filter(function (e) { return e && e.id; })
      .map(function (e) {
        return {
          id: String(e.id),
          nome: String(e.nome || 'etiqueta'),
          cor: e.cor || CORES_ETIQUETA[0]
        };
      });

    var idsCaderno = saida.cadernos.map(function (c) { return c.id; });
    var idsEtiqueta = saida.etiquetas.map(function (e) { return e.id; });

    saida.notas = (Array.isArray(estado.notas) ? estado.notas : [])
      .filter(function (n) { return n && n.id; })
      .map(function (n, i) {
        var nota = novaNotaBase({});
        nota.id = String(n.id);
        nota.titulo = String(n.titulo || '');
        nota.conteudo = String(n.conteudo || '');
        nota.prioridade = MAPA_PRIORIDADE[n.prioridade] ? n.prioridade : 'nenhuma';
        nota.cadernoId = idsCaderno.indexOf(n.cadernoId) >= 0 ? n.cadernoId : null;
        nota.etiquetas = (Array.isArray(n.etiquetas) ? n.etiquetas : [])
          .filter(function (id) { return idsEtiqueta.indexOf(id) >= 0; });
        nota.checklist = (Array.isArray(n.checklist) ? n.checklist : [])
          .filter(function (item) { return item && typeof item.texto === 'string'; })
          .map(function (item) {
            return { id: item.id || uid('chk'), texto: item.texto, feito: !!item.feito };
          });
        nota.prazo = typeof n.prazo === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(n.prazo) ? n.prazo : null;
        nota.concluida = !!n.concluida;
        nota.fixada = !!n.fixada;
        nota.arquivada = !!n.arquivada;
        nota.naLixeira = !!n.naLixeira;
        nota.criadaEm = n.criadaEm || agora();
        nota.atualizadaEm = n.atualizadaEm || nota.criadaEm;
        nota.concluidaEm = n.concluidaEm || (nota.concluida ? nota.atualizadaEm : null);
        nota.ordem = typeof n.ordem === 'number' ? n.ordem : i;
        return nota;
      });

    if (saida.prefs.cadernoAtivo && idsCaderno.indexOf(saida.prefs.cadernoAtivo) < 0) {
      saida.prefs.cadernoAtivo = null;
    }
    if (saida.prefs.etiquetaAtiva && idsEtiqueta.indexOf(saida.prefs.etiquetaAtiva) < 0) {
      saida.prefs.etiquetaAtiva = null;
    }
    return saida;
  }

  /* ------------------------------------------------------------- o Store */

  var Store = {
    adapter: adaptadorLocal,
    estado: estadoVazio(),
    PRIORIDADES: PRIORIDADES,
    MAPA_PRIORIDADE: MAPA_PRIORIDADE,
    CORES_ETIQUETA: CORES_ETIQUETA,
    uid: uid,
    _ouvintes: [],
    _gravacaoPendente: null,

    /* ciclo de vida ------------------------------------------------------ */

    iniciar: function () {
      var self = this;
      return this.adapter.ler().then(function (dados) {
        if (dados) {
          self.estado = normalizar(dados);
        } else {
          self.estado = estadoInicial();
          self._gravar();
        }
        self._notificar();
        return self.estado;
      });
    },

    inscrever: function (fn) {
      this._ouvintes.push(fn);
      return function () {
        var i = this._ouvintes.indexOf(fn);
        if (i >= 0) this._ouvintes.splice(i, 1);
      }.bind(this);
    },

    _notificar: function () {
      var self = this;
      this._ouvintes.forEach(function (fn) { fn(self.estado); });
    },

    _gravar: function () {
      var self = this;
      // agrupa gravacoes seguidas em uma so (digitacao rapida no editor)
      if (this._gravacaoPendente) clearTimeout(this._gravacaoPendente);
      this._gravacaoPendente = setTimeout(function () {
        self._gravacaoPendente = null;
        self.adapter.gravar(self.estado).catch(function (e) {
          if (global.console) console.warn('Prioriza: falha ao gravar', e);
          if (typeof self.aoFalharGravacao === 'function') self.aoFalharGravacao(e);
        });
      }, 120);
    },

    commit: function () {
      this._gravar();
      this._notificar();
    },

    /* grava na hora, sem esperar o agrupamento — usado ao sair da página */
    gravarAgora: function () {
      if (this._gravacaoPendente) {
        clearTimeout(this._gravacaoPendente);
        this._gravacaoPendente = null;
      }
      return this.adapter.gravar(this.estado).catch(function () { /* já avisado */ });
    },

    /* notas -------------------------------------------------------------- */

    criarNota: function (dados) {
      var nota = novaNotaBase(dados);
      var menorOrdem = this.estado.notas.reduce(function (min, n) {
        return Math.min(min, n.ordem);
      }, 0);
      nota.ordem = menorOrdem - 1;
      this.estado.notas.unshift(nota);
      this.commit();
      return nota;
    },

    obterNota: function (id) {
      return this.estado.notas.filter(function (n) { return n.id === id; })[0] || null;
    },

    atualizarNota: function (id, mudancas) {
      var nota = this.obterNota(id);
      if (!nota) return null;
      Object.keys(mudancas).forEach(function (chave) {
        nota[chave] = mudancas[chave];
      });
      if (Object.prototype.hasOwnProperty.call(mudancas, 'concluida')) {
        nota.concluidaEm = mudancas.concluida ? agora() : null;
      }
      nota.atualizadaEm = agora();
      this.commit();
      return nota;
    },

    alternarConcluida: function (id) {
      var nota = this.obterNota(id);
      if (!nota) return null;
      return this.atualizarNota(id, { concluida: !nota.concluida });
    },

    alternarFixada: function (id) {
      var nota = this.obterNota(id);
      if (!nota) return null;
      return this.atualizarNota(id, { fixada: !nota.fixada });
    },

    arquivarNota: function (id, valor) {
      return this.atualizarNota(id, { arquivada: valor !== false, fixada: false });
    },

    enviarParaLixeira: function (id) {
      return this.atualizarNota(id, { naLixeira: true, fixada: false });
    },

    restaurarNota: function (id) {
      return this.atualizarNota(id, { naLixeira: false, arquivada: false });
    },

    excluirDefinitivamente: function (id) {
      this.estado.notas = this.estado.notas.filter(function (n) { return n.id !== id; });
      this.commit();
    },

    esvaziarLixeira: function () {
      var removidas = this.estado.notas.filter(function (n) { return n.naLixeira; }).length;
      this.estado.notas = this.estado.notas.filter(function (n) { return !n.naLixeira; });
      this.commit();
      return removidas;
    },

    duplicarNota: function (id) {
      var nota = this.obterNota(id);
      if (!nota) return null;
      var copia = novaNotaBase(nota);
      copia.titulo = (nota.titulo || 'Sem titulo') + ' (copia)';
      copia.concluida = false;
      copia.concluidaEm = null;
      copia.fixada = false;
      copia.checklist = nota.checklist.map(function (item) {
        return { id: uid('chk'), texto: item.texto, feito: false };
      });
      copia.ordem = nota.ordem - 0.5;
      this.estado.notas.push(copia);
      this.commit();
      return copia;
    },

    reordenarNotas: function (idsNaOrdem) {
      var mapa = {};
      idsNaOrdem.forEach(function (id, i) { mapa[id] = i; });
      this.estado.notas.forEach(function (n) {
        if (Object.prototype.hasOwnProperty.call(mapa, n.id)) n.ordem = mapa[n.id];
      });
      this.commit();
    },

    /* checklist ---------------------------------------------------------- */

    adicionarItemChecklist: function (notaId, texto) {
      var nota = this.obterNota(notaId);
      if (!nota || !texto.trim()) return null;
      var item = { id: uid('chk'), texto: texto.trim(), feito: false };
      nota.checklist.push(item);
      nota.atualizadaEm = agora();
      this.commit();
      return item;
    },

    alternarItemChecklist: function (notaId, itemId) {
      var nota = this.obterNota(notaId);
      if (!nota) return;
      nota.checklist.forEach(function (item) {
        if (item.id === itemId) item.feito = !item.feito;
      });
      nota.atualizadaEm = agora();
      this.commit();
    },

    removerItemChecklist: function (notaId, itemId) {
      var nota = this.obterNota(notaId);
      if (!nota) return;
      nota.checklist = nota.checklist.filter(function (item) { return item.id !== itemId; });
      nota.atualizadaEm = agora();
      this.commit();
    },

    /* cadernos ----------------------------------------------------------- */

    criarCaderno: function (nome, cor) {
      var caderno = {
        id: uid('cad'),
        nome: (nome || 'Novo caderno').trim(),
        cor: cor || '#5a4fcf',
        ordem: this.estado.cadernos.length
      };
      this.estado.cadernos.push(caderno);
      this.commit();
      return caderno;
    },

    renomearCaderno: function (id, nome) {
      this.estado.cadernos.forEach(function (c) {
        if (c.id === id) c.nome = nome.trim() || c.nome;
      });
      this.commit();
    },

    excluirCaderno: function (id) {
      this.estado.cadernos = this.estado.cadernos.filter(function (c) { return c.id !== id; });
      this.estado.notas.forEach(function (n) {
        if (n.cadernoId === id) n.cadernoId = null;
      });
      if (this.estado.prefs.cadernoAtivo === id) this.estado.prefs.cadernoAtivo = null;
      this.commit();
    },

    /* etiquetas ---------------------------------------------------------- */

    criarEtiqueta: function (nome, cor) {
      nome = (nome || '').trim();
      if (!nome) return null;
      var existente = this.estado.etiquetas.filter(function (e) {
        return e.nome.toLowerCase() === nome.toLowerCase();
      })[0];
      if (existente) return existente;
      var etiqueta = {
        id: uid('etq'),
        nome: nome,
        cor: cor || CORES_ETIQUETA[this.estado.etiquetas.length % CORES_ETIQUETA.length]
      };
      this.estado.etiquetas.push(etiqueta);
      this.commit();
      return etiqueta;
    },

    renomearEtiqueta: function (id, nome) {
      this.estado.etiquetas.forEach(function (e) {
        if (e.id === id) e.nome = nome.trim() || e.nome;
      });
      this.commit();
    },

    excluirEtiqueta: function (id) {
      this.estado.etiquetas = this.estado.etiquetas.filter(function (e) { return e.id !== id; });
      this.estado.notas.forEach(function (n) {
        n.etiquetas = n.etiquetas.filter(function (eid) { return eid !== id; });
      });
      if (this.estado.prefs.etiquetaAtiva === id) this.estado.prefs.etiquetaAtiva = null;
      this.commit();
    },

    obterEtiqueta: function (id) {
      return this.estado.etiquetas.filter(function (e) { return e.id === id; })[0] || null;
    },

    obterCaderno: function (id) {
      return this.estado.cadernos.filter(function (c) { return c.id === id; })[0] || null;
    },

    /* preferencias e perfil ---------------------------------------------- */

    definirPref: function (chave, valor) {
      this.estado.prefs[chave] = valor;
      this.commit();
    },

    definirPerfil: function (mudancas) {
      Object.assign(this.estado.perfil, mudancas);
      this.commit();
    },

    /* import / export ----------------------------------------------------- */

    exportar: function () {
      return JSON.stringify({
        aplicativo: 'Prioriza',
        versao: VERSAO,
        exportadoEm: agora(),
        dados: this.estado
      }, null, 2);
    },

    importar: function (texto) {
      var pacote = JSON.parse(texto);
      var dados = pacote && pacote.dados ? pacote.dados : pacote;
      this.estado = normalizar(dados);
      this.commit();
      return this.estado;
    },

    reiniciar: function (comExemplos) {
      this.estado = comExemplos ? estadoInicial() : estadoVazio();
      this.commit();
      return this.estado;
    }
  };

  global.Store = Store;
})(window);
