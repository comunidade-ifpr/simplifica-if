/**
 * Harness de avaliação da base (fase 1 do PLANO-ARQUITETURA.md): roda as perguntas de
 * `avaliacao/perguntas.yaml` num agente real (`claude -p`), pontua de forma determinística e grava
 * o relatório datado em `avaliacao/resultados/`.
 *
 *   node scripts/avaliar.ts --dry-run                      # mostra o que rodaria, sem custo
 *   node scripts/avaliar.ts --pergunta Q09 --execucoes 1   # roda só uma pergunta
 *   node scripts/avaliar.ts --modelo haiku                 # sobrescreve o modelo do config
 *   node scripts/avaliar.ts --pontuar avaliacao/resultados/<rodada>/relatorio.json
 *
 * Modelo, execuções por pergunta, limite de turnos e ferramentas vêm de `avaliacao/config.yaml`.
 * Ctrl-C interrompe a rodada e mata o `claude` em curso; o relatório fica com as execuções já feitas.
 */
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Terminal from "effect/Terminal";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import {
  arquivoInvalido,
  carregarConfig,
  carregarGabaritoConjunto,
  carregarPerguntas,
  carregarUniversos,
  DIR_AVALIACAO,
  ehArquivoAvaliacaoInvalido,
  RAIZ_REPOSITORIO,
  type ArquivoAvaliacaoInvalido,
} from "./avaliacao/carregar.ts";
import type { ConfigAvaliacao, GabaritoConjunto, Pergunta, Universos } from "./avaliacao/esquema.ts";
import { argumentosClaude, comandoLegivel, executarPergunta } from "./avaliacao/executor.ts";
import { serializarJson } from "./avaliacao/normalizar.ts";
import { pontuarResposta } from "./avaliacao/pontuacao.ts";
import { esquemaRelatorioSalvo, resumoMarkdown, type RegistroExecucao, type Relatorio } from "./avaliacao/relatorio.ts";
import { ESTRITO } from "./esquema.ts";
import * as Git from "./git.ts";
import { executarPrincipal } from "./principal.ts";

/* ------------------------------------------------------------------ erros */

/** `--pergunta` com IDs que não estão em `perguntas.yaml`. */
export class PerguntasInexistentes extends Schema.TaggedError<PerguntasInexistentes>()("PerguntasInexistentes", {
  ids: Schema.Array(Schema.String),
}) {
  override get message(): string {
    return `Perguntas inexistentes: ${this.ids.join(", ")}`;
  }
}

/** Arquivo de `avaliacao/` (ou o `--config`) que o sistema não deixou ler; `codigo` é o do Node (`ENOENT`...). */
export class ArquivoIlegivel extends Schema.TaggedError<ArquivoIlegivel>()("ArquivoIlegivel", {
  caminho: Schema.String,
  codigo: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `não foi possível ler ${this.caminho} (${this.codigo})`;
  }
}

/** Erro do sistema de arquivos do Node (`ENOENT`, `EACCES`...), com o caminho. */
function erroDeArquivo(erro: unknown): erro is Error & { code: string; path: string } {
  return (
    erro instanceof Error &&
    typeof (erro as { code?: unknown }).code === "string" &&
    typeof (erro as { path?: unknown }).path === "string"
  );
}

/* --------------------------------------------------------------- contexto */

interface Contexto {
  perguntas: readonly Pergunta[];
  conjuntos: Map<string, GabaritoConjunto>;
  universos: Universos;
}

/**
 * Roda um carregador síncrono de `carregar.ts`: arquivo fora do contrato ou ilegível é erro
 * tipado; qualquer outra exceção (YAML ou JSON malformado) é defeito, com a pilha no stderr.
 */
