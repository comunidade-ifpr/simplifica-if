// @effect-diagnostics nodeBuiltinImport:off globalJsonInEffect:off -- script de medição: caminhos na montagem e as medidas impressas em JSON
/**
 * Teste real da conversa por pendência (M1.11, etapa 5b): um PPC da base (Markdown público, convertido
 * aqui para DOCX, como no `revisao-ia-real.ts`) passa pela pré-conferência (sem IA), e a lista viva
 * fica num banco na pasta de saída. Duas fases, para escolher as pendências antes de gastar:
 *
 *   node apps/server/scripts/modulos/revisao-ppc/lista-viva-real.ts --listar
 *   node apps/server/scripts/modulos/revisao-ppc/lista-viva-real.ts --fundamentada <chave> "<motivo>" --sem-fundamento <chave> "<motivo>" --sugerir <chave>
 *
 * A segunda fase faz, na ordem: a contestação fundamentada, a sem fundamento e o "Sugerir texto", sobre a
 * lista mais recente do banco, e imprime a decisão, a sugestão e o uso de cada ação (tokens, cache,
 * segundos, custo). Gasta a assinatura do usuário (Claude): uma execução por medição.
 *
 * Outras opções: `--recorte <ficha> [--inteiro]` (sem IA: os títulos, ou o texto inteiro, do recorte da
 * ficha e o tamanho dele); `--ia <ficha,ficha>` (gasta: cada ficha num lote de uma, como na nova
 * revisão, e uma lista nova com esses resultados, para contestar pendências da IA); `--ppc <arquivo .md
 * da base>`; `--saida <pasta>`. Precisa do `tmp/kb.sqlite`.
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Clock from "effect/Clock";
import * as Console from "effect/Console";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import type { AvisoNaoAceito } from "@simplifica-if/contratos-app";
import type { FalhaRevisaoPpc } from "@simplifica-if/contratos-app/modulos/revisao-ppc";
import { executarPrincipal } from "@simplifica-if/kb/principal";
import { fixPath } from "@simplifica-if/motor/t3/os-jank";
import { alvosPorRecorte, pedidoS } from "@simplifica-if/ppc/revisao-ia/pedido";
import type { ResultadoFichaIa } from "@simplifica-if/ppc/revisao-previa";
import { julgarBloco } from "../../../src/modulos/revisao-ppc/julgamento.ts";
import * as ListaViva from "../../../src/modulos/revisao-ppc/ListaViva.ts";
import { MODELO_PADRAO } from "../../../src/modulos/revisao-ppc/modelos.ts";
import * as RevisoesPpc from "../../../src/modulos/revisao-ppc/persistencia/RevisoesPpc.ts";
import { contextoDaFicha } from "../../../src/modulos/revisao-ppc/preparo.ts";
import * as RevisorPpc from "../../../src/modulos/revisao-ppc/RevisorPpc.ts";
import { docxDoMarkdown, layerNucleo, leitorDeArgumentos, PPC_PADRAO, revisarAteALista } from "./apoio.ts";

const args = leitorDeArgumentos(process.argv.slice(2));
const ppcMd = args.depois("--ppc")?.[0] ?? PPC_PADRAO;
const saida = args.depois("--saida")?.[0] ?? NodePath.join(NodeOS.tmpdir(), "simplifica-lista-viva-real");

const programa = Effect.gen(function* () {
  yield* fixPath();
  const fs = yield* FileSystem.FileSystem;
  const viva = yield* ListaViva.ListaViva;
  const persistencia = yield* RevisoesPpc.RevisoesPpc;
  const arquivo = NodePath.join(saida, `PPC ${NodePath.basename(ppcMd, ".md")} (base).docx`);
  const gravarDocx = Effect.flatMap(fs.readFileString(ppcMd), (markdown) =>
    fs.writeFile(arquivo, docxDoMarkdown(markdown)),
  );

  if (args.tem("--listar")) {
    yield* gravarDocx;
    const lista = yield* viva.lista(yield* revisarAteALista(arquivo));
    for (const p of lista.pendencias)
      yield* Console.log(
        [p.chave, p.pendencia.tema, p.pendencia.estado, p.pendencia.tituloFicha, p.pendencia.titulo.slice(0, 220)].join(
          " | ",
        ),
      );
    return;
  }

  const soRecorte = args.depois("--recorte")?.[0];
  if (soRecorte !== undefined) {
    // Sem IA: os títulos e o tamanho da seção do critério (onde a prova de leitura tem de estar).
    const revisor = yield* RevisorPpc.RevisorPpc;
    yield* gravarDocx;
    const base = yield* revisor.revisarArquivo({ arquivo, gravar: false });
    const ctx = yield* contextoDaFicha({
      markdown: base.revisao.markdown,
      linhasTextoParaIa: base.revisao.linhasTextoParaIa,
      cnct: base.revisao.curso.cnct?.slug ?? null,
      curso: null,
      ficha: soRecorte,
    });
    if (ctx === null) return yield* Effect.die(`a ficha ${soRecorte} não tem recorte`);
    yield* Console.log(
      args.tem("--inteiro")
        ? ctx.proprio.texto
        : ctx.proprio.texto
            .split("\n")
            .filter((l) => l.startsWith("#"))
            .join("\n"),
      ctx.proprio.texto.length,
    );
    return;
  }

  const fichasIa = args.depois("--ia")?.[0];
  if (fichasIa !== undefined) {
    // Uma lista com pendências da IA, sem pagar o relatório inteiro: cada ficha num lote de uma (como
    // na nova revisão), e a lista montada com esses resultados.
    yield* gravarDocx;
    const revisor = yield* RevisorPpc.RevisorPpc;
    const base = yield* revisor.revisarArquivo({ arquivo, gravar: false });
    const curso = base.revisao.curso.cnct
      ? `${base.revisao.curso.cnct.denominacao}, forma de oferta ${base.revisao.curso.forma ?? "não identificada"}`
      : null;
    const resultados: ResultadoFichaIa[] = [];
    for (const ficha of fichasIa.split(",")) {
      const ctx = yield* contextoDaFicha({
        markdown: base.revisao.markdown,
        linhasTextoParaIa: base.revisao.linhasTextoParaIa,
        cnct: base.revisao.curso.cnct?.slug ?? null,
        curso,
        ficha,
      });
      if (ctx === null) return yield* Effect.die(`a ficha ${ficha} não tem recorte`);
      const bloco = { id: `s-${ficha.toLowerCase()}`, tipo: "S" as const, tema: "", ordemTema: 0, fichas: [ficha] };
      const nonce = "a1b2c3d4e5f60718";
      const recortes = new Map([[ficha, ctx.proprio]]);
      const julgado = yield* julgarBloco({
        provider: "claude",
        modelo: MODELO_PADRAO.claude ?? null,
        nonce,
        bloco,
        fichas: [ctx.ficha],
        pedido: pedidoS(bloco, [ctx.ficha], recortes, ctx.contexto, nonce, ctx.comum),
        alvos: alvosPorRecorte([ctx.ficha], recortes, ctx.comum),
        fontes: new Set(ctx.fontes),
        tempoTurno: ListaViva.TEMPO_ACAO,
      });
      yield* Console.error(
        ficha,
        julgado.resultado.resultados[0]!.estado,
        JSON.stringify(julgado.uso),
        `${julgado.segundos} s`,
      );
      resultados.push(...julgado.resultado.resultados);
    }
    const ia = { resultados, fora: [] };
    const revisado = yield* revisor.revisarArquivo({ arquivo, gravar: true, ia });
    const aleatorio = yield* SecureRandom.SecureRandom;
    const { lista: nova, pendencias } = ListaViva.novaLista({
      id: `lista-${yield* aleatorio.uuidV4()}`,
      arquivo,
      revisado,
      revisao: null,
      provider: "claude",
      modelo: MODELO_PADRAO.claude ?? null,
      resultadosIa: ia,
    });
    yield* persistencia.criarLista(nova, pendencias);
    const lista = yield* viva.lista(nova.id);
    for (const p of lista.pendencias.filter((x) => x.pendencia.origem === "ia"))
      yield* Console.log(
        [p.chave, p.pendencia.estado, p.pendencia.tituloFicha, p.pendencia.titulo.slice(0, 300)].join(" | "),
      );
    return;
  }

  const id = (yield* persistencia.todasListas)[0];
  if (id === undefined) return yield* Effect.die("nenhuma lista no banco da pasta de saída: rode antes com --listar");
  const relatorio: unknown[] = [];
  /** Roda uma ação e registra a situação, o texto e o uso do último passo do histórico da pendência. */
  const medir = Effect.fn("lista-viva-real.medir")(function* (
    rotulo: string,
    chave: string,
    acao: Effect.Effect<unknown, FalhaRevisaoPpc | AvisoNaoAceito>,
  ) {
    const estimativa = yield* viva.estimar(id, chave, rotulo === "sugerir" ? "sugerir" : "contestar", "claude");
    const inicio = yield* Clock.currentTimeMillis;
    const resultado = yield* Effect.result(acao);
    const segundos = Math.round(((yield* Clock.currentTimeMillis) - inicio) / 100) / 10;
    const lista = yield* viva.lista(id);
    const p = lista.pendencias.find((x) => x.chave === chave)!;
    const evento = p.historico.at(-1);
    const linha = {
      rotulo,
      chave,
      segundos,
      estimativa,
      ok: resultado._tag === "Success",
      erro: resultado._tag === "Failure" ? resultado.failure.message : null,
      situacao: p.situacao,
      texto: evento?.texto,
      uso: evento?.uso,
      sugestao: rotulo === "sugerir" ? p.sugestao : undefined,
    };
    relatorio.push(linha);
    yield* Console.error(JSON.stringify(linha, null, 2));
  });
  const fundamentada = args.depois("--fundamentada", 2);
  if (fundamentada)
    yield* medir("fundamentada", fundamentada[0]!, viva.contestar(id, fundamentada[0]!, fundamentada[1]!, "claude"));
  const semFundamento = args.depois("--sem-fundamento", 2);
  if (semFundamento)
    yield* medir(
      "sem-fundamento",
      semFundamento[0]!,
      viva.contestar(id, semFundamento[0]!, semFundamento[1]!, "claude"),
    );
  const sugerir = args.depois("--sugerir");
  if (sugerir) yield* medir("sugerir", sugerir[0]!, viva.sugerir(id, sugerir[0]!, "claude"));
  const final = yield* viva.lista(id);
  yield* fs.writeFileString(
    NodePath.join(saida, "lista-viva-claude.json"),
    JSON.stringify({ uso: final.uso, acoes: relatorio }, null, 2),
  );
  yield* Console.log(JSON.stringify({ uso: final.uso }, null, 2));
});

// O texto bruto de cada resposta, para reconferir sem nova chamada (fica só na pasta de saída). O banco
// fica na mesma pasta, e a pasta tem de existir antes de a layer abri-lo.
NodeFS.mkdirSync(saida, { recursive: true });
const registrarTexto = (acao: string, chave: string, texto: string) =>
  Effect.sync(() =>
    NodeFS.appendFileSync(NodePath.join(saida, "textos.jsonl"), `${JSON.stringify({ acao, chave, texto })}\n`),
  );

executarPrincipal(
  "lista-viva-real",
  programa.pipe(
    Effect.provide(
      layerNucleo({
        ambiente: process.env,
        bancoConversas: NodePath.join(saida, "conversas.sqlite"),
        listaViva: { registrarTexto },
      }),
    ),
  ),
);
