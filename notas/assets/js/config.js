/*
 * Prioriza — ligação com a nuvem.
 *
 * Enquanto url e chave estiverem vazias, o app roda inteiro no navegador,
 * exatamente como antes: nenhuma tela de conta aparece e nada é enviado.
 * Preencher estes dois campos liga a sincronização entre aparelhos.
 *
 * A chave publicável é pública de propósito — ela só permite o que as
 * políticas de RLS do banco autorizam, e elas restringem cada pessoa ao
 * próprio espaço. A chave secreta nunca deve aparecer aqui.
 */
window.PRIORIZA_NUVEM = {
  url: '',
  chave: ''
};
