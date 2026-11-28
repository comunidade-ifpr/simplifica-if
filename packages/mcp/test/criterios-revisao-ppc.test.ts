// @effect-diagnostics nodeBuiltinImport:off -- teste: grava um critério e um tópico no banco da fixture com node:sqlite
/**
 * A ferramenta `criterios_revisao_ppc` e o comando `kb criterios-revisao-ppc`, sobre o banco de PPCs da
 * fixture com um critério a mais (`CT-TESTE-01`, com os campos de texto e um tópico): por ID, por
 * tópico e por norma (a referência estruturada da ficha da fixture), a entrada inválida, e a CLI com a
 * mesma resposta da ferramenta.
 */
import * as NodeSqlite from "node:sqlite";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, describe, expect, it, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Command from "effect/cli/Command";
import { TestConsole } from "effect/testing";
import { comandosDeConsulta } from "../src/consulta.ts";
import { ehEntradaInvalida } from "../src/contratos.ts";
import { criteriosRevisaoPpc, TETO_CRITERIOS } from "../src/ferramentas/criterios-revisao-ppc.ts";
import { chamador } from "../src/ferramentas/registrar.ts";
import { layerHandlers } from "../src/ferramentas/toolkit.ts";
import { layerLeitura } from "../src/servidor.ts";
import { camadaFerramentas, mensagemDeErro, responder, saidaValida } from "./apoio.ts";
import { limparTemporarios } from "./fixture.ts";
import { criarBancoFixturePpcs } from "./fixture-ppcs.ts";

afterAll(limparTemporarios);

const FICHA = {
  id: "CT-TESTE-01",
  titulo: "Acompanhamento de egressos",
  dominio: "gestao",
  criticidade: "obrigatorio",
  execucao: { modo: "focal", justificativa: "Busca semântica do trecho de egressos." },
  pergunta: "O PPC descreve o acompanhamento de egressos?",
  rubrica: "Conferir a metodologia e o cronograma do acompanhamento.",
  boa_evidencia: "Metodologia e cronograma do acompanhamento.",
  referencias_normativas: [{ ref: "br/cne-cp/res/2026/2", dispositivo: "#art28-xviii", papel: "fundamento" }],
};
const PATH = "base-conhecimento/revisao-ppc/fichas/ct-teste-01.json";

const banco = criarBancoFixturePpcs();
{
  const db = new NodeSqlite.DatabaseSync(banco);
  db.prepare("INSERT INTO revisao_ppc_fichas (id, titulo, path, dados_json, arquivo_json) VALUES (?, ?, ?, ?, ?)").run(
    FICHA.id,
    FICHA.titulo,
    PATH,
    JSON.stringify(FICHA),
    JSON.stringify(FICHA),
  );
  db.prepare(
    "INSERT INTO revisao_ppc_topicos (id, ordem, titulo, termos_json, path, dados_json) VALUES (?, ?, ?, '[]', ?, ?)",
  ).run(
    "egressos",
    0,
    "Egressos",
    "base-conhecimento/revisao-ppc/topicos.json",
    JSON.stringify({ id: "egressos", titulo: "Egressos", fichas: [FICHA.id] }),
  );
  db.prepare("INSERT INTO revisao_ppc_fichas_topicos (ficha_id, topico_id) VALUES (?, ?)").run(FICHA.id, "egressos");
  db.close();
}

const camada = camadaFerramentas(banco);
const chamar = (args: unknown) =>
  Effect.gen(function* () {
    const r = yield* responder(criteriosRevisaoPpc, args).pipe(Effect.provide(camada));
    if (!saidaValida(criteriosRevisaoPpc, r.resposta)) throw new Error("saída fora do outputSchema");
    expect(r.texto.length).toBeLessThanOrEqual(TETO_CRITERIOS);
    return r;
  });

