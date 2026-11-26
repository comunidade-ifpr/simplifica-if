// @effect-diagnostics nodeBuiltinImport:off globalJsonInEffect:off -- script de avaliação: arquivos de trabalho em JSON e JSONL, lidos e gravados como texto
/**
 * Avaliação do critério do INCONCLUSIVO (M1.11, etapa 5): as duas instruções (`conservador`, o
 * padrão, e `ausencia`) sobre os mesmos pares (PPC, ficha), para uma pessoa rotular às cegas
 * (`planilha-inconclusivos.ts`).
 *
 *   node apps/server/scripts/modulos/revisao-ppc/avaliar-inconclusivos.ts selecionar [--pares 36] [--saida pasta]   # sem IA
 *   node apps/server/scripts/modulos/revisao-ppc/avaliar-inconclusivos.ts rodar [--saida pasta]                     # Claude, Sonnet
 *
 * `selecionar` escolhe os pares nos PPCs técnicos da base, fora o de Enfermagem de Curitiba (o do
 * teste real e do diagnóstico que ajustou os recortes), estratificados entre fichas S e J e entre PPC
 * com e sem a evidência do gabarito (o medidor offline, `avaliarRecorte`); poucos PPCs com vários pares
 * cada, para agrupar em lotes como na revisão real. Grava `conjunto.json`.
 *
 * `rodar` monta, por PPC, o plano do modo rápido só com as fichas escolhidas (os lotes S por tema e um
 * bloco J por tema, como o servidor) e julga cada bloco **uma vez com cada instrução**, pelo mesmo
 * `julgarBloco` do app (com a nova tentativa da conferência). Grava em `execucao.jsonl`, uma linha por
 * (PPC, instrução, bloco): o pedido, o conteúdo de cada ficha (o alvo dos trechos), as respostas
 * brutas de cada tentativa, os resultados conferidos, o uso e o tempo. Uma linha já gravada não roda de
 * novo (retomar depois de uma queda não repete chamada). Gasta a assinatura do usuário.
 *
 * Precisa do `tmp/kb.sqlite` (`pnpm kb:compilar`).
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Clock from "effect/Clock";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { executarPrincipal } from "@simplifica-if/kb/principal";
import { segmentarPpc } from "@simplifica-if/kb/ppcs/secoes";
import { layerLeitura } from "@simplifica-if/mcp/rpc";
import * as Motor from "@simplifica-if/motor";
import * as Drivers from "@simplifica-if/motor/drivers";
import { fixPath } from "@simplifica-if/motor/t3/os-jank";
import { avaliarRecorte, GABARITO, nomesDoPpc } from "@simplifica-if/ppc/revisao-ia/gabarito";
import {
  type AlvosDoBloco,
  CRITERIOS_INCONCLUSIVO,
  type CriterioInconclusivo,
} from "@simplifica-if/ppc/revisao-ia/pedido";
import { MODELO_PADRAO } from "../../../src/modulos/revisao-ppc/modelos.ts";
import { montarBaseRevisao } from "@simplifica-if/ppc/base-revisao";
import { lerPpc, type PpcDaBase, ppcsTecnicos } from "../../../../../packages/ppc/scripts/base-tecnica.ts";
import { julgarBloco, type ResultadoBloco, type TentativaIa } from "../../../src/modulos/revisao-ppc/julgamento.ts";
import { preparar } from "../../../src/modulos/revisao-ppc/preparo.ts";
import { TEMPO_TURNO } from "../../../src/modulos/revisao-ppc/RevisaoIa.ts";

const RAIZ = NodePath.resolve(import.meta.dirname, "../../../../..");
const args = process.argv.slice(2);
const comando = args[0];
const opcao = (nome: string) => {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : undefined;
};
const saida = opcao("--saida") ?? NodePath.join(NodeOS.tmpdir(), "simplifica-avaliacao-inconclusivos");
NodeFS.mkdirSync(saida, { recursive: true });
const arquivoConjunto = NodePath.join(saida, "conjunto.json");
const arquivoExecucao = NodePath.join(saida, "execucao.jsonl");

/** O PPC do teste real e do diagnóstico que ajustou os recortes: fica fora da avaliação. */
const EXCLUIDOS = new Set(["curitiba/tecnico-em-enfermagem"]);

export type Par = {
  ppc: string;
  ficha: string;
  modo: "S" | "J";
  /** O PPC tem a evidência do gabarito (medidor offline). */
  noPpc: boolean;
  /** O conteúdo entregue à ficha tem a evidência. */
  noRecorte: boolean;
};

/** Uma linha de `execucao.jsonl`: um bloco julgado com uma instrução. */
export type LinhaExecucao = {
  ppc: string;
  curso: string | null;
  criterio: CriterioInconclusivo;
  bloco: string;
  tipo: "S" | "J";
  fichas: string[];
  pedido: string;
  fontes: string[];
  /** O conteúdo do PPC entregue a cada ficha (o alvo dos trechos), para reavaliar sem chamada. */
  conteudo: Record<string, string>;
  /** Os alvos estruturados por ficha (alvo e seção), para reconferir sem reparsear o pedido. */
  alvos?: AlvosDoBloco;
  /** A resposta bruta de cada tentativa, na ordem. */
  respostas: string[];
  tentativas: TentativaIa[];
  resultado: ResultadoBloco;
  uso: TentativaIa["uso"];
  segundos: number;
};

