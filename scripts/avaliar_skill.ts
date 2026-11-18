/**
 * Avaliação de uma skill do app com e sem a skill (M0.5 e M1.11 do plano do app). Cada documento do
 * caso vai para uma pasta de trabalho vazia, com o mesmo pedido, numa sessão do motor do app
 * (`@simplifica-if/motor`) com o MCP `ifpr` deste checkout por HTTP local, em cada condição:
 *
 *   - `sem-skill`:    só o MCP (as instruções do servidor);
 *   - `skill`:        MCP + a skill da árvore de trabalho (`.agents/skills/<skill>`);
 *   - `skill-antiga`: MCP + a skill no commit `rev_skill_antiga` do caso.
 *
 * O relatório de cada sessão é pontuado sem modelo (`pontuarAutomatico`) e por um juiz (`promptJuiz`),
 * uma sessão do mesmo provider sem MCP. Grava `relatorio.json`, `resumo.md` e as respostas em
 * `avaliacao/resultados/skills/<data>-<skill>-<provider>/`.
 *
 *   node scripts/avaliar_skill.ts --dry-run
 *   node scripts/avaliar_skill.ts                                  # Claude, as três condições
 *   node scripts/avaliar_skill.ts --provider codex --condicao skill --documento ppc-enfermagem
 *   node scripts/avaliar_skill.ts --pontuar avaliacao/resultados/skills/<rodada>/relatorio.json
 *
 * Precisa do `tmp/kb.sqlite` (`pnpm kb:compilar`) e do login do provider (`pnpm motor:poc --detectar`).
 * Usa a mesma pasta de estado do motor (`SIMPLIFICA_ESTADO`), sem trocar o HOME.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as McpHttp from "@simplifica-if/mcp/http";
import { lerSkill, lerSkillMd } from "@simplifica-if/mcp/skills";
import * as Motor from "@simplifica-if/motor";
import * as Drivers from "@simplifica-if/motor/drivers";
import * as HostProcess from "@simplifica-if/motor/t3/HostProcess";
import { fixPath } from "@simplifica-if/motor/t3/os-jank";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import { DIR_AVALIACAO, ehArquivoAvaliacaoInvalido, RAIZ_REPOSITORIO } from "./avaliacao/carregar.ts";
import { serializarJson } from "./avaliacao/normalizar.ts";
import {
  CONDICOES,
  carregarCaso,
  lerVeredito,
  pedidoPara,
  pontuarAutomatico,
  pontuarJuiz,
  promptJuiz,
  resumoSkillMarkdown,
  type Caso,
  type CasoCarregado,
  type Condicao,
  type Documento,
  type Execucao,
  type RelatorioSkill,
} from "./avaliacao/skills.ts";
import * as Git from "./git.ts";
import { executarPrincipal } from "./principal.ts";

const CASO_PADRAO = "avaliacao/skills/verificar-fundamentacao-normativa";
const PROVIDERS = ["claude", "codex", "antigravity"] as const;
type Provider = (typeof PROVIDERS)[number];

/** Prazo de uma sessão (documento ou juiz). */
const PRAZO = Duration.minutes(15);

/** O caso (`caso.yaml`) não pôde ser lido; o erro de leitura fica em `cause`. */
class CasoIlegivel extends Schema.TaggedError<CasoIlegivel>()("CasoIlegivel", {
  caso: Schema.String,
  /** Código do erro do sistema (`ENOENT`, `EACCES`), quando houver. */
  codigo: Schema.optional(Schema.String),
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `não foi possível ler o caso ${this.caso}${this.codigo === undefined ? "" : ` (${this.codigo})`}`;
  }

  static de(caso: string, cause: unknown): CasoIlegivel {
    const codigo =
      typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string"
        ? cause.code
        : undefined;
    return new CasoIlegivel({ caso, cause, ...(codigo === undefined ? {} : { codigo }) });
  }
}

