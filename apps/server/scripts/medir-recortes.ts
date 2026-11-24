// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- script de medição: arquivos e relógio de parede
/**
 * Medição offline dos recortes da revisão com IA (M1.11, etapa 4), sem gastar cota: para cada PPC
 * técnico da base (os 110 de `ppcsTecnicos`), monta o plano do modo rápido como o servidor monta
 * (`preparo.ts`, sobre o `tmp/kb.sqlite`) e confere, ficha a ficha, se o conteúdo do PPC que a IA
 * recebe contém a evidência do gabarito (`@simplifica-if/ppc/revisao-ia/gabarito`). A taxa é
 * condicional: só entram os pares (PPC, ficha) em que o próprio PPC tem a evidência.
 *
 *   node apps/server/scripts/medir-recortes.ts [--saida arquivo.json] [--limite N]
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import { segmentarPpc } from "@simplifica-if/kb/ppcs/secoes";
import { layerLeitura } from "@simplifica-if/mcp/rpc";
import { avaliarRecorte, GABARITO, nomesDoPpc } from "@simplifica-if/ppc/revisao-ia/gabarito";
import { montarBaseRevisao } from "@simplifica-if/ppc/base-revisao";
import { lerPpc, ppcsTecnicos } from "../../../packages/ppc/scripts/base-tecnica.ts";
import { preparar } from "../src/revisao-ppc/preparo.ts";

const RAIZ = NodePath.resolve(import.meta.dirname, "../../..");
const args = process.argv.slice(2);
const opcao = (nome: string) => {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : undefined;
};
const limite = Number(opcao("--limite") ?? Infinity);
const saida = opcao("--saida");

type Contagem = {
  comEvidencia: number;
  noRecorte: number;
  semEvidencia: number;
  naoSeAplica: number;
  caracteres: number;
  n: number;
};

const programa = Effect.gen(function* () {
  const inicio = Date.now();
  const porFicha = new Map<string, Contagem>();
  const enfermagem: Record<string, { noPpc: boolean | null; noRecorte: boolean }> = {};
  const caracteresPorTipo: Record<string, { soma: number; n: number }> = {};
  const { cncts } = yield* montarBaseRevisao;
  const ppcs = ppcsTecnicos(RAIZ, cncts).slice(0, limite);
  for (const ppc of ppcs) {
    const markdown = lerPpc(ppc);
    const plano = yield* preparar({
      markdown,
      linhasTextoParaIa: [],
      cnct: ppc.cnct?.slug ?? null,
      curso: null,
      modo: "rapido",
      nonce: "medida",
    });
    const secoes = segmentarPpc(plano.markdown, "tecnico").map((s) => ({ ...s, tipo: s.tipo }));
    const doPpc = { markdown: plano.markdown, secoes };
    const nomes = nomesDoPpc(doPpc);
    for (const bloco of plano.blocos) {
      const t = (caracteresPorTipo[bloco.tipo] ??= { soma: 0, n: 0 });
      t.soma += bloco.caracteres;
      t.n += 1;
      for (const ficha of bloco.fichas) {
        if (!GABARITO[ficha]) continue;
        const conteudo = bloco.alvos[ficha]?.alvo ?? "";
        const r = avaliarRecorte(ficha, conteudo, doPpc, nomes);
        const c = (porFicha.get(ficha) ?? {
          comEvidencia: 0,
          noRecorte: 0,
          semEvidencia: 0,
          naoSeAplica: 0,
          caracteres: 0,
          n: 0,
        }) as Contagem;
        c.n += 1;
        c.caracteres += conteudo.length;
        if (r.noPpc === null) c.naoSeAplica += 1;
        else if (!r.noPpc) c.semEvidencia += 1;
        else {
          c.comEvidencia += 1;
          if (r.noRecorte) c.noRecorte += 1;
        }
        porFicha.set(ficha, c);
        if (ppc.id === "curitiba/tecnico-em-enfermagem") enfermagem[ficha] = r;
      }
    }
  }
  const fichas = [...porFicha.entries()].sort(([a], [b]) => a.localeCompare(b));
  const total = fichas.reduce((t, [, c]) => ({ com: t.com + c.comEvidencia, no: t.no + c.noRecorte }), {
    com: 0,
    no: 0,
  });
  const resultado = {
    ppcs: ppcs.length,
    segundos: Math.round((Date.now() - inicio) / 100) / 10,
    taxa: Math.round((total.no / total.com) * 1000) / 10,
    pares: total,
    caracteresMediosPorBloco: Object.fromEntries(
      Object.entries(caracteresPorTipo).map(([tipo, v]) => [tipo, Math.round(v.soma / v.n)]),
    ),
    porFicha: Object.fromEntries(
      fichas.map(([f, c]) => [
        f,
        {
          taxa: c.comEvidencia ? Math.round((c.noRecorte / c.comEvidencia) * 1000) / 10 : null,
          comEvidencia: c.comEvidencia,
          semEvidencia: c.semEvidencia,
          naoSeAplica: c.naoSeAplica,
          caracteresMedios: Math.round(c.caracteres / c.n),
        },
      ]),
    ),
    enfermagem,
  };
  if (saida) NodeFS.writeFileSync(saida, JSON.stringify(resultado, null, 2));
  console.log(JSON.stringify({ ...resultado, enfermagem: undefined }, null, 2));
  console.log(
    "enfermagem (no PPC → no recorte):",
    Object.entries(enfermagem)
      .map(([f, r]) => `${f} ${r.noPpc === null ? "n/a" : r.noPpc ? (r.noRecorte ? "sim→sim" : "sim→NÃO") : "não tem"}`)
      .join("; "),
  );
});

programa.pipe(
  Effect.scoped,
  Effect.provide(layerLeitura({ banco: NodePath.join(RAIZ, "tmp/kb.sqlite"), canal: "dev" })),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
