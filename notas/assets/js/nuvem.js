/*
 * Prioriza — sincronização entre aparelhos
 *
 * Arquitetura local-first: o Store no navegador continua sendo a fonte da
 * verdade e o app funciona inteiro sem rede. Esta camada fica por cima,
 * puxando e empurrando o espaço quando há sessão e conexão. Se a nuvem cair,
 * o app não percebe — volta a sincronizar quando der.
 *
 * Depende de window.supabase (vendor/supabase-*.js) e de window.PRIORIZA_NUVEM.
 */
(function (global) {
  'use strict';

  var Store = global.Store;

  var Nuvem = {
    cliente: null,
    usuario: null,
    versao: 0,
    estado: 'desligada', // desligada | deslogado | sincronizando | ok | offline | erro
    detalhe: '',
    aoMudar: function () {},

    _parar: null,
    _timer: null,
    _enviando: false,
    _pendente: false
  };

  var ATRASO_ENVIO = 1800;   // agrupa rajadas de digitação numa gravação só
  var DIAS_LAPIDE = 90;      // por quanto tempo lembramos que uma nota foi apagada

  /* ----------------------------------------------------------- utilidades */

  function config() {
    var c = global.PRIORIZA_NUVEM;
    if (!c || !c.url || !c.chave) return null;
    if (c.url.indexOf('http') !== 0) return null;
    return c;
  }

  function anunciar(estado, detalhe) {
    Nuvem.estado = estado;
    Nuvem.detalhe = detalhe || '';
    try { Nuvem.aoMudar(estado, Nuvem.detalhe); } catch (e) { /* UI que falhe não derruba sync */ }
  }

  function agora() { return new Date().toISOString(); }

  /* ------------------------------------------------------------- a junção */

  function podarLapides(lista) {
    var limite = new Date(Date.now() - DIAS_LAPIDE * 86400000).toISOString();
    return lista
      .filter(function (r) { return r && r.id && r.em > limite; })
      .sort(function (a, b) { return a.em < b.em ? 1 : -1; })
      .slice(0, 1000);
  }

  /*
   * Junta dois espaços sem perder trabalho de ninguém.
   *
   * Notas: união por id, vence a editada por último. As lápides (ids apagados
   * de vez, com data) impedem que uma nota apagada num aparelho ressuscite
   * vinda do outro — sem elas, apagar seria desfeito na próxima sincronização.
   *
   * Preferências ficam com o aparelho local: tema e visualização são escolha
   * de quem está usando esta tela, não algo a herdar de outro aparelho.
   */
  function juntar(local, remoto) {
    local = local || {};
    remoto = remoto || {};

    var lapides = {};
    (local.removidas || []).concat(remoto.removidas || []).forEach(function (r) {
      if (r && r.id && (!lapides[r.id] || lapides[r.id] < r.em)) lapides[r.id] = r.em;
    });

    var porId = {};
    (remoto.notas || []).forEach(function (n) { if (n && n.id) porId[n.id] = n; });
    (local.notas || []).forEach(function (n) {
      if (!n || !n.id) return;
      var atual = porId[n.id];
      if (!atual || (n.atualizadaEm || '') >= (atual.atualizadaEm || '')) porId[n.id] = n;
    });

    var notas = Object.keys(porId)
      .map(function (id) { return porId[id]; })
      .filter(function (n) {
        var morte = lapides[n.id];
        return !morte || morte < (n.atualizadaEm || '');
      });

    function unir(daqui, dali) {
      var m = {};
      (dali || []).forEach(function (x) { if (x && x.id) m[x.id] = x; });
      (daqui || []).forEach(function (x) { if (x && x.id) m[x.id] = x; });
      return Object.keys(m).map(function (k) { return m[k]; });
    }

    return {
      versao: 1,
      perfil: local.perfil || remoto.perfil || {},
      prefs: local.prefs || remoto.prefs || {},
      cadernos: unir(local.cadernos, remoto.cadernos),
      etiquetas: unir(local.etiquetas, remoto.etiquetas),
      notas: notas,
      removidas: podarLapides(Object.keys(lapides).map(function (id) {
        return { id: id, em: lapides[id] };
      }))
    };
  }

  Nuvem.juntar = juntar; // exposto para teste

  /* ------------------------------------------------------------ transporte */

  function puxar() {
    return Nuvem.cliente
      .from('espacos')
      .select('dados, versao')
      .eq('user_id', Nuvem.usuario.id)
      .maybeSingle()
      .then(function (r) {
        if (r.error) throw r.error;
        if (!r.data) return { dados: null, versao: 0 };
        return { dados: r.data.dados, versao: r.data.versao };
      });
  }

  function gravar(dados, versao) {
    return Nuvem.cliente
      .rpc('salvar_espaco', { p_dados: dados, p_versao: versao })
      .then(function (r) {
        if (r.error) throw r.error;
        return r.data;
      });
  }

  /* --------------------------------------------------------------- envio */

  function enviarAgora(tentativa) {
    if (!Nuvem.usuario) return Promise.resolve();
    if (Nuvem._enviando) { Nuvem._pendente = true; return Promise.resolve(); }

    Nuvem._enviando = true;
    anunciar('sincronizando');

    return gravar(Store.estado, Nuvem.versao)
      .then(function (resposta) {
        if (resposta && resposta.conflito) {
          // outro aparelho gravou no meio: junta e tenta de novo, uma vez
          var juntado = juntar(Store.estado, resposta.dados);
          Store.substituirEstado(juntado);
          Nuvem.versao = resposta.versao;
          if ((tentativa || 0) < 1) {
            Nuvem._enviando = false;
            return enviarAgora(1);
          }
          anunciar('erro', 'conflito não resolvido');
          return;
        }
        Nuvem.versao = (resposta && resposta.versao) || Nuvem.versao;
        anunciar('ok');
      })
      .catch(function (e) {
        var semRede = !global.navigator.onLine ||
          /fetch|network|Failed to fetch/i.test(e && e.message || '');
        anunciar(semRede ? 'offline' : 'erro', (e && e.message) || 'falha ao sincronizar');
      })
      .then(function () {
        Nuvem._enviando = false;
        if (Nuvem._pendente) {
          Nuvem._pendente = false;
          agendarEnvio();
        }
      });
  }

  function agendarEnvio() {
    if (!Nuvem.usuario) return;
    clearTimeout(Nuvem._timer);
    Nuvem._timer = setTimeout(function () { enviarAgora(0); }, ATRASO_ENVIO);
  }

  Nuvem.enviarJa = function () {
    clearTimeout(Nuvem._timer);
    return enviarAgora(0);
  };

  /* ------------------------------------------------------- entrar no espaço */

  function abrirEspaco() {
    anunciar('sincronizando');
    return puxar()
      .then(function (remoto) {
        if (remoto.dados && Object.keys(remoto.dados).length) {
          Store.substituirEstado(juntar(Store.estado, remoto.dados));
        }
        Nuvem.versao = remoto.versao;
        return enviarAgora(0); // sobe a junção (ou o estado local, na 1ª vez)
      })
      .then(function () {
        if (Nuvem._parar) Nuvem._parar();
        Nuvem._parar = Store.inscrever(agendarEnvio);
      })
      .catch(function (e) {
        anunciar('erro', (e && e.message) || 'não consegui abrir seu espaço');
      });
  }

  function fecharEspaco() {
    clearTimeout(Nuvem._timer);
    if (Nuvem._parar) { Nuvem._parar(); Nuvem._parar = null; }
    Nuvem.usuario = null;
    Nuvem.versao = 0;
  }

  /* ----------------------------------------------------------------- auth */

  Nuvem.configurada = function () { return !!config(); };

  Nuvem.disponivel = function () {
    return !!(config() && global.supabase && global.supabase.createClient);
  };

  /*
   * A biblioteca só é baixada por quem usa nuvem. Quem roda o app sem conta
   * não paga os 218 KB — e o app já funciona inteiro sem ela.
   */
  function carregarBiblioteca() {
    if (global.supabase && global.supabase.createClient) return Promise.resolve(true);
    var c = config();
    if (!c) return Promise.resolve(false);
    return new Promise(function (resolve) {
      var tag = document.createElement('script');
      tag.src = c.lib || '../assets/js/vendor/supabase-2.117.1.js';
      tag.onload = function () { resolve(!!(global.supabase && global.supabase.createClient)); };
      tag.onerror = function () { resolve(false); };
      document.head.appendChild(tag);
    });
  }

  Nuvem.iniciar = function () {
    var c = config();
    if (!c) {
      anunciar('desligada');
      return Promise.resolve(false);
    }
    return carregarBiblioteca().then(function (carregou) {
      if (!carregou) {
        // sem rede isto é esperado, não é defeito: o app segue local
        anunciar(global.navigator.onLine ? 'erro' : 'offline',
                 'a biblioteca de sincronização não carregou');
        return false;
      }
      return Nuvem._ligar(c);
    });
  };

  Nuvem._ligar = function (c) {
    Nuvem.cliente = global.supabase.createClient(c.url, c.chave, {
      auth: { persistSession: true, autoRefreshToken: true }
    });

    Nuvem.cliente.auth.onAuthStateChange(function (evento, sessao) {
      if (sessao && sessao.user) {
        if (!Nuvem.usuario || Nuvem.usuario.id !== sessao.user.id) {
          Nuvem.usuario = sessao.user;
          abrirEspaco();
        }
      } else {
        fecharEspaco();
        anunciar('deslogado');
      }
    });

    return Nuvem.cliente.auth.getSession().then(function (r) {
      var sessao = r && r.data && r.data.session;
      if (sessao && sessao.user) {
        Nuvem.usuario = sessao.user;
        return abrirEspaco().then(function () { return true; });
      }
      anunciar('deslogado');
      return false;
    });
  };

  Nuvem.criarConta = function (email, senha) {
    return Nuvem.cliente.auth.signUp({ email: email, password: senha })
      .then(function (r) {
        if (r.error) throw r.error;
        // sem sessão na resposta = o projeto exige confirmar o e-mail
        if (!r.data.session) return { confirmar: true };
        return { confirmar: false };
      });
  };

  Nuvem.entrar = function (email, senha) {
    return Nuvem.cliente.auth.signInWithPassword({ email: email, password: senha })
      .then(function (r) {
        if (r.error) throw r.error;
        return r.data;
      });
  };

  Nuvem.sair = function () {
    // garante que a última edição subiu antes de soltar a sessão
    return Nuvem.enviarJa()
      .then(function () { return Nuvem.cliente.auth.signOut(); })
      .then(function () { fecharEspaco(); anunciar('deslogado'); });
  };

  Nuvem.email = function () {
    return Nuvem.usuario && Nuvem.usuario.email;
  };

  global.Nuvem = Nuvem;
})(window);