function sincrono<A>(carregar: () => A): Effect.Effect<A, ArquivoAvaliacaoInvalido | ArquivoIlegivel> {
  return Effect.suspend((): Effect.Effect<A, ArquivoAvaliacaoInvalido | ArquivoIlegivel> => {
    try {
      return Effect.succeed(carregar());
    } catch (erro) {
      if (ehArquivoAvaliacaoInvalido(erro)) return Effect.fail(erro);
      if (erroDeArquivo(erro))
        return Effect.fail(new ArquivoIlegivel({ caminho: erro.path, codigo: erro.code, cause: erro }));
      return Effect.die(erro);
    }
  });
}

const carregarContexto = Effect.fn("avaliar.carregarContexto")(function* (filtro: readonly string[]) {
  const todas = (yield* sincrono(() => carregarPerguntas())).perguntas;
  const desconhecidas = filtro.filter((id) => !todas.some((pergunta) => pergunta.id === id));
  if (desconhecidas.length > 0) return yield* new PerguntasInexistentes({ ids: desconhecidas });
  const perguntas = filtro.length === 0 ? todas : todas.filter((pergunta) => filtro.includes(pergunta.id));
  const conjuntos = new Map<string, GabaritoConjunto>();
  for (const pergunta of perguntas) {
    const conjunto = pergunta.gabarito.conjunto;
    if (conjunto) conjuntos.set(pergunta.id, yield* sincrono(() => carregarGabaritoConjunto(conjunto.arquivo)));
  }
  const universos = yield* sincrono(() => carregarUniversos());
  return { perguntas, conjuntos, universos } satisfies Contexto;
});

function pontuar(contexto: Contexto, pergunta: Pergunta, resposta: string) {
  return pontuarResposta(pergunta, resposta, {
    conjunto: contexto.conjuntos.get(pergunta.id),
    universos: contexto.universos,
  });
}

const commitAtual = Effect.fn("avaliar.commitAtual")(function* () {
  const rev = yield* Git.tentar(["rev-parse", "--short", "HEAD"], { cwd: RAIZ_REPOSITORIO });
  if (Option.isNone(rev)) return null;
  const status = yield* Git.tentar(["status", "--porcelain"], { cwd: RAIZ_REPOSITORIO });
  const sujo = Option.isSome(status) && status.value.trim() !== "";
  return `${rev.value.trim()}${sujo ? " (com alterações locais)" : ""}`;
});

/** ISO 8601 em UTC com milissegundos, como o `Date.prototype.toISOString`. */
const agoraIso = Effect.map(DateTime.now, DateTime.formatIso);

/** Instante ISO sem milissegundos e sem `:`, para nome de diretório. */
function carimbo(iso: string): string {
  return iso.replace(/\.\d{3}Z$/u, "Z").replace(/:/gu, "-");
}

const gravarRelatorio = Effect.fn("avaliar.gravarRelatorio")(function* (
  dir: string,
  relatorio: Relatorio,
  perguntas: readonly Pergunta[],
  sufixo = "",
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.writeFileString(path.join(dir, `relatorio${sufixo}.json`), serializarJson(relatorio));
  yield* fs.writeFileString(path.join(dir, `resumo${sufixo}.md`), resumoMarkdown(relatorio, perguntas));
});

function listarPerguntas(id: string): string[] {
  return id
    .split(",")
    .map((parte) => parte.trim().toUpperCase())
    .filter(Boolean);
}

function resumoPerguntas(perguntas: readonly Pergunta[]): Relatorio["perguntas"] {
  return perguntas.map((pergunta) => ({
    id: pergunta.id,
    categoria: pergunta.categoria,
    tipo: pergunta.tipo,
    status_gabarito: pergunta.gabarito.status,
  }));
}

/* ------------------------------------------------------------------ modos */

