#!/usr/bin/env node
/**
 * Ponto de entrada único da skill revisar-ppc, em `effect/cli`.
 *
 * Todos os subcomandos rodam em TypeScript, inclusive a conversão de `.docx`
 * em `preparar-documento` (pacote `@simplifica-if/ppc`): a skill só precisa do Node.
 *
 * O processo só se lê aqui, por `Config`: `REVISAR_PPC_AGORA` (data ISO 8601) fixa o relógio, para
 * testes e diferenciais; `REVISAR_PPC_SURGE_DOMAIN` fixa o domínio padrão da publicação; e
 * `REVISAR_PPC_SURGE_CMD` troca o comando do Surge, dividido como no shell.
 *
 * Os subcomandos que consultam o kb (`montar-grupos-subagents`, `montar-grupo-avulso` e
 * `preparar-prompts-subagents`) recebem os serviços do kb de `camadaKb`, dentro do próprio handler:
 * o `kb.sqlite` é recompilado antes, se estiver velho, e `--help` e os erros de uso não o abrem.
 *
 * Erros, como na CLI `kb`: o relatório padrão do `runMain` escreve no stdout e fica desligado.
 * `EncerrarComCodigo` (o subcomando já imprimiu o resultado, como a lista de erros de
 * `validar-base`) só dá o código de saída; erros de uso (`CliError`) já saem com a ajuda pelo
 * `Command.run`; qualquer outro erro, tipado ou não, vira `<nome>: <mensagem>` no stderr. Todos
 * terminam com código 1 (ou o de `EncerrarComCodigo`).
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Compilador from "@simplifica-if/kb/Compilador";
import * as Layers from "@simplifica-if/kb/layers";
import { serializarJsonTipado } from "@simplifica-if/kb/primitivas/json-tipado";
import { dividirComandoShell } from "@simplifica-if/kb/primitivas/shell";
import { caminhoComoUri } from "@simplifica-if/kb/primitivas/url";
import * as Cause from "effect/Cause";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Runtime from "effect/Runtime";
import * as Schema from "effect/Schema";
import * as Argument from "effect/cli/Argument";
import * as CliError from "effect/cli/CliError";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import { caminhosPadrao } from "./caminhos.ts";
import { escreverSchemas, schemasDesatualizados } from "./esquemas.ts";
import { escreverIndice, indiceAtualizado } from "./indice-base.ts";
import { escreverMapa, mapaAtualizado } from "./mapa-fichas.ts";
import { AMOSTRA_MEDICAO, formatarMedicao, medirIdentificacao } from "./medicao-identificacao.ts";
import { prepararDocumento } from "./preparar-documento.ts";
import { dominioSurgePadrao, prepararSiteSurge, type PublicacaoSurge, publicarSiteSurge } from "./publicar-surge.ts";
import { lerReferenciasIdentificacao } from "./referencias-identificacao.ts";
import { gerarRelatorioHtml, type RelatorioGerado } from "./relatorio-html.ts";
import { mesclarResultadosAvulsos, validarResultadosRodada } from "./resultados.ts";
import {
  caminhosRodada,
  escreverJsonDaRodada,
  interpretarAgora,
  type Relogio,
  resolverCaminho,
  TAMANHO_GRUPO_PADRAO,
} from "./rodada.ts";
import { montarGrupoAvulso, montarGruposSubagents, prepararPromptsSubagents } from "./subagents.ts";
import { validarBaseAnalise } from "./validacao-base.ts";

const NOME = "revisar_ppc.ts";
const COMANDO = "node .agents/skills/revisar-ppc/scripts/revisar_ppc.ts";

/**
 * O subcomando já imprimiu o resultado e só falta o código de saída. O `runMain` o lê pelo
 * marcador `Runtime.errorExitCode`.
 */
export class EncerrarComCodigo extends Schema.TaggedError<EncerrarComCodigo>()("EncerrarComCodigo", {
  codigo: Schema.Int,
}) {
  override get message(): string {
    return `encerrado com o código ${this.codigo}`;
  }

  override get [Runtime.errorExitCode](): number {
    return this.codigo;
  }
}

export const ehEncerrarComCodigo = Schema.is(EncerrarComCodigo);