/** A skill (na árvore de trabalho, ou no commit `rev`) não tem bloco `simplifica:`. */
class SkillSemBloco extends Schema.TaggedError<SkillSemBloco>()("SkillSemBloco", {
  skill: Schema.String,
  rev: Schema.optional(Schema.String),
}) {
  override get message(): string {
    return `a skill ${this.skill}${this.rev === undefined ? "" : ` em ${this.rev}`} não tem bloco simplifica:`;
  }
}

class DocumentosInexistentes extends Schema.TaggedError<DocumentosInexistentes>()("DocumentosInexistentes", {
  ids: Schema.Array(Schema.String),
}) {
  override get message(): string {
    return `documentos inexistentes: ${this.ids.join(", ")}`;
  }
}

class BaseAusente extends Schema.TaggedError<BaseAusente>()("BaseAusente", {}) {
  override get message(): string {
    return "falta tmp/kb.sqlite: rode pnpm kb:compilar";
  }
}

const commitAtual = Git.executar(["rev-parse", "--short", "HEAD"], { cwd: RAIZ_REPOSITORIO }).pipe(
  Effect.flatMap((rev) =>
    Git.executar(["status", "--porcelain"], { cwd: RAIZ_REPOSITORIO }).pipe(
      Effect.map((status) => `${rev.trim()}${status.trim() === "" ? "" : " (com alterações locais)"}`),
    ),
  ),
  Effect.orElseSucceed(() => null),
);

/* ---------------------------------------------------------------- skills */

/** A skill da condição, pronta para o motor (`undefined` em `sem-skill`). */
const skillDaCondicao = Effect.fn("avaliarSkill.skillDaCondicao")(function* (caso: Caso, condicao: Condicao) {
  const path = yield* Path.Path;
  if (condicao === "sem-skill") return undefined;
  if (condicao === "skill") {
    const lida = yield* lerSkill(path.join(RAIZ_REPOSITORIO, ".agents", "skills", caso.skill));
    if (!lida) return yield* new SkillSemBloco({ skill: caso.skill });
    return { nome: lida.nome, descricao: lida.descricao, instrucoes: lida.instrucoes, arquivos: lida.arquivos };
  }
  const base = `${caso.rev_skill_antiga}:.agents/skills/${caso.skill}`;
  const lida = yield* lerSkillMd(
    yield* Git.executar(["show", `${base}/SKILL.md`], { cwd: RAIZ_REPOSITORIO }),
    caso.skill,
  );
  if (!lida.manifesto) return yield* new SkillSemBloco({ skill: caso.skill, rev: caso.rev_skill_antiga });
  const arquivos = [];
  for (const caminho of lida.manifesto.arquivos) {
    arquivos.push({
      caminho,
      conteudo: yield* Git.executar(["show", `${base}/${caminho}`], { cwd: RAIZ_REPOSITORIO }),
    });
  }
  return { nome: lida.nome, descricao: lida.descricao, instrucoes: lida.corpo, arquivos } satisfies Motor.Skill;
});

/* ---------------------------------------------------------------- sessão */

interface Sessao {
  readonly eventos: ReadonlyArray<Motor.Evento>;
  readonly duracaoMs: number;
}