/** Embaralhamento estável: o hash FNV-1a do texto. */
const hash = (texto: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) h = Math.imul(h ^ texto.charCodeAt(i), 0x01000193) >>> 0;
  return h;
};

const cursoDoPpc = (ppc: PpcDaBase) => {
  const denominacao = (ppc.cnct as { denominacao?: string } | null)?.denominacao;
  return denominacao ? `${denominacao}, forma de oferta ${ppc.forma || "não identificada"}` : null;
};

const selecionar = Effect.gen(function* () {
  const totalPares = Number(opcao("--pares") ?? 36);
  const porPpc = Number(opcao("--por-ppc") ?? 6);
  const maxPorFicha = Number(opcao("--por-ficha") ?? 3);
  const { cncts } = yield* montarBaseRevisao;
  const ppcs = ppcsTecnicos(RAIZ, cncts)
    .filter((p) => !EXCLUIDOS.has(p.id))
    .sort((a, b) => hash(a.id) - hash(b.id));
  const candidatos = new Map<string, Par[]>();
  for (const ppc of ppcs) {
    const plano = yield* preparar({
      markdown: lerPpc(ppc),
      linhasTextoParaIa: [],
      cnct: ppc.cnct?.slug ?? null,
      curso: null,
      modo: "rapido",
      nonce: "selecao",
    });
    const secoes = segmentarPpc(plano.markdown, "tecnico");
    const doPpc = { markdown: plano.markdown, secoes };
    const nomes = nomesDoPpc(doPpc);
    const pares: Par[] = [];
    for (const bloco of plano.blocos) {
      if (bloco.tipo === "T") continue;
      for (const ficha of bloco.fichas) {
        if (!GABARITO[ficha]) continue;
        const r = avaliarRecorte(ficha, bloco.alvos[ficha]?.alvo ?? "", doPpc, nomes);
        if (r.noPpc === null) continue;
        pares.push({ ppc: ppc.id, ficha, modo: bloco.tipo, noPpc: r.noPpc, noRecorte: r.noRecorte });
      }
    }
    candidatos.set(ppc.id, pares);
  }
  // Quatro estratos (S ou J × com ou sem a evidência no PPC), cotas iguais; um estrato raro na base
  // entra inteiro, e o que falta nele vai para os outros. Poucos PPCs, vários pares cada (lotes como
  // na revisão real); cada ficha no máximo `maxPorFicha` vezes, para variar os critérios (menos no
  // estrato raro, que entra inteiro).
  const estrato = (p: Par) => `${p.modo}-${p.noPpc ? "com" : "sem"}`;
  const ESTRATOS = ["S-com", "S-sem", "J-com", "J-sem"];
  const todos = [...candidatos.values()].flat();
  const disponiveis = Object.fromEntries(ESTRATOS.map((e) => [e, todos.filter((p) => estrato(p) === e).length]));
  const igual = Math.ceil(totalPares / 4);
  const raros = ESTRATOS.filter((e) => disponiveis[e]! < igual);
  const sobra = totalPares - raros.reduce((t, e) => t + disponiveis[e]!, 0);
  const cotas = new Map(
    ESTRATOS.map((e) => [e, raros.includes(e) ? disponiveis[e]! : Math.ceil(sobra / (4 - raros.length))]),
  );
  const noEstrato = new Map<string, number>();
  const daFicha = new Map<string, number>();
  const escolhidos: Par[] = [];
  for (const [ppc, pares] of candidatos) {
    if (escolhidos.length >= totalPares) break;
    let doPpc = 0;
    // Os estratos mais raros primeiro; dentro deles, ordem estável pelo hash.
    const ordenados = [...pares].sort(
      (a, b) =>
        (noEstrato.get(estrato(a)) ?? 0) - (noEstrato.get(estrato(b)) ?? 0) ||
        Number(a.noPpc) - Number(b.noPpc) ||
        hash(ppc + a.ficha) - hash(ppc + b.ficha),
    );
    for (const p of ordenados) {
      if (escolhidos.length >= totalPares) break;
      if (doPpc >= porPpc && !raros.includes(estrato(p))) continue;
      const raro = raros.includes(estrato(p));
      if ((noEstrato.get(estrato(p)) ?? 0) >= cotas.get(estrato(p))!) continue;
      if (!raro && (daFicha.get(p.ficha) ?? 0) >= maxPorFicha) continue;
      escolhidos.push(p);
      noEstrato.set(estrato(p), (noEstrato.get(estrato(p)) ?? 0) + 1);
      daFicha.set(p.ficha, (daFicha.get(p.ficha) ?? 0) + 1);
      doPpc += 1;
    }
  }
  const resumo = {
    pares: escolhidos.length,
    ppcs: new Set(escolhidos.map((p) => p.ppc)).size,
    estratos: Object.fromEntries(noEstrato),
    disponiveisNaBase: disponiveis,
    fichas: Object.fromEntries(daFicha),
    noRecorte: escolhidos.filter((p) => p.noRecorte).length,
  };
  NodeFS.writeFileSync(arquivoConjunto, JSON.stringify({ criterio: resumo, pares: escolhidos }, null, 2));
  yield* Console.log(JSON.stringify(resumo, null, 2));
});