/** `REVISAR_PPC_AGORA` fora dos formatos aceitos (veja `interpretarAgora`). */
export class AgoraInvalida extends Schema.TaggedError<AgoraInvalida>()("AgoraInvalida", {
  valor: Schema.String,
}) {
  override get message(): string {
    return `REVISAR_PPC_AGORA inválida: ${this.valor}`;
  }
}

/** Variável de ambiente de texto; vazia conta como ausente. */
const textoDoAmbiente = (nome: string) =>
  Config.option(Config.String(nome)).pipe(Effect.map(Option.filter((valor) => valor !== "")));

/** Relógio da rodada: o instante de `REVISAR_PPC_AGORA` ou o de agora, o mesmo em todo o comando. */
const relogioDoComando = Effect.fn("revisar_ppc.relogio")(function* () {
  const fixo = yield* textoDoAmbiente("REVISAR_PPC_AGORA");
  let data: Date;
  if (Option.isSome(fixo)) {
    const interpretada = interpretarAgora(fixo.value);
    if (!interpretada) return yield* new AgoraInvalida({ valor: fixo.value });
    data = interpretada;
  } else data = DateTime.toDateUtc(yield* DateTime.now);
  const relogio: Relogio = () => data;
  return relogio;
});

/** Encerra com `codigo` quando ele não é zero; com zero, termina normalmente. */
const sairCom = (codigo: number): Effect.Effect<void, EncerrarComCodigo> =>
  codigo === 0 ? Effect.void : Effect.fail(new EncerrarComCodigo({ codigo }));

/**
 * Os serviços do kb sobre o `kb.sqlite` do checkout em `raiz` (padrão: o pai de
 * `base-conhecimento/`), só leitura, depois de garantir pelo
 * `Compilador` que ele corresponde às fontes. Como na CLI `kb`: `KB_SQLITE` muda o caminho do banco
 * (padrão `<raiz>/tmp/kb.sqlite`) e `KB_RECOMPILAR=nunca|sempre` desliga ou força a recompilação
 * (outro valor vale `auto`).
 */
export const camadaKb = (opcoes: { readonly raiz?: string } = {}) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const raiz = opcoes.raiz ?? path.dirname(caminhosPadrao().baseConhecimentoDir);
      const compilador = yield* Compilador.Compilador;
      const configurado = yield* Config.option(Config.String("KB_SQLITE"));
      const caminho = Option.isSome(configurado)
        ? path.resolve(configurado.value)
        : path.join(raiz, "tmp", "kb.sqlite");
      const recompilar = Option.getOrUndefined(yield* Config.option(Config.String("KB_RECOMPILAR")));
      const politica = recompilar === "nunca" || recompilar === "sempre" ? recompilar : "auto";
      yield* compilador.garantirFresco({ raiz, caminho, politica });
      return Layers.layerSomenteLeitura({ caminho });
    }),
  ).pipe(Layer.provide(Compilador.layer));

/** Imprime o JSON tipado, indentado com 2 espaços. */
const imprimirJson = (payload: unknown) => Console.log(serializarJsonTipado(payload, { indent: 2 }));

/** Executa um subcomando síncrono; o erro que ele lançar é relatado no stderr, com código 1. */
const executar = <A>(acao: () => A) => Effect.sync(acao);

type Objeto = Record<string, unknown>;

/** Resumo impresso por `montar-grupos-subagents` sem `--detalhado`. */
export function resumoGruposSubagents(payload: Objeto): Objeto {
  const grupos = Array.isArray(payload.grupos) ? (payload.grupos as Objeto[]) : [];
  const cnct = (payload.cnct_contexto ?? {}) as Objeto;
  const correspondencia = (cnct.correspondencia ?? {}) as Objeto;
  return {
    rodada_dir: payload.rodada_dir,
    ppc_markdown: payload.ppc_markdown,
    grupos_subagents: payload.grupos_subagents_path,
    cnct_contexto_path: payload.cnct_contexto_path,
    contexto_estrutural_path: payload.contexto_estrutural_path,
    validacoes_cruzadas_path: payload.validacoes_cruzadas_path,
    curso: payload.curso,
    total_fichas: payload.total_fichas,
    tamanho_grupo: payload.tamanho_grupo,
    total_grupos: grupos.length,
    grupos: grupos.map((grupo) => ({
      grupo_id: grupo.grupo_id,
      topico: grupo.topico,
      parte: grupo.parte,
      partes: grupo.partes,
      escopo_ppc: grupo.escopo_ppc,
      total_fichas: grupo.total_fichas,
      total_secoes: ((grupo.contextos ?? {}) as Objeto & { ppc?: Objeto }).ppc?.total_secoes ?? null,
      requer_contexto_cnct: grupo.requer_contexto_cnct ?? false,
      requer_fundamentacao_normativa: grupo.requer_fundamentacao_normativa ?? false,
      requer_anexos_visuais: grupo.requer_anexos_visuais ?? false,
    })),
    cnct_correspondencia: {
      denominacao: correspondencia.denominacao ?? null,
      eixo_tecnologico: correspondencia.eixo_tecnologico ?? null,
      score: correspondencia.score ?? null,
      tipo_correspondencia: correspondencia.tipo_correspondencia ?? null,
    },
  };
}

