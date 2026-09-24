/*
 * Prioriza — service worker
 *
 * Existe para uma coisa: depois de instalado na tela inicial, o app tem que
 * abrir mesmo sem internet. Sem isso, "instalar" seria só um atalho bonito
 * que mostra erro de conexão quando o sinal cai.
 *
 * Ao mudar qualquer arquivo de assets/, suba a VERSAO — é o que faz o
 * navegador descartar o cache velho e buscar o novo.
 */

var VERSAO = 'prioriza-v3';
var FONTES = 'prioriza-fontes-v1';

var CASCA = [
  './',
  './index.html',
  './app/',
  './app/index.html',
  './manifest.webmanifest',
  './assets/css/landing.css',
  './assets/css/app.css',
  './assets/js/config.js',
  './assets/js/store.js',
  './assets/js/nuvem.js',
  './assets/js/app.js',
  './assets/img/favicon.svg',
  './assets/img/icon-192.png',
  './assets/img/icon-512.png',
  './assets/img/icon-maskable-512.png',
  './assets/img/apple-touch-icon.png'
];

self.addEventListener('install', function (ev) {
  ev.waitUntil(
    caches.open(VERSAO).then(function (cache) {
      // um arquivo que falhe não pode derrubar a instalação inteira
      return Promise.all(CASCA.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (ev) {
  ev.waitUntil(
    caches.keys().then(function (chaves) {
      return Promise.all(chaves.map(function (chave) {
        if (chave !== VERSAO && chave !== FONTES) return caches.delete(chave);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function ehFonte(url) {
  return url.indexOf('https://fonts.googleapis.com') === 0 ||
         url.indexOf('https://fonts.gstatic.com') === 0;
}

self.addEventListener('fetch', function (ev) {
  var req = ev.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);

  // fontes: serve do cache e completa pela rede quando dá
  if (ehFonte(req.url)) {
    ev.respondWith(
      caches.open(FONTES).then(function (cache) {
        return cache.match(req).then(function (guardada) {
          if (guardada) {
            // renova por trás, sem segurar a página
            fetch(req).then(function (resp) {
              if (resp && (resp.ok || resp.type === 'opaque')) cache.put(req, resp.clone());
            }).catch(function () {});
            return guardada;
          }
          return fetch(req).then(function (resp) {
            if (resp && (resp.ok || resp.type === 'opaque')) cache.put(req, resp.clone());
            return resp;
          }).catch(function () {
            // sem rede e sem cópia guardada: uma resposta vazia deixa o navegador
            // cair na fonte do sistema em silêncio, em vez de estourar erro de rede
            return new Response('', { status: 200, headers: { 'Content-Type': 'text/css' } });
          });
        });
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // páginas: rede primeiro, para a pessoa receber a versão nova ao abrir online
  if (req.mode === 'navigate') {
    ev.respondWith(
      fetch(req).then(function (resp) {
        var copia = resp.clone();
        caches.open(VERSAO).then(function (c) { c.put(req, copia); });
        return resp;
      }).catch(function () {
        return caches.match(req).then(function (guardada) {
          return guardada || caches.match('./app/index.html') || caches.match('./index.html');
        });
      })
    );
    return;
  }

  // demais arquivos: cache primeiro, revalidando por trás
  ev.respondWith(
    caches.match(req).then(function (guardada) {
      var daRede = fetch(req).then(function (resp) {
        if (resp && resp.ok) {
          var copia = resp.clone();
          caches.open(VERSAO).then(function (c) { c.put(req, copia); });
        }
        return resp;
      }).catch(function () { return guardada; });
      return guardada || daRede;
    })
  );
});
