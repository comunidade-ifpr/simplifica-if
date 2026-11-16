// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- script de medição: arquivos, relógio de parede
/**
 * Teste real da conversa por pendência (M1.11, etapa 5b): um PPC da base (Markdown público, convertido
 * aqui para DOCX, como no `revisao-ia-real.ts`) passa pela pré-conferência (sem IA), e a lista viva
 * fica num banco na pasta de saída. Duas fases, para escolher as pendências antes de gastar:
 *
 *   node apps/server/scripts/lista-viva-real.ts --listar
 *   node apps/server/scripts/lista-viva-real.ts --fundamentada <chave> "<motivo>" --sem-fundamento <chave> "<motivo>" --sugerir <chave>
 *
 * A segunda fase faz, na ordem: a contestação fundamentada, a sem fundamento e o "Sugerir texto", e
 * imprime a decisão, a sugestão e o uso de cada ação (tokens, cache, segundos, custo). Gasta a
 * assinatura do usuário (Claude): uma execução por medição. Precisa do `tmp/kb.sqlite`.
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { celula, montarDocx, par, run, tabelaDeTextos } from "@simplifica-if/docx/testes/sintetico";
import { layerLeitura } from "@simplifica-if/mcp/rpc";
import * as Motor from "@simplifica-if/motor";
import * as Drivers from "@simplifica-if/motor/drivers";
import { fixPath } from "@simplifica-if/motor/t3/os-jank";
import * as Banco from "../src/persistencia/Banco.ts";
import * as Listas from "../src/persistencia/Listas.ts";
import * as Revisoes from "../src/persistencia/Revisoes.ts";
import * as AnalisePpc from "../src/revisao-ppc/AnalisePpc.ts";
import * as ListaViva from "../src/revisao-ppc/ListaViva.ts";

const RAIZ = NodePath.resolve(import.meta.dirname, "../../..");
const args = process.argv.slice(2);
const depois = (nome: string, n = 1) => {
  const i = args.indexOf(nome);
  return i >= 0 ? args.slice(i + 1, i + 1 + n) : undefined;
};
const ppcMd =
  depois("--ppc")?.[0] ??
  NodePath.join(RAIZ, "base-conhecimento/institucional/ifpr/ppcs/curitiba/tecnico-em-enfermagem.md");
const saida = depois("--saida")?.[0] ?? NodePath.join(NodeOS.tmpdir(), "simplifica-lista-viva-real");
NodeFS.mkdirSync(saida, { recursive: true });

/** Markdown da base → DOCX simples: títulos com estilo, tabelas e parágrafos (sem injeção plantada). */
function docxDoMarkdown(markdown: string): Uint8Array {
  const corpo: string[] = [];
  let tabela: string[][] = [];
  const fechar = () => {
    if (tabela.length) corpo.push(tabelaDeTextos(tabela), par(""));
    tabela = [];
  };
  const limpar = (t: string) =>
    t
      .replace(/\*\*|__|`/g, "")
      .replace(/<br\s*\/?>/g, " ")
      .trim();
  for (const linha of markdown.replace(/^---\n[\s\S]*?\n---\n/, "").split("\n")) {
    if (linha.startsWith("|")) {
      if (/^\|[\s:|-]+\|?$/.test(linha)) continue;
      tabela.push(
        linha
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((t) => celula(par(run(limpar(t))))),
      );
      continue;
    }
    fechar();
    const titulo = /^(#{1,6})\s+(.*)$/.exec(linha);
    if (titulo) {
      corpo.push(par(run(limpar(titulo[2]!)), { estilo: `Heading${Math.min(Math.max(1, titulo[1]!.length - 1), 3)}` }));
      continue;
    }
    if (linha.trim()) corpo.push(par(run(limpar(linha))));
  }
  fechar();
  return montarDocx({ corpo: corpo.join("") });
}

const programa = Effect.gen(function* () {
  yield* fixPath();
  const viva = yield* ListaViva.ListaViva;
  const listas = yield* Listas.Listas;
  const arquivo = NodePath.join(saida, `PPC ${NodePath.basename(ppcMd, ".md")} (base).docx`);
  if (args.includes("--listar")) {
    NodeFS.writeFileSync(arquivo, docxDoMarkdown(NodeFS.readFileSync(ppcMd, "utf8")));
    const r = yield* viva.analisar({ arquivo });
    const lista = yield* viva.lista(r.lista!);
    for (const p of lista.pendencias)
      console.log(
        [
          p.chave,
          p.pendencia.tema,
          p.pendencia.estado,
          p.pendencia.tituloFicha,
          p.pendencia.mensagem.slice(0, 220),
        ].join(" | "),
      );
    return;
  }
  const id = (yield* listas.ultima)!;
  const relatorio: unknown[] = [];
  /** Roda uma ação e registra a situação, o texto e o uso do último passo do histórico da pendência. */
  const medir = Effect.fn("ListaVivaReal.medir")(function* (
    rotulo: string,
    chave: string,
    acao: Effect.Effect<unknown, unknown>,
  ) {
    const inicio = Date.now();
    const resultado = yield* Effect.result(acao);
    const segundos = Math.round((Date.now() - inicio) / 100) / 10;
    const lista = yield* viva.lista(id);
    const p = lista.pendencias.find((x) => x.chave === chave)!;
    const evento = p.historico.at(-1);
    const linha = {
      rotulo,
      chave,
      segundos,
      ok: resultado._tag === "Success",
      erro: resultado._tag === "Failure" ? String(resultado.failure) : null,
      situacao: p.situacao,
      texto: evento?.texto,
      uso: evento?.uso,
      sugestao: rotulo === "sugerir" ? p.sugestao : undefined,
    };
    relatorio.push(linha);
    console.error(JSON.stringify(linha, null, 2));
  });
  const fundamentada = depois("--fundamentada", 2);
  if (fundamentada)
    yield* medir("fundamentada", fundamentada[0]!, viva.contestar(id, fundamentada[0]!, fundamentada[1]!, "claude"));
  const semFundamento = depois("--sem-fundamento", 2);
  if (semFundamento)
    yield* medir(
      "sem-fundamento",
      semFundamento[0]!,
      viva.contestar(id, semFundamento[0]!, semFundamento[1]!, "claude"),
    );
  const sugerir = depois("--sugerir");
  if (sugerir) yield* medir("sugerir", sugerir[0]!, viva.sugerir(id, sugerir[0]!, "claude"));
  const final = yield* viva.lista(id);
  const saidaJson = { uso: final.uso, acoes: relatorio };
  NodeFS.writeFileSync(NodePath.join(saida, "lista-viva-claude.json"), JSON.stringify(saidaJson, null, 2));
  console.log(JSON.stringify({ uso: final.uso }, null, 2));
});

const pastaEstado =
  process.env["SIMPLIFICA_ESTADO"] ??
  // oxlint-disable-next-line simplifica-if/no-global-process-runtime -- script de medição, fora do app
  (NodeOS.platform() === "darwin"
    ? NodePath.join(NodeOS.homedir(), "Library", "Application Support", "simplifica-if-poc")
    : NodePath.join(NodeOS.homedir(), ".simplifica-if-poc"));
const drivers = Drivers.layerNode({ ambiente: process.env, pastaEstado });
const banco = Banco.layerArquivo(NodePath.join(saida, "conversas.sqlite"));
// O texto bruto de cada resposta, para reconferir sem nova chamada (fica só na pasta de saída).
const registrarTexto = (acao: string, chave: string, texto: string) =>
  Effect.sync(() =>
    NodeFS.appendFileSync(NodePath.join(saida, "textos.jsonl"), `${JSON.stringify({ acao, chave, texto })}\n`),
  );
const nucleo = ListaViva.layer({ registrarTexto }).pipe(
  Layer.provideMerge(Listas.layer.pipe(Layer.provide(banco))),
  Layer.provideMerge(Revisoes.layer.pipe(Layer.provide(banco))),
  Layer.provideMerge(AnalisePpc.layer()),
  Layer.provideMerge(Motor.layer.pipe(Layer.provide(drivers))),
  Layer.provideMerge(layerLeitura({ banco: NodePath.join(RAIZ, "tmp/kb.sqlite"), canal: "dev" })),
);

programa.pipe(Effect.provide(nucleo), Effect.provide(NodeServices.layer), NodeRuntime.runMain);