const rodar = Effect.gen(function* () {
  yield* fixPath();
  const { pares } = JSON.parse(NodeFS.readFileSync(arquivoConjunto, "utf8")) as { pares: Par[] };
  const feitas = new Set(
    NodeFS.existsSync(arquivoExecucao)
      ? NodeFS.readFileSync(arquivoExecucao, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((l) => {
            const x = JSON.parse(l) as LinhaExecucao;
            return `${x.ppc}|${x.criterio}|${x.bloco}`;
          })
      : [],
  );
  const { cncts } = yield* montarBaseRevisao;
  const ppcs = new Map(ppcsTecnicos(RAIZ, cncts).map((p) => [p.id, p]));
  const porPpc = Map.groupBy(pares, (p) => p.ppc);
  const modelo = MODELO_PADRAO.claude ?? null;
  const inicio = yield* Clock.currentTimeMillis;
  for (const [id, doPpc] of porPpc) {
    const ppc = ppcs.get(id)!;
    const curso = cursoDoPpc(ppc);
    for (const criterio of CRITERIOS_INCONCLUSIVO) {
      const plano = yield* preparar({
        markdown: lerPpc(ppc),
        linhasTextoParaIa: [],
        cnct: ppc.cnct?.slug ?? null,
        curso,
        modo: "rapido",
        nonce: hash(`${id}|nonce`).toString(16).padStart(8, "0"),
        criterio,
        soFichas: doPpc.map((p) => p.ficha),
      });
      const porId = new Map(plano.fichas.map((f) => [f.id, f]));
      const blocos = plano.blocos.filter((b) => b.tipo !== "T" && !feitas.has(`${id}|${criterio}|${b.id}`));
      yield* Effect.forEach(
        blocos,
        (bloco) =>
          Effect.gen(function* () {
            const respostas: string[] = [];
            const tentativas: TentativaIa[] = [];
            const julgado = yield* julgarBloco({
              provider: "claude",
              modelo,
              nonce: plano.nonce,
              bloco,
              fichas: bloco.fichas.map((f) => porId.get(f)!),
              pedido: bloco.pedido,
              alvos: bloco.alvos,
              fontes: new Set(bloco.fontes),
              tempoTurno: TEMPO_TURNO,
              criterio,
              registrarTexto: (_n, texto) => Effect.sync(() => void respostas.push(texto)),
              registrarTentativa: (t) => Effect.sync(() => void tentativas.push(t)),
            });
            const linha: LinhaExecucao = {
              ppc: id,
              curso,
              criterio,
              bloco: bloco.id,
              tipo: bloco.tipo as "S" | "J",
              fichas: bloco.fichas,
              pedido: bloco.pedido,
              fontes: bloco.fontes,
              conteudo: Object.fromEntries(bloco.fichas.map((f) => [f, bloco.alvos[f]?.alvo ?? ""])),
              alvos: bloco.alvos,
              respostas,
              tentativas,
              ...julgado,
            };
            NodeFS.appendFileSync(arquivoExecucao, `${JSON.stringify(linha)}\n`);
            const agora = yield* Clock.currentTimeMillis;
            yield* Console.error(
              `${((agora - inicio) / 1000).toFixed(0)} s: ${id} ${criterio} ${bloco.id} (${bloco.fichas.length} fichas), ${julgado.resultado.tentativas} tentativa(s), ${julgado.uso.entrada}+${julgado.uso.saida} tokens, US$ ${julgado.uso.custoUsd.toFixed(3)}`,
            );
          }),
        { concurrency: 2, discard: true },
      );
    }
  }
});

const pastaEstado =
  process.env["SIMPLIFICA_ESTADO"] ??
  (NodeOS.platform() === "darwin"
    ? NodePath.join(NodeOS.homedir(), "Library", "Application Support", "simplifica-if-poc")
    : NodePath.join(NodeOS.homedir(), ".simplifica-if-poc"));
const kb = layerLeitura({ banco: NodePath.join(RAIZ, "tmp/kb.sqlite"), canal: "dev" });

const programa =
  comando === "selecionar"
    ? selecionar.pipe(Effect.scoped, Effect.provide(kb))
    : comando === "rodar"
      ? rodar.pipe(
          Effect.scoped,
          Effect.provide(
            Layer.mergeAll(
              kb,
              Motor.layer.pipe(Layer.provide(Drivers.layerNode({ ambiente: process.env, pastaEstado }))),
            ),
          ),
        )
      : Effect.die("use: selecionar | rodar");

executarPrincipal("avaliar-inconclusivos", programa);