/** Uma sessão do motor numa pasta temporária com `arquivos`, um turno com `pedido`. */
const rodarSessao = Effect.fn("avaliarSkill.rodarSessao")(function* (entrada: {
  readonly provider: Provider;
  readonly modelo: string | undefined;
  readonly pedido: string;
  readonly arquivos: ReadonlyArray<{ readonly nome: string; readonly conteudo: string }>;
  readonly mcp: boolean;
  readonly skill: Motor.Skill | undefined;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const motor = yield* Motor.Motor;
  const servidor = yield* McpHttp.ServidorMcpHttp;
  const pasta = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "simplifica-avaliar-skill-" }));
  for (const arquivo of entrada.arquivos) yield* fs.writeFileString(path.join(pasta, arquivo.nome), arquivo.conteudo);
  const servidores: Motor.ServidorMcp[] = [];
  if (entrada.mcp) {
    const sessaoMcp = yield* servidor.abrirSessao({ rotulo: "avaliar-skill", pastaTrabalho: pasta });
    servidores.push({
      tipo: "http",
      nome: "ifpr",
      url: sessaoMcp.url,
      cabecalhos: sessaoMcp.cabecalhos,
      preAprovado: true,
    });
  }
  const inicio = yield* Clock.currentTimeMillis;
  const id = yield* motor.iniciarSessao({
    provider: entrada.provider,
    pastaTrabalho: pasta,
    servidoresMcp: servidores,
    ...(entrada.modelo ? { modelo: entrada.modelo } : {}),
    ...(entrada.skill ? { skills: [entrada.skill] } : {}),
  });
  const eventos = yield* Stream.runCollect(motor.enviarMensagem(id, entrada.pedido)).pipe(
    Effect.timeoutOption(PRAZO),
    Effect.ensuring(Effect.ignore(motor.encerrar(id))),
  );
  const fim = yield* Clock.currentTimeMillis;
  const lista: Motor.Evento[] = Option.isSome(eventos)
    ? [...eventos.value]
    : [{ _tag: "Erro", mensagem: `prazo de ${Duration.format(PRAZO)} esgotado` } as Motor.Evento];
  return { eventos: lista, duracaoMs: fim - inicio } satisfies Sessao;
}, Effect.scoped);

const textoDe = (eventos: ReadonlyArray<Motor.Evento>) =>
  eventos
    .flatMap((evento) => (evento._tag === "TextoFinal" ? [evento.texto] : []))
    .join("\n\n")
    .trim();

function desfechoDe(eventos: ReadonlyArray<Motor.Evento>): string {
  const erro = eventos.find((evento) => evento._tag === "Erro");
  if (erro?._tag === "Erro") return `erro: ${erro.mensagem}`;
  const fim = eventos.findLast((evento) => evento._tag === "FimTurno");
  return fim?._tag === "FimTurno" ? fim.motivo : "sem FimTurno";
}

/* ------------------------------------------------------------------ juiz */

const julgar = Effect.fn("avaliarSkill.julgar")(function* (
  documento: Documento,
  textoDocumento: string,
  resposta: string,
  opcoes: { readonly provider: Provider; readonly modelo: string | undefined },
) {
  const sessao = yield* rodarSessao({
    provider: opcoes.provider,
    modelo: opcoes.modelo,
    pedido: promptJuiz(documento, textoDocumento, resposta),
    arquivos: [],
    mcp: false,
    skill: undefined,
  });
  const bruto = textoDe(sessao.eventos);
  const veredito = lerVeredito(documento, bruto);
  return veredito ? { juiz: pontuarJuiz(documento, veredito) } : { juiz: null, juiz_bruto: bruto };
});

/* ----------------------------------------------------------------- modos */

interface Opcoes {
  readonly provider: Provider;
  readonly modelo: string | undefined;
  readonly modeloJuiz: string | undefined;
  readonly juiz: boolean;
  readonly condicoes: ReadonlyArray<Condicao>;
  readonly documentos: ReadonlyArray<Documento>;
}

const agoraIso = Effect.map(DateTime.now, DateTime.formatIso);

const gravar = Effect.fn("avaliarSkill.gravar")(function* (dir: string, relatorio: RelatorioSkill, caso: Caso) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.writeFileString(path.join(dir, "relatorio.json"), serializarJson(relatorio));
  yield* fs.writeFileString(path.join(dir, "resumo.md"), resumoSkillMarkdown(relatorio, caso));
});