describe("criterios_revisao_ppc", () => {
  it.effect("por ID: o critério inteiro, rotulado como da tarefa, com as normas e a linha de cada campo", () =>
    Effect.gen(function* () {
      const { resposta, texto } = yield* chamar({ id: "ct-teste-01" });
      const [c] = resposta.dados.criterios;
      expect(resposta.dados.filtro).toEqual({ campo: "id", valor: "ct-teste-01" });
      expect(c!.id).toBe("CT-TESTE-01");
      expect(c!.topicos).toEqual(["egressos"]);
      expect(c!.execucao).toEqual({ modo: "focal", justificativa: "Busca semântica do trecho de egressos." });
      expect(c!.campos.map((campo) => campo.campo)).toEqual(["pergunta", "rubrica", "boa_evidencia"]);
      expect(c!.campos[0]!.fonte).toEqual({ path: PATH, linha_inicio: 10, linha_fim: 10 });
      expect(c!.referencias).toEqual([
        {
          ref: "br/cne-cp/res/2026/2",
          dispositivo: "#art28-xviii",
          papel: "fundamento",
          nota: null,
          titulo: "Resolução CNE/CP nº 2/2026",
          status_vigencia: "ainda-nao-vigente",
          link: "ifpr://norma/br/cne-cp/res/2026/2#art28-xviii",
        },
      ]);
      expect(c!.ficha).toEqual(FICHA);
      expect(texto).toContain('Critérios da tarefa "Revisar um PPC" para o critério ct-teste-01: 1.');
      expect(texto).toContain("não fonte normativa");
      expect(texto).toContain("**O que confere:** O PPC descreve o acompanhamento de egressos?");
      expect(texto).toContain(
        "**Como o app confere:** Focal — O app localiza os trechos relevantes no PPC e a IA confirma o que eles dizem",
      );
      expect(texto).toContain(
        "- [Resolução CNE/CP nº 2/2026, art. 28, XVIII](ifpr://norma/br/cne-cp/res/2026/2#art28-xviii) (fundamento; ainda-nao-vigente)",
      );
      // o critério não tem link próprio: é da tarefa, não da base
      expect(texto).not.toContain("ifpr://ficha/");
    }),
  );

  it.effect("por tópico: os critérios dele, com o título do tópico", () =>
    Effect.gen(function* () {
      const { resposta, texto } = yield* chamar({ topico: "egressos" });
      expect(resposta.dados.titulo).toBe("Egressos");
      expect(resposta.dados.criterios.map((c) => c.id)).toEqual(["CT-TESTE-01"]);
      expect(texto).toContain('o tópico "Egressos" (`egressos`)');
    }),
  );

  it.effect("por norma: os critérios que ela atinge, com o motivo e os dispositivos, em lista curta", () =>
    Effect.gen(function* () {
      const { resposta, texto } = yield* chamar({ norma: "br/cne-cp/res/2021/1" });
      expect(resposta.dados.titulo).toBe("Resolução CNE/CP nº 1/2021");
      expect(resposta.dados.criterios.map((c) => [c.id, c.atingido])).toEqual([
        ["CT-CURR-12", { motivos: ["referencia"], dispositivos: ["br/cne-cp/res/2021/1#art20"] }],
      ]);
      expect(texto).toContain(
        "- **CT-CURR-12** Progressão formativa explicitada na organização curricular — referencia (br/cne-cp/res/2021/1#art20)",
      );
      const nenhum = yield* chamar({ norma: "br/lei/1996/9394" });
      expect(nenhum.resposta.dados.criterios).toEqual([]);
    }),
  );

  it.effect("entrada inválida: nenhum ou mais de um filtro, critério, tópico ou norma desconhecidos", () =>
    Effect.gen(function* () {
      const casos: ReadonlyArray<readonly [unknown, RegExp]> = [
        [{}, /informe exatamente um destes: id/],
        [{ id: "CT-TESTE-01", topico: "egressos" }, /informe exatamente um destes: id/],
        [{ id: "XX-0" }, /critério não encontrado: "XX-0"/],
        [{ topico: "nada" }, /tópico sem critérios: "nada"/],
        [{ norma: "br/lei/2099/1" }, /norma não encontrada na base: "br\/lei\/2099\/1"/],
      ];
      for (const [args, mensagem] of casos) {
        const erro = yield* Effect.flip(responder(criteriosRevisaoPpc, args).pipe(Effect.provide(camada)));
        expect(ehEntradaInvalida(erro), JSON.stringify(args)).toBe(true);
        expect(yield* mensagemDeErro(criteriosRevisaoPpc, args).pipe(Effect.provide(camada))).toMatch(mensagem);
      }
    }),
  );
});

const leitura = layerLeitura({ banco, canal: "dev" });
const rodar = Command.runWith(Command.make("kb").pipe(Command.withSubcommands(comandosDeConsulta(leitura))), {
  version: "0.0.0",
});

layer(Layer.mergeAll(NodeServices.layer, TestConsole.layer, layerHandlers.pipe(Layer.provide(leitura))))((it) => {
  it.effect("kb criterios-revisao-ppc: a mesma entrada (flags) e a mesma resposta da ferramenta", () =>
    Effect.gen(function* () {
      const resposta = yield* Effect.flatMap(chamador, (chamar) =>
        chamar("criterios_revisao_ppc", { id: "CT-TESTE-01" }),
      );
      yield* rodar(["criterios-revisao-ppc", "--id", "CT-TESTE-01"]);
      yield* rodar(["criterios-revisao-ppc", "--topico", "egressos", "--json"]);
      const linhas = (yield* TestConsole.logLines).map(String);
      expect(linhas[0]).toBe(criteriosRevisaoPpc.textoCompleto(resposta as never));
      expect(JSON.parse(linhas[1]!).dados.criterios.map((c: { id: string }) => c.id)).toEqual(["CT-TESTE-01"]);
    }),
  );
});