/** Aviso das mensagens da CLI: a skill faz revisão prévia, não a análise oficial. */
const AVISO_REVISAO = "Revisão prévia à submissão; não substitui a análise oficial da PROENS.";

const mensagemRelatorio = (rotulo: string, url: string) =>
  `Relatório de revisão do PPC pronto (${rotulo}): ${url}. ${AVISO_REVISAO}`;

/**
 * Saída de `gerar-relatorio-html`: caminho e URL do relatório, a situação da revisão e, se
 * publicado, a URL pública.
 */
export function payloadRelatorio(gerado: RelatorioGerado, publicacao?: PublicacaoSurge): Objeto {
  const relatorio = resolverCaminho(gerado.relatorio_html);
  const uri = caminhoComoUri(relatorio);
  const payload: Objeto = {
    relatorio_html: relatorio,
    relatorio_url: uri,
    situacao: gerado.situacao,
    situacao_rotulo: gerado.situacao_rotulo,
    mensagem: mensagemRelatorio(gerado.situacao_rotulo, uri),
  };
  if (publicacao) {
    const publicUrl = publicacao.public_url || "";
    Object.assign(payload, {
      publicacao_servico: publicacao.servico,
      publicacao_url: publicUrl,
      surge_url: publicUrl,
      surge_domain: publicacao.domain,
      mensagem: mensagemRelatorio(gerado.situacao_rotulo, publicUrl || uri),
    });
  }
  return payload;
}

/** Gera o relatório e, sem `--sem-surge`, publica no Surge (as etapas são síncronas). */
const gerarRelatorio = Effect.fn("revisar_ppc.gerarRelatorio")(function* (opcoes: {
  readonly rodadaDir: string;
  readonly resultados: string;
  readonly semSurge: boolean;
  readonly surgeDomain: Option.Option<string>;
}) {
  const path = yield* Path.Path;
  const relatorio = yield* gerarRelatorioHtml(opcoes.rodadaDir, opcoes.resultados);
  if (opcoes.semSurge) return payloadRelatorio(relatorio);
  const rodada = caminhosRodada(opcoes.rodadaDir);
  const dominioConfigurado = yield* textoDoAmbiente("REVISAR_PPC_SURGE_DOMAIN");
  const comando = Option.map(yield* textoDoAmbiente("REVISAR_PPC_SURGE_CMD"), dividirComandoShell);
  return yield* executar(() => {
    const siteDir = prepararSiteSurge(relatorio.relatorio_html, path.join(rodada.suporteDir, "surge-site"));
    const dominio = Option.getOrElse(
      Option.orElse(
        Option.filter(opcoes.surgeDomain, (valor) => valor !== ""),
        () => dominioConfigurado,
      ),
      () => dominioSurgePadrao(rodada.rodadaDir),
    );
    const publicacao = publicarSiteSurge(siteDir, dominio, Option.getOrUndefined(comando));
    publicacao.relatorio_html_original = resolverCaminho(relatorio.relatorio_html);
    escreverJsonDaRodada(path.join(rodada.suporteDir, "surge-publicacao.json"), publicacao);
    return payloadRelatorio(relatorio, publicacao);
  });
});

// --- flags comuns ---

const flagRodadaDir = Flag.String("rodada-dir").pipe(Flag.withDescription("Diretório da rodada"));