const modoExecutar = Effect.fn("avaliarSkill.modoExecutar")(function* (carregado: CasoCarregado, opcoes: Opcoes) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { caso } = carregado;
  const inicio = yield* agoraIso;
  const dir = path.join(
    DIR_AVALIACAO,
    "resultados",
    "skills",
    `${inicio.replace(/\.\d{3}Z$/u, "Z").replace(/:/gu, "-")}-${caso.skill}-${opcoes.provider}`,
  );
  yield* fs.makeDirectory(path.join(dir, "respostas"), { recursive: true });
  const relatorio: { -readonly [K in keyof RelatorioSkill]: RelatorioSkill[K] } = {
    versao: 1,
    skill: caso.skill,
    iniciado_em: inicio,
    concluido_em: inicio,
    commit: yield* commitAtual,
    rev_skill_antiga: caso.rev_skill_antiga,
    modelo_juiz: opcoes.juiz ? `${opcoes.provider}:${opcoes.modeloJuiz ?? opcoes.modelo ?? "padrão"}` : null,
    execucoes: [],
  };
  const execucoes: Execucao[] = [];
  for (const documento of opcoes.documentos) {
    const textoDocumento = yield* fs.readFileString(path.join(carregado.pasta, documento.arquivo));
    for (const condicao of opcoes.condicoes) {
      yield* Console.log(`${documento.id} · ${condicao} …`);
      const skill = yield* skillDaCondicao(caso, condicao);
      const sessao = yield* rodarSessao({
        provider: opcoes.provider,
        modelo: opcoes.modelo,
        pedido: pedidoPara(caso, documento),
        arquivos: [{ nome: path.basename(documento.arquivo), conteudo: textoDocumento }],
        mcp: true,
        skill,
      });
      const resposta = textoDe(sessao.eventos);
      const ferramentas = sessao.eventos.flatMap((evento) => (evento._tag === "FerramentaIniciada" ? [evento] : []));
      const uso = sessao.eventos.flatMap((evento) => (evento._tag === "UsoTokens" ? [evento] : []));
      const soma = (f: (u: (typeof uso)[number]) => number | undefined) => uso.reduce((t, u) => t + (f(u) ?? 0), 0);
      const custos = uso.flatMap((u) => (u.custoUsd === undefined ? [] : [u.custoUsd]));
      const julgamento = opcoes.juiz
        ? yield* julgar(documento, textoDocumento, resposta, {
            provider: opcoes.provider,
            modelo: opcoes.modeloJuiz ?? opcoes.modelo,
          })
        : { juiz: null };
      const execucao: Execucao = {
        documento: documento.id,
        condicao,
        provider: opcoes.provider,
        modelo: opcoes.modelo ?? null,
        duracao_ms: sessao.duracaoMs,
        ferramentas: ferramentas.map((evento) => evento.nome),
        leu_skill: ferramentas.some((evento) => JSON.stringify(evento.entrada).includes(`${caso.skill}/SKILL.md`)),
        tokens_entrada: soma((u) => u.entrada),
        tokens_saida: soma((u) => u.saida),
        tokens_cache_leitura: soma((u) => u.cacheLeitura),
        custo_usd: custos.length === 0 ? null : custos.reduce((t, c) => t + c, 0),
        desfecho: desfechoDe(sessao.eventos),
        resposta,
        automatica: pontuarAutomatico(documento, resposta),
        ...julgamento,
      };
      execucoes.push(execucao);
      yield* fs.writeFileString(path.join(dir, "respostas", `${documento.id}--${condicao}.md`), `${resposta}\n`);
      relatorio.execucoes = execucoes;
      relatorio.concluido_em = yield* agoraIso;
      yield* gravar(dir, relatorio, caso);
      const juiz = execucao.juiz;
      yield* Console.log(
        `  ${execucao.desfecho} · ${Math.round(execucao.duracao_ms / 1000)} s · ${execucao.ferramentas.length} ferramentas · skill lida: ${execucao.leu_skill ? "sim" : "não"}` +
          (juiz
            ? ` · status ${juiz.status_corretos}/${documento.alegacoes.length} · erros detectados ${juiz.erros_detectados}`
            : ""),
      );
    }
  }
  yield* Console.log(`\nResumo: ${path.relative(RAIZ_REPOSITORIO, dir)}/resumo.md\n`);
  yield* Console.log(resumoSkillMarkdown(relatorio, caso).split("\n## Detalhe")[0]!);
});