const modoDryRun = Effect.fn("avaliar.modoDryRun")(function* (
  contexto: Contexto,
  execucoes: number,
  modelo: string,
  config: ConfigAvaliacao,
) {
  yield* Console.log(`Modelo: ${modelo} · execuções por pergunta: ${execucoes} · max_turns: ${config.max_turns}`);
  yield* Console.log(
    `Total: ${contexto.perguntas.length * execucoes} chamadas de claude -p (cwd ${RAIZ_REPOSITORIO})\n`,
  );
  for (const pergunta of contexto.perguntas) {
    const { gabarito } = pergunta;
    const conjunto = contexto.conjuntos.get(pergunta.id);
    const partes = [
      `${gabarito.deve_conter.length} deve_conter`,
      `${gabarito.nao_deve_conter.length} nao_deve_conter`,
      conjunto ? `conjunto ${conjunto.universo} com ${conjunto.esperado.length} itens` : null,
    ].filter(Boolean);
    yield* Console.log(
      `${pergunta.id} [${pergunta.categoria}, ${pergunta.tipo}, gabarito ${gabarito.status}] ${partes.join(", ")}`,
    );
    yield* Console.log(`  ${pergunta.texto}`);
  }
  const exemplo = contexto.perguntas[0];
  if (exemplo) {
    yield* Console.log(`\nComando (${exemplo.id}):`);
    yield* Console.log(comandoLegivel("claude", argumentosClaude(exemplo.texto, { config, modelo })));
  }
});

const decodificarRelatorioSalvo = Schema.decodeUnknownEffect(Schema.fromJsonString(esquemaRelatorioSalvo));

const modoPontuar = Effect.fn("avaliar.modoPontuar")(function* (
  contexto: Contexto,
  arquivo: string,
  filtro: readonly string[],
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const caminho = path.resolve(arquivo);
  const salvo = yield* decodificarRelatorioSalvo(yield* fs.readFileString(caminho), ESTRITO).pipe(
    Effect.catchTags({ SchemaError: (erro) => Effect.fail(arquivoInvalido(arquivo, erro)) }),
  );
  const original = salvo as unknown as Relatorio;
  const porId = new Map(contexto.perguntas.map((pergunta) => [pergunta.id, pergunta]));
  const execucoes: RegistroExecucao[] = [];
  for (const registro of original.execucoes) {
    const pergunta = porId.get(registro.pergunta);
    if (!pergunta || (filtro.length > 0 && !filtro.includes(pergunta.id))) continue;
    execucoes.push({ ...registro, pontuacao: pontuar(contexto, pergunta, registro.execucao_agente.resposta) });
  }
  const ids = new Set(execucoes.map((registro) => registro.pergunta));
  const relatorio: Relatorio = {
    ...original,
    perguntas: resumoPerguntas(contexto.perguntas.filter((pergunta) => ids.has(pergunta.id))),
    execucoes,
  };
  yield* gravarRelatorio(path.dirname(caminho), relatorio, contexto.perguntas, "-repontuado");
  yield* Console.log(
    `${execucoes.length} execuções repontuadas em ${path.relative(RAIZ_REPOSITORIO, path.dirname(caminho))}/`,
  );
  yield* Console.log(resumoMarkdown(relatorio, contexto.perguntas).split("\n## Detalhe")[0]);
});