const flagResultados = Flag.String("resultados").pipe(
  Flag.withDescription("JSON coletado dos sub-agentes; relativo a arquivos-suporte quando não absoluto"),
  Flag.withDefault("resultados-subagents.json"),
);

const flagLigada = (nome: string, descricao: string) =>
  Flag.Boolean(nome).pipe(Flag.withDescription(descricao), Flag.withDefault(false));

const flagTexto = (nome: string, descricao: string) =>
  Flag.String(nome).pipe(Flag.withDescription(descricao), Flag.optional);

// --- subcomandos ---

const prepararDocumentoCmd = Command.make(
  "preparar-documento",
  {
    arquivo: Argument.String("arquivo").pipe(Argument.withDescription("Arquivo .md ou .docx de entrada")),
    saidaBase: flagTexto("saida-base", "Diretório base opcional para a rodada"),
  },
  Effect.fn("revisar_ppc.prepararDocumento")(function* ({ arquivo, saidaBase }) {
    const relogio = yield* relogioDoComando();
    const resultado = yield* executar(() =>
      prepararDocumento(arquivo, {
        referencias: lerReferenciasIdentificacao(caminhosPadrao()),
        relogio,
        ...(Option.isSome(saidaBase) ? { saidaBase: saidaBase.value } : {}),
      }),
    );
    yield* imprimirJson(resultado.resumo);
  }),
).pipe(Command.withDescription("Criar a rodada e o PPC.md canônico"));

const montarGruposCmd = Command.make(
  "montar-grupos-subagents",
  {
    rodadaDir: flagRodadaDir,
    tamanhoGrupo: Flag.Int("tamanho-grupo").pipe(
      Flag.withDescription("Quantidade máxima de fichas por grupo (tópicos maiores viram partes)"),
      Flag.withDefault(TAMANHO_GRUPO_PADRAO),
    ),
    detalhado: flagLigada(
      "detalhado",
      "Imprimir o JSON completo; por padrão a CLI mostra apenas um resumo e salva o payload completo.",
    ),
  },
  Effect.fn("revisar_ppc.montarGruposSubagents")(
    function* ({ rodadaDir, tamanhoGrupo, detalhado }) {
      const payload = yield* montarGruposSubagents(rodadaDir, tamanhoGrupo);
      yield* imprimirJson(detalhado ? payload : resumoGruposSubagents(payload));
    },
    (efeito) => Effect.provide(efeito, camadaKb()),
  ),
).pipe(Command.withDescription("Montar os grupos por tópico para sub-agentes e salvar grupos-subagents.json"));

const prepararPromptsCmd = Command.make(
  "preparar-prompts-subagents",
  { rodadaDir: flagRodadaDir },
  Effect.fn("revisar_ppc.prepararPromptsSubagents")(
    function* ({ rodadaDir }) {
      yield* imprimirJson(yield* prepararPromptsSubagents(rodadaDir));
    },
    (efeito) => Effect.provide(efeito, camadaKb()),
  ),
).pipe(Command.withDescription("Gerar pacotes Markdown autocontidos para cada grupo de sub-agente"));

const montarGrupoAvulsoCmd = Command.make(
  "montar-grupo-avulso",
  {
    rodadaDir: flagRodadaDir,
    fichaId: Flag.String("ficha-id").pipe(
      Flag.withDescription("Ficha a incluir no grupo avulso (repetível)"),
      Flag.atLeast(1),
    ),
  },
  Effect.fn("revisar_ppc.montarGrupoAvulso")(
    function* ({ rodadaDir, fichaId }) {
      yield* imprimirJson(yield* montarGrupoAvulso(rodadaDir, fichaId));
    },
    (efeito) => Effect.provide(efeito, camadaKb()),
  ),
).pipe(Command.withDescription("Montar um grupo avulso de fichas para reavaliação por sub-agente"));