const modoDryRun = Effect.fn("avaliarSkill.modoDryRun")(function* (carregado: CasoCarregado, opcoes: Opcoes) {
  const { caso } = carregado;
  const sessoes = opcoes.documentos.length * opcoes.condicoes.length;
  yield* Console.log(
    `Skill ${caso.skill} · provider ${opcoes.provider} · modelo ${opcoes.modelo ?? "padrão da conta"} · condições ${opcoes.condicoes.join(", ")}`,
  );
  yield* Console.log(`${sessoes} sessões com o MCP ifpr${opcoes.juiz ? ` + ${sessoes} do juiz, sem MCP` : ""}\n`);
  for (const documento of opcoes.documentos) {
    const erros = documento.alegacoes.filter((alegacao) => alegacao.tipo === "erro").length;
    yield* Console.log(
      `${documento.id} (${documento.arquivo}): ${documento.alegacoes.length} alegações, ${erros} com erro plantado`,
    );
    yield* Console.log(`  pedido: ${pedidoPara(caso, documento)}`);
  }
  for (const condicao of opcoes.condicoes) {
    const skill = yield* skillDaCondicao(caso, condicao);
    yield* Console.log(
      `${condicao}: ${skill ? `${skill.instrucoes.split(/\s+/u).length} palavras no SKILL.md, ${skill.arquivos?.length ?? 0} arquivos` : "sem skill"}`,
    );
  }
});

const decodificarRelatorio = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

/** Repontua (só a parte automática) um relatório salvo, com o caso atual. */
const modoPontuar = Effect.fn("avaliarSkill.modoPontuar")(function* (carregado: CasoCarregado, arquivo: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const caminho = path.resolve(arquivo);
  const salvo = (yield* decodificarRelatorio(yield* fs.readFileString(caminho))) as RelatorioSkill;
  const porId = new Map(carregado.caso.documentos.map((documento) => [documento.id, documento]));
  const relatorio: RelatorioSkill = {
    ...salvo,
    execucoes: salvo.execucoes.map((execucao) => {
      const documento = porId.get(execucao.documento);
      return documento ? { ...execucao, automatica: pontuarAutomatico(documento, execucao.resposta) } : execucao;
    }),
  };
  yield* gravar(path.dirname(caminho), relatorio, carregado.caso);
  yield* Console.log(resumoSkillMarkdown(relatorio, carregado.caso).split("\n## Detalhe")[0]!);
});

/* ------------------------------------------------------------------- CLI */

/**
 * A pasta de estado do motor (instalações gerenciadas, perfil do Antigravity), a mesma do
 * `pnpm motor:poc`: `SIMPLIFICA_ESTADO` ou o padrão da plataforma.
 */
const pastaEstado = Effect.gen(function* () {
  const path = yield* Path.Path;
  const home = yield* HostProcess.HomeDirectory;
  const padrao =
    (yield* HostProcess.Platform) === "darwin"
      ? path.join(home, "Library", "Application Support", "simplifica-if-poc")
      : path.join(home, ".simplifica-if-poc");
  return yield* Config.String("SIMPLIFICA_ESTADO").pipe(Config.withDefault(padrao));
});