const modoExecutar = Effect.fn("avaliar.modoExecutar")(function* (
  contexto: Contexto,
  execucoes: number,
  modelo: string,
  config: ConfigAvaliacao,
  saida: string | undefined,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const terminal = yield* Terminal.Terminal;
  const inicio = yield* agoraIso;
  const dir = path.resolve(
    saida ?? path.join(DIR_AVALIACAO, "resultados", `${carimbo(inicio)}-${modelo.replace(/[^\w.-]+/gu, "_")}`),
  );
  yield* fs.makeDirectory(path.join(dir, "brutos"), { recursive: true });
  const relatorio: Relatorio = {
    versao: 1,
    iniciado_em: inicio,
    concluido_em: inicio,
    modelo_solicitado: modelo,
    config: { ...config, modelo, execucoes },
    commit: yield* commitAtual(),
    perguntas: resumoPerguntas(contexto.perguntas),
    execucoes: [],
  };
  for (const pergunta of contexto.perguntas) {
    for (let n = 1; n <= execucoes; n++) {
      yield* terminal.display(`${pergunta.id} #${n} … `);
      const bruta = yield* executarPergunta(pergunta.texto, RAIZ_REPOSITORIO, { config, modelo });
      const arquivoBruto = path.join("brutos", `${pergunta.id}-${n}.jsonl`);
      yield* fs.writeFileString(path.join(dir, arquivoBruto), bruta.saida);
      if (bruta.stderr.trim()) {
        yield* fs.writeFileString(path.join(dir, "brutos", `${pergunta.id}-${n}.stderr.txt`), bruta.stderr);
      }
      const execucao = bruta.execucao;
      const pontuacao = pontuar(contexto, pergunta, execucao.resposta);
      relatorio.execucoes.push({
        pergunta: pergunta.id,
        execucao: n,
        execucao_agente: execucao,
        pontuacao,
        bruto: arquivoBruto,
      });
      relatorio.concluido_em = yield* agoraIso;
      yield* gravarRelatorio(dir, relatorio, contexto.perguntas);
      yield* Console.log(
        `nota ${pontuacao.nota.toFixed(2)} · ${execucao.desfecho} · ${execucao.chamadas_ferramenta} ferramentas · ${execucao.tokens.total} tokens · US$ ${(execucao.custo_usd ?? 0).toFixed(3)}`,
      );
    }
  }
  yield* Console.log(`\nRelatório: ${path.relative(RAIZ_REPOSITORIO, dir)}/resumo.md`);
});

/* ------------------------------------------------------------------- CLI */

const textoOpcional = (nome: string, descricao: string) =>
  Flag.String(nome).pipe(Flag.withDescription(descricao), Flag.optional);

const avaliar = Command.make(
  "avaliar",
  {
    pergunta: Flag.String("pergunta").pipe(
      Flag.withDescription("só estas perguntas (Q01,Q09 ou a opção repetida)"),
      Flag.atLeast(0),
    ),
    execucoes: Flag.Int("execucoes").pipe(
      Flag.withDescription("execuções por pergunta (padrão: config.yaml)"),
      Flag.filter(
        (n) => n >= 1,
        (n) => `--execucoes inválido: ${n}`,
      ),
      Flag.optional,
    ),
    modelo: textoOpcional("modelo", "modelo do claude -p (padrão: config.yaml)"),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription("mostra perguntas, gabaritos e comandos, sem chamar o modelo"),
      Flag.withDefault(false),
    ),
    pontuar: textoOpcional("pontuar", "repontua um relatorio.json salvo, sem chamar o modelo"),
    saida: textoOpcional("saida", "diretório da rodada (padrão: avaliacao/resultados/<data>-<modelo>)"),
    config: textoOpcional("config", "configuração alternativa (padrão: avaliacao/config.yaml)"),
  },
  Effect.fn("avaliar")(function* (o) {
    const filtro = o.pergunta.flatMap(listarPerguntas);
    const contexto = yield* carregarContexto(filtro);
    if (Option.isSome(o.pontuar)) return yield* modoPontuar(contexto, o.pontuar.value, filtro);
    const caminhoConfig = Option.getOrUndefined(o.config);
    const config = yield* sincrono(() => carregarConfig(caminhoConfig));
    const execucoes = Option.getOrElse(o.execucoes, () => config.execucoes);
    const modelo = Option.getOrElse(o.modelo, () => config.modelo);
    if (o.dryRun) return yield* modoDryRun(contexto, execucoes, modelo, config);
    yield* modoExecutar(contexto, execucoes, modelo, config, Option.getOrUndefined(o.saida));
  }),
).pipe(
  Command.withDescription(
    "Roda as perguntas de avaliacao/perguntas.yaml no claude -p, pontua contra os gabaritos e grava o relatório em avaliacao/resultados/.",
  ),
);

if (import.meta.main) {
  executarPrincipal("avaliar", Command.run(avaliar, { version: "1" }));
}