const mesclarResultadosCmd = Command.make(
  "mesclar-resultados-avulsos",
  {
    rodadaDir: flagRodadaDir,
    resultadosBase: Flag.String("resultados-base").pipe(
      Flag.withDescription("JSON base de resultados; relativo a arquivos-suporte quando não absoluto"),
      Flag.withDefault("resultados-subagents.json"),
    ),
    resultadosAvulsos: Flag.String("resultados-avulsos").pipe(
      Flag.withDescription("JSON retornado pelo sub-agente avulso; relativo a arquivos-suporte quando não absoluto"),
    ),
    saida: flagTexto("saida", "Destino do JSON mesclado; padrão: sobrescreve --resultados-base"),
  },
  Effect.fn("revisar_ppc.mesclarResultadosAvulsos")(function* ({
    rodadaDir,
    resultadosBase,
    resultadosAvulsos,
    saida,
  }) {
    const mesclado = yield* mesclarResultadosAvulsos(
      rodadaDir,
      resultadosBase,
      resultadosAvulsos,
      Option.getOrUndefined(saida),
    );
    yield* imprimirJson(mesclado);
  }),
).pipe(Command.withDescription("Mesclar respostas avulsas em resultados-subagents.json"));

const validarResultadosCmd = Command.make(
  "validar-resultados",
  { rodadaDir: flagRodadaDir, resultados: flagResultados },
  Effect.fn("revisar_ppc.validarResultados")(function* ({ rodadaDir, resultados }) {
    yield* imprimirJson(yield* validarResultadosRodada(rodadaDir, resultados));
  }),
).pipe(Command.withDescription("Validar cobertura e contrato do JSON de resultados sem gerar HTML"));

const validarBaseCmd = Command.make(
  "validar-base",
  {},
  Effect.fn("revisar_ppc.validarBase")(function* () {
    const erros = yield* executar(() => validarBaseAnalise());
    if (erros.length) {
      yield* Console.log(erros.join("\n"));
      return yield* sairCom(1);
    }
    yield* Console.log("Base de análise válida.");
  }),
).pipe(
  Command.withDescription(
    "Validar fichas, tópicos, marcos normativos, validações cruzadas e contratos da base de análise",
  ),
);

const flagCheck = (alvo: string) => flagLigada("check", `verificar se ${alvo} sem reescrever`);

const gerarSchemasCmd = Command.make(
  "gerar-schemas",
  { check: flagCheck("os schemas estão atualizados") },
  Effect.fn("revisar_ppc.gerarSchemas")(function* ({ check }) {
    const caminhos = caminhosPadrao();
    if (!check) {
      const arquivos = yield* executar(() => escreverSchemas(caminhos));
      return yield* Console.log(arquivos.map((arquivo) => `Schema gerado em ${arquivo}.`).join("\n"));
    }
    const desatualizados = yield* executar(() => schemasDesatualizados(caminhos));
    if (!desatualizados.length) return yield* Console.log(`OK: ${caminhos.schemasDir}`);
    yield* Console.log(
      desatualizados.map((arquivo) => `ERRO: ${arquivo} está desatualizado. Rode ${COMANDO} gerar-schemas.`).join("\n"),
    );
    return yield* sairCom(1);
  }),
).pipe(
  Command.withDescription(
    "Gerar os JSON Schemas de ficha e marcos normativos a partir do Effect Schema (scripts/esquemas.ts)",
  ),
);

const gerarIndiceCmd = Command.make(
  "gerar-indice",
  { check: flagCheck("indice.json está atualizado") },
  Effect.fn("revisar_ppc.gerarIndice")(function* ({ check }) {
    const caminhos = caminhosPadrao();
    if (check) {
      if (yield* executar(() => indiceAtualizado(caminhos))) return yield* Console.log(`OK: ${caminhos.indicePath}`);
      yield* Console.log(`ERRO: ${caminhos.indicePath} está desatualizado. Rode ${COMANDO} gerar-indice.`);
      return yield* sairCom(1);
    }
    const indice = yield* executar(() => escreverIndice(caminhos));
    const resumo = indice.resumo as { total_fichas: number; total_itens: number };
    yield* Console.log(
      `Índice gerado em ${caminhos.indicePath} (${resumo.total_fichas} fichas, ${resumo.total_itens} itens).`,
    );
  }),
).pipe(Command.withDescription("Gerar base-analise/indice.json"));