const camadaMotor = (estado: string) =>
  Layer.mergeAll(
    Motor.layer.pipe(
      Layer.provide(
        Drivers.layerNode({
          ambiente: process.env,
          pastaEstado: estado,
          // o `agy` 1.5.9 não anuncia MCP por HTTP: a ponte stdio → HTTP do motor
          ponteMcp: {
            comando: process.execPath,
            argumentos: [`${RAIZ_REPOSITORIO}/packages/motor/scripts/ponte-mcp.ts`],
          },
        }),
      ),
    ),
    McpHttp.layer({ banco: `${RAIZ_REPOSITORIO}/tmp/kb.sqlite` }),
  ).pipe(Layer.provideMerge(NodeServices.layer));

const textoOpcional = (nome: string, descricao: string) =>
  Flag.String(nome).pipe(Flag.withDescription(descricao), Flag.optional);

const avaliarSkill = Command.make(
  "avaliar-skill",
  {
    caso: Flag.String("caso").pipe(Flag.withDescription("pasta do caso"), Flag.withDefault(CASO_PADRAO)),
    provider: Flag.Literals("provider", PROVIDERS).pipe(Flag.withDefault("claude" as const)),
    condicao: Flag.Literals("condicao", CONDICOES).pipe(
      Flag.withDescription("só estas condições (a opção repetida); padrão: as três"),
      Flag.atLeast(0),
    ),
    documento: Flag.String("documento").pipe(Flag.withDescription("só estes documentos (id)"), Flag.atLeast(0)),
    modelo: textoOpcional("modelo", "modelo do provider (padrão: o da conta)"),
    modeloJuiz: textoOpcional("modelo-juiz", "modelo do juiz (padrão: --modelo)"),
    semJuiz: Flag.Boolean("sem-juiz").pipe(Flag.withDescription("só a pontuação automática"), Flag.withDefault(false)),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription("mostra o que rodaria, sem custo"),
      Flag.withDefault(false),
    ),
    pontuar: textoOpcional("pontuar", "repontua (parte automática) um relatorio.json salvo, sem chamar modelo"),
  },
  Effect.fn("avaliar-skill")(function* (o) {
    const carregado = yield* Effect.try({
      try: () => carregarCaso(o.caso),
      catch: (erro) => (ehArquivoAvaliacaoInvalido(erro) ? erro : CasoIlegivel.de(o.caso, erro)),
    });
    if (Option.isSome(o.pontuar)) return yield* modoPontuar(carregado, o.pontuar.value);
    const desconhecidos = o.documento.filter((id) => !carregado.caso.documentos.some((d) => d.id === id));
    if (desconhecidos.length > 0) return yield* new DocumentosInexistentes({ ids: desconhecidos });
    const opcoes: Opcoes = {
      provider: o.provider,
      modelo: Option.getOrUndefined(o.modelo),
      modeloJuiz: Option.getOrUndefined(o.modeloJuiz),
      juiz: !o.semJuiz,
      condicoes: o.condicao.length === 0 ? CONDICOES : CONDICOES.filter((c) => o.condicao.includes(c)),
      documentos:
        o.documento.length === 0
          ? carregado.caso.documentos
          : carregado.caso.documentos.filter((d) => o.documento.includes(d.id)),
    };
    if (o.dryRun) return yield* modoDryRun(carregado, opcoes);
    const fs = yield* FileSystem.FileSystem;
    if (!(yield* fs.exists(`${RAIZ_REPOSITORIO}/tmp/kb.sqlite`))) return yield* new BaseAusente();
    // um `node` aberto fora do shell de login pode não ter ~/.local/bin no PATH (onde fica o `claude`)
    yield* fixPath();
    yield* modoExecutar(carregado, opcoes).pipe(Effect.provide(camadaMotor(yield* pastaEstado)));
  }),
).pipe(
  Command.withDescription(
    "Roda o caso de avaliação de uma skill do app com e sem a skill, pelo motor do app com o MCP ifpr, e grava o relatório em avaliacao/resultados/skills/.",
  ),
);

if (import.meta.main) {
  executarPrincipal("avaliar-skill", Command.run(avaliarSkill, { version: "1" }));
}
