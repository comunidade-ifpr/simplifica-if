/**
 * Um checkout mínimo que o `Compilador` aceita (uma lei de teste e os arquivos de configuração vazios),
 * para compilar um banco pequeno sem a base real: `db/base.test.ts` e o teste da fábrica
 * (`scripts/fabrica_atualizacao.test.ts`), que o compila pelo ponto de entrada do `kb compilar`.
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

/** Grava o checkout mínimo em `dir`. */
export const criarCheckoutMinimo = Effect.fn("testes.criarCheckoutMinimo")(function* (dir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const gravar = Effect.fn("testes.criarCheckoutMinimo.gravar")(function* (rel: string, conteudo: string) {
    const alvo = path.join(dir, rel);
    yield* fs.makeDirectory(path.dirname(alvo), { recursive: true });
    yield* fs.writeFileString(alvo, conteudo);
  });
  yield* gravar("packages/kb/dados/sinonimos.yaml", "tipos: {}\ngrupos: []\n");
  yield* gravar("packages/kb/dados/topicos-secoes.yaml", "{}\n");
  yield* gravar("base-conhecimento/config/vigencia.yaml", 'data_referencia: "2026-11-13"\n');
  yield* gravar("base-conhecimento/normas/stubs.yaml", "normas: []\nexternos: []\n");
  yield* gravar("base-conhecimento/relacoes.yaml", "relacoes: []\n");
  yield* gravar("base-conhecimento/transicoes.yaml", "transicoes: []\n");
  yield* gravar("base-conhecimento/catalogos/cnct/index.json", '{"items":[]}\n');
  yield* gravar("base-conhecimento/institucional/ifpr/ppcs/index.json", '{"items":[],"secoes":{"paths":{}}}\n');
  yield* gravar(
    "base-conhecimento/normas/br/leis/LEI_BR_1-2020_teste.md",
    [
      "---",
      "id: br/lei/2020/1",
      'title: "Lei nº 1/2020"',
      'tipo_documento: "Lei"',
      'numero: "1"',
      "ano: 2020",
      'assinada_em: "2020-01-01"',
      'publicada_em: "2020-01-01"',
      'vigente_de: "2020-01-01"',
      'datas_fonte: "Teste mínimo."',
      'orgao: "BR"',
      'jurisdicao: "BR"',
      'ementa: "Norma mínima de teste."',
      'fonte_referencia: "DOU de teste."',
      'status_vigencia: "vigente"',
      "keywords:",
      '  - "teste"',
      "---",
      "",
      "#### Art. 1º",
      "",
      "Esta lei dispõe sobre o teste mínimo.",
      "",
    ].join("\n"),
  );
});