const gerarMapaCmd = Command.make(
  "gerar-mapa",
  { check: flagCheck("mapa-fichas.md está atualizado") },
  Effect.fn("revisar_ppc.gerarMapa")(function* ({ check }) {
    const caminhos = caminhosPadrao();
    if (check) {
      if (yield* executar(() => mapaAtualizado(caminhos))) return yield* Console.log(`OK: ${caminhos.mapaFichasPath}`);
      yield* Console.log(`ERRO: ${caminhos.mapaFichasPath} está desatualizado. Rode ${COMANDO} gerar-mapa.`);
      return yield* sairCom(1);
    }
    yield* executar(() => escreverMapa(caminhos));
    yield* Console.log(`Mapa de fichas gerado em ${caminhos.mapaFichasPath}.`);
  }),
).pipe(Command.withDescription("Gerar base-analise/mapa-fichas.md"));

const gerarRelatorioCmd = Command.make(
  "gerar-relatorio-html",
  {
    rodadaDir: flagRodadaDir,
    resultados: flagResultados,
    semSurge: flagLigada("sem-surge", "Gerar apenas o HTML local, sem publicar no Surge."),
    surgeDomain: flagTexto("surge-domain", "Domínio Surge de publicação; padrão: revisar-ppc-<rodada>.surge.sh."),
  },
  Effect.fn("revisar_ppc.gerarRelatorioHtml")(function* (opcoes) {
    yield* imprimirJson(yield* gerarRelatorio(opcoes));
  }),
).pipe(Command.withDescription("Gerar o relatório de revisão do PPC (HTML anotado)"));

const medirIdentificacaoCmd = Command.make(
  "medir-identificacao",
  {
    amostra: flagLigada("amostra", "medir só a amostra fixa usada nos testes"),
    erros: flagLigada("erros", "listar os casos errados ou vazios"),
    json: flagLigada("json", "imprimir a medição completa em JSON"),
  },
  Effect.fn("revisar_ppc.medirIdentificacao")(function* ({ amostra, erros, json }) {
    const texto = yield* executar(() => {
      const referencias = lerReferenciasIdentificacao(caminhosPadrao());
      const medicao = medirIdentificacao(amostra ? { referencias, amostra: AMOSTRA_MEDICAO } : { referencias });
      // `formatarMedicao` termina com quebra de linha; o `Console.log` põe a sua.
      return json ? JSON.stringify(medicao, null, 2) : formatarMedicao(medicao, { erros }).replace(/\n$/, "");
    });
    yield* Console.log(texto);
  }),
).pipe(
  Command.withDescription("Medir a identificação do curso nos PPCs técnicos da base contra institucional/ifpr/cursos"),
);

export const revisarPpc = Command.make(NOME).pipe(
  Command.withDescription(
    "Revisão prévia de PPC técnico do IFPR por sub-agentes na conversa, antes da submissão à PROENS " +
      "(não substitui a análise oficial da PROENS)",
  ),
  Command.withSubcommands([
    prepararDocumentoCmd,
    montarGruposCmd,
    prepararPromptsCmd,
    montarGrupoAvulsoCmd,
    mesclarResultadosCmd,
    validarResultadosCmd,
    validarBaseCmd,
    gerarSchemasCmd,
    gerarIndiceCmd,
    gerarMapaCmd,
    gerarRelatorioCmd,
    medirIdentificacaoCmd,
  ]),
);

/** `Nome: mensagem`, como a CLI sempre escreveu os erros (`Error: ...`, `ErroResultadosSubagents: ...`). */
const textoDoErro = (erro: unknown): string =>
  erro instanceof Error ? `${erro.name}: ${erro.message}` : `${NOME}: ${String(erro)}`;

/** Escreve no stderr o que a falha tem a dizer; o código de saída fica com o `runMain`. */
const relatarFalha = (causa: Cause.Cause<unknown>): Effect.Effect<void> => {
  if (Cause.hasInterruptsOnly(causa)) return Effect.void;
  const erro = Cause.findErrorOption(causa);
  if (Option.isSome(erro)) {
    if (ehEncerrarComCodigo(erro.value) || CliError.isCliError(erro.value)) return Effect.void;
    return Console.error(textoDoErro(erro.value));
  }
  return Console.error(textoDoErro(Cause.squash(causa)));
};

if (import.meta.main) {
  NodeRuntime.runMain(
    Command.run(revisarPpc, { version: "0.1.0" }).pipe(
      Effect.tapCause(relatarFalha),
      Effect.provide(NodeServices.layer),
    ),
    { disableErrorReporting: true },
  );
}
