// Carrega o módulo do primeiro argumento num Node limpo e imprime, em JSON, todas as URLs que o
// carregamento resolveu (módulos do repositório, dependências e `node:*`). Apoio do
// `sem-servidor.test.ts`; em JavaScript, sem Effect, para não carregar nada além do módulo medido.
import * as NodeModule from "node:module";

const urls = new Set();
NodeModule.registerHooks({
  resolve(especificador, contexto, proximo) {
    const resolvido = proximo(especificador, contexto);
    urls.add(resolvido.url);
    return resolvido;
  },
});
await import(process.argv[2]);
process.stdout.write(JSON.stringify([...urls]));
