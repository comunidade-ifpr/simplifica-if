/**
 * `ListaViva`: a lista de pendências que a pessoa mantém (M1.11, etapa 5b), no servidor, e as ações
 * dentro de cada pendência.
 *
 * - **A lista** nasce de cada revisão (a pré-conferência, `revisar`, que avisa as etapas da leitura em
 *   stream). A leitura com IA não cria outra: a `RevisaoIa` mescla cada bloco pronto nesta mesma lista,
 *   que guarda os resultados conferidos da IA (`resultados_ia`). Fica no `conversas.sqlite`
 *   (`RevisoesPpc`), com o texto do PPC que as ações usam; sobrevive a fechar o app e à cota. Cada revisão
 *   é independente: revisar de novo o mesmo arquivo abre outra lista, sem herdar a leitura com IA nem a
 *   situação das pendências da anterior, que continua como estava.
 * - **"Qual é o curso?"** (`trocarCurso`): a lista refeita com o curso escolhido, com os resultados da
 *   leitura com IA, se houve, como na cópia comentada.
 * - "Qual é o curso?" e "Enviar a versão corrigida" mudam o que a leitura com IA leu: recusam com ela em
 *   andamento (a pessoa pausa antes) e apagam a pausada, na mesma operação.
 * - **"Feito" e "Desfazer"** (`marcar`): só mudam a situação, sem IA.
 * - **"Enviar a versão corrigida"** (`revisarArquivoNovo`): o `.docx` novo é pré-conferido (só o código) e
 *   decide as pendências do código da lista inteira, casadas pelo critério (`arquivo-novo.ts`); as que só
 *   ele aponta entram abertas. A cópia comentada dele é gravada antes e, depois, numa transação, a lista
 *   passa ao arquivo novo: uma falha no meio não deixa a lista meio trocada.
 * - **"Já resolvi" com o arquivo novo, por pendência** (`revisarDeNovo`): o servidor converte e pré-confere
 *   o `.docx` novo e reconfere **só o ponto da pendência**: no código (`casarPendencias` sobre as fichas D
 *   e triagem) e, nas da IA, num lote de uma ficha conferido como no julgamento. A situação sai do
 *   resultado: `resolvida` só se o ponto não é mais apontado; senão volta a `aberta`, com o que ainda falta.
 * - **"Discordo…"** (`contestar`) e **"Sugerir texto"** (`sugerir`): uma sessão sem ferramentas, com o
 *   pedido e a conferência do `conversa.ts` do `packages/ppc`. Quem decide é o código (ver lá).
 * - O uso de cada ação com IA fica em `revisao_ppc_acoes_ia` e soma ao uso da revisão com IA de onde a lista veio.
 *   Uma ação com IA por vez; a estimativa vem antes (`estimar`). "Enviar a versão corrigida" e "Qual é o
 *   curso?" trocam a lista inteira: também esperam que nenhuma ação com IA esteja em andamento.
 * - As escritas sobre a mesma lista (`marcar`, o fim de `contestar`, `sugerir` e `revisarDeNovo`,
 *   `gerarCopia`, `revisarArquivoNovo`, `trocarCurso` e a mesclagem da leitura com IA) esperam a vez umas
 *   das outras em `RevisoesPpc.comTravaDaLista`, sem bloquear outras listas.
 * - A cópia comentada é regravada só quando a lista mudou desde a última (`versao` e `versaoCopia`), e
 *   nunca por cima da cópia que a pessoa editou (`RevisorPpc`).
 * - As ações que mandam o PPC à IA (`contestar`, `sugerir`, `revisarDeNovo`) esperam o aviso de uso
 *   aceito (M1.8): sem ele, recusam com `AvisoNaoAceito`. As três abrem pelo mesmo preparo (`abrirAcao`,
 *   `prepararAcaoIa`) e terminam pelo mesmo registro (`concluirAcao`).
 * - **"Acompanhar no Word"** (`acompanhar`): a cópia comentada, ou outro `.docx` que a pessoa escolheu,
 *   passa a ser o arquivo acompanhado, num campo próprio da lista (o arquivo revisado fica).
 * - **A conferência ao salvar** (`conferirSalvamento`): o arquivo acompanhado pré-conferido (só o código)
 *   decide as pendências e a régua do código, como "Enviar a versão corrigida", mas sem trocar o arquivo
 *   da lista, sem regravar a cópia comentada e sem tocar na leitura com IA: a conversão corre fora da
 *   trava, e o resultado entra na trava da lista, depois da mesclagem de um bloco em andamento (e só se a
 *   lista ainda acompanha o mesmo arquivo sobre o mesmo texto); a leitura pausada continua pausada. O
 *   arquivo que parece outro documento (os limites de `lerArquivoNovo`) não é conferido. O "Feito" da
 *   pessoa fica enquanto o arquivo salvo aponta o mesmo ponto igual (`planoArquivoNovo`).
 * - Uma ação com IA que termina depois que a pendência mudou (uma conferência ao salvar a resolveu ou lhe
 *   deu outro texto, ou a pessoa a marcou) não grava o resultado por cima: `concluirAcao` recusa, e a
 *   pessoa pede de novo. "Sugerir texto" só guarda a sugestão, sem mexer na situação.
 * - A conferência ao salvar guarda o texto do arquivo conferido (`markdownConferido`): a pasta da conversa
 *   ao lado o recebe (`ConversaAoLado`), sempre o mais recente.
 * - **O fluxo da lista** (`acompanharLista`): a lista a cada escrita (`RevisoesPpc.assinarMudancas`), os
 *   eventos de cada conferência e, enquanto ele está aberto, o vigia do arquivo acompanhado (`vigia.ts`),
 *   que confere ao abrir e a cada salvamento, só quando o sha256 mudou (`verificarAcompanhado`).
 */
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { type AvisoNaoAceito, type Provider } from "@simplifica-if/contratos-app";
import {
  DIAS_LISTA,
  type DocumentoRevisado,
  type EstimativaAcao,
  type EventoAcompanhamento,
  type EventoRevisaoPpc,
  FalhaRevisaoPpc,
  type ListaPendencias,
  type PendenciaViva,
  type ResultadoArquivoNovo,
  type ResultadoRevisaoPpc,
  type SituacaoPendencia,
} from "@simplifica-if/contratos-app/modulos/revisao-ppc";
import type * as FontesNormativas from "@simplifica-if/kb/FontesNormativas";
import type * as PacoteRevisaoPpc from "@simplifica-if/kb/PacoteRevisaoPpc";
import * as Motor from "@simplifica-if/motor";
import {
  conferirContestacao,
  MANTIDA_CODIGO,
  conferirSugestao,
  instrucoesConversa,
  pedidoContestacao,
  pedidoSugestao,
  prefixoConversa,
  type TurnoAnterior,
} from "@simplifica-if/ppc/revisao-ia/conversa";
import { alvosPorRecorte, instrucoesJulgador, pedidoS } from "@simplifica-if/ppc/revisao-ia/pedido";
import { dobrar, retirarTextoParaIa, teveTextoParaIa } from "@simplifica-if/ppc/revisao-ia/plano";
import {
  chavePendencia,
  type EntradaIa,
  estadoDaIa,
  type PendenciaRevisao,
  type ResultadoFichaIa,
  textoDaPendencia,
} from "@simplifica-if/ppc/revisao-previa";
import { resumoDaFalha } from "../../observabilidade/resumoDaFalha.ts";
import * as Preferencias from "../../persistencia/Preferencias.ts";
import * as CopiasComentadas from "./persistencia/CopiasComentadas.ts";
import * as RevisoesPpc from "./persistencia/RevisoesPpc.ts";
import {
  casarPendencias,
  comCriteriosDoCodigo,
  locaisNoDocumento,
  marcasDaCopia,
  planoArquivoNovo,
} from "./arquivo-novo.ts";
import { documentoRevisado } from "./documento-revisado.ts";
import { estimarAcao } from "./estimativa.ts";
import { julgarBloco, PausaRevisao, turnoSemFerramentas } from "./julgamento.ts";
import { MODELO_PADRAO } from "./modelos.ts";
import { type ContextoDaFicha, contextoDaFicha, cursoEmTexto } from "./preparo.ts";
import * as RevisaoIa from "./RevisaoIa.ts";
import { cursoEscolhido, novoNonce, regravarCopia as regravarCopiaDaLista } from "./RevisaoIa.ts";
import * as RevisorPpc from "./RevisorPpc.ts";
import * as Vigia from "./vigia.ts";

export const TEMPO_ACAO = Duration.minutes(4);
const MUDOU_NO_MEIO =
  "Este ponto mudou enquanto a ação rodava: o arquivo salvo no Word o resolveu ou mudou o texto dele. Veja a lista atualizada e, se ainda precisar, peça de novo.";

type MudancaDaAcao = Parameters<RevisoesPpc.RevisoesPpc["Service"]["mudarPendencia"]>[2];
const LIMITE_MOTIVO = 1500;

export class ListaViva extends Context.Service<
  ListaViva,
  {
    /**
     * A pré-conferência (`RevisorPpc.revisarArquivo`) com a lista viva gravada: as etapas da leitura
     * quando cada uma começa e, no fim, o resultado, que traz o `lista`.
     */
    readonly revisar: (entrada: RevisorPpc.EntradaRevisao) => Stream.Stream<EventoRevisaoPpc, FalhaRevisaoPpc>;
    readonly lista: (id: string) => Effect.Effect<ListaPendencias, FalhaRevisaoPpc>;
    /** Todas as listas guardadas, da mais recente para a mais antiga (as que passaram de `DIAS_LISTA` saem antes). */
    readonly todas: Effect.Effect<ReadonlyArray<ListaPendencias>>;
    /** "Qual é o curso?": a lista refeita com o curso escolhido, com os resultados da IA, se houve. */
    readonly trocarCurso: (
      id: string,
      cnct: string,
      forma: string | undefined,
    ) => Effect.Effect<ListaPendencias, FalhaRevisaoPpc>;
    /**
     * Apaga a lista (o texto do PPC, as pendências, o histórico e o uso das ações) e todas as leituras com
     * IA dela, concluídas ou não, parando a que estiver rodando. A cópia comentada e o original ficam: são
     * arquivos da pessoa. Uma ação com IA em andamento termina sem gravar nada.
     */
    readonly apagar: (id: string) => Effect.Effect<void>;
    /** As discordâncias contra pendências do código, em CSV, para a curadoria das regras. */
    readonly exportarDiscordancias: Effect.Effect<string>;
    readonly marcar: (
      id: string,
      chave: string,
      situacao: "aberta" | "resolvida",
    ) => Effect.Effect<ListaPendencias, FalhaRevisaoPpc>;
    readonly estimar: (
      id: string,
      chave: string,
      acao: "contestar" | "sugerir" | "revisarDeNovo",
      provider?: Provider,
    ) => Effect.Effect<EstimativaAcao, FalhaRevisaoPpc>;
    readonly contestar: (
      id: string,
      chave: string,
      motivo: string,
      provider?: Provider,
    ) => Effect.Effect<ListaPendencias, FalhaRevisaoPpc | AvisoNaoAceito>;
    readonly sugerir: (
      id: string,
      chave: string,
      provider?: Provider,
    ) => Effect.Effect<ListaPendencias, FalhaRevisaoPpc | AvisoNaoAceito>;
    readonly revisarDeNovo: (
      id: string,
      chave: string,
      arquivo: string,
      provider?: Provider,
    ) => Effect.Effect<ListaPendencias, FalhaRevisaoPpc | AvisoNaoAceito>;
    /** "Enviar a versão corrigida": a lista inteira reconferida em código contra o arquivo novo. */
    readonly revisarArquivoNovo: (id: string, arquivo: string) => Effect.Effect<ResultadoArquivoNovo, FalhaRevisaoPpc>;
    readonly gerarCopia: (id: string) => Effect.Effect<ListaPendencias, FalhaRevisaoPpc>;
    /** O texto do PPC da lista, com as seções e os trechos das pendências, para o painel de leitura. */
    readonly documento: (id: string) => Effect.Effect<DocumentoRevisado, FalhaRevisaoPpc>;
    /** "Acompanhar no Word": a cópia comentada (sem `arquivo`) ou o `.docx` escolhido passa a ser o acompanhado. */
    readonly acompanhar: (id: string, arquivo?: string) => Effect.Effect<ListaPendencias, FalhaRevisaoPpc>;
    /**
     * Confere o arquivo acompanhado se o sha256 mudou desde a última conferência, e avisa o resultado a
     * quem acompanha a lista. Diz se conferiu. Nunca falha: a falha vira o evento `falhou`.
     */
    readonly verificarAcompanhado: (id: string) => Effect.Effect<boolean>;
    /** A lista a cada mudança e os eventos da conferência ao salvar, com o vigia do arquivo acompanhado. */
    readonly acompanharLista: (id: string) => Stream.Stream<EventoAcompanhamento, FalhaRevisaoPpc>;
  }
>()("@simplifica-if/server/modulos/revisao-ppc/ListaViva") {}

/** Títulos de seção (normalizados) de um Markdown convertido. */
const titulos = (markdown: string) =>
  new Set(
    markdown
      .split("\n")
      .filter((l) => /^#{1,6}\s/.test(l))
      .map((l) => dobrar(l.replace(/^#+\s*/, "").replace(/^[\d.\s]+/, "")))
      .filter((t) => t.length >= 4),
  );

/** Linhas com texto de um Markdown. */
const linhasComTexto = (markdown: string) => markdown.split("\n").filter((l) => l.trim()).length;

/**
 * O arquivo da nova revisão comparado com o revisado: a fração dos títulos de seção **do revisado** que
 * estão no novo, e o tamanho do novo (títulos e linhas com texto) em relação ao revisado. Um arquivo
 * quase vazio, com um título só do original, não passa: tem poucas seções e poucas linhas.
 */
export function comparacaoComOriginal(original: string, novo: string) {
  const to = titulos(original);
  const tn = titulos(novo);
  return {
    titulosEmComum: to.size ? [...to].filter((t) => tn.has(t)).length / to.size : 0,
    secoes: to.size ? tn.size / to.size : 0,
    linhas: linhasComTexto(original) ? linhasComTexto(novo) / linhasComTexto(original) : 0,
  };
}

/** O arquivo da nova revisão tem de ter ao menos esta fração dos títulos do revisado, das seções e das linhas. */
export const SEMELHANCA_MINIMA = 0.6;
export const TAMANHO_MINIMO = 0.7;

/**
 * Por que o arquivo novo parece outro documento (outro curso, poucos títulos de seção em comum, tamanho
 * muito menor), ou nulo. Sem o curso no revisado, o arquivo novo que o identifica é a correção que "Qual
 * é o curso?" pede.
 */
function pareceOutroDocumento(
  revisado: { readonly markdown: string; readonly curso: ResultadoRevisaoPpc["curso"] },
  novo: { readonly markdown: string; readonly curso: ResultadoRevisaoPpc["curso"] },
): string | null {
  const comparacao = comparacaoComOriginal(revisado.markdown, novo.markdown);
  const outroCurso =
    difere(revisado.curso.cnct?.slug ?? null, novo.curso.cnct?.slug ?? null) ||
    difere(revisado.curso.forma, novo.curso.forma);
  return outroCurso
    ? "outro curso ou outra forma de oferta"
    : comparacao.titulosEmComum < SEMELHANCA_MINIMA
      ? `só ${Math.round(comparacao.titulosEmComum * 100)}% dos títulos de seção do revisado`
      : comparacao.secoes < TAMANHO_MINIMO || comparacao.linhas < TAMANHO_MINIMO
        ? `${Math.round(Math.min(comparacao.secoes, comparacao.linhas) * 100)}% do tamanho do revisado`
        : null;
}

/* ============================================================ textos */

const ROTULO_ACAO: Record<"aberta" | "resolvida", string> = {
  aberta: "Reaberta por você.",
  resolvida: "Você marcou como feita (sem nova revisão do arquivo).",
};

/** Os turnos anteriores, em frases fixas do app: o texto da IA não volta fora das marcas. */
function turnosAnteriores(eventos: readonly { acao: string; situacao: SituacaoPendencia }[]): TurnoAnterior[] {
  return eventos.flatMap((e): TurnoAnterior[] => {
    if (e.acao === "contestar")
      return [
        {
          acao: "contestar",
          resumo:
            e.situacao === "contestada_aceita"
              ? "a pessoa discordou e a pendência foi retirada com evidência conferida"
              : "a pessoa discordou e a pendência foi mantida",
        },
      ];
    if (e.acao === "sugerir") return [{ acao: "sugerir", resumo: "uma redação foi sugerida à pessoa" }];
    return [];
  });
}

const ponto = (t: string) => (/[.!?]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);

/** Os dois lados nomeiam algo e diferem (um lado sem curso não é "outro curso"). */
const difere = (a: string | null, b: string | null) => a !== null && b !== null && a !== b;

/* ============================================================ pedidos */

/** O que uma ação manda à IA: as instruções da sessão e o pedido. A estimativa mede este mesmo texto. */
interface TextoDaAcao {
  readonly instrucoes: string;
  readonly pedido: string;
}

/** O preparo de uma conversa (contestar, sugerir): o prefixo com a pendência e os turnos anteriores. */
interface Conversa {
  readonly nonce: string;
  readonly prefixo: string;
  readonly anteriores: ReadonlyArray<TurnoAnterior>;
}

const textoContestacao = (c: Conversa, motivo: string): TextoDaAcao => ({
  instrucoes: instrucoesConversa(c.nonce),
  pedido: pedidoContestacao(c.prefixo, motivo, c.anteriores, c.nonce),
});

const textoSugestao = (c: Conversa): TextoDaAcao => ({
  instrucoes: instrucoesConversa(c.nonce),
  pedido: pedidoSugestao(c.prefixo, c.anteriores),
});

/** O lote de uma ficha só da nova revisão de uma pendência da IA. */
const blocoRevisarDeNovo = (p: Pick<PendenciaRevisao, "ficha" | "tema" | "ordemTema">) => ({
  id: `revisar-de-novo-${p.ficha.toLowerCase()}`,
  tipo: "S" as const,
  tema: p.tema,
  ordemTema: p.ordemTema,
  fichas: [p.ficha],
});

/** O pedido do lote S da leitura com IA, com a ficha da pendência; as instruções são as do julgamento. */
const textoRevisarDeNovo = (
  p: Pick<PendenciaRevisao, "ficha" | "tema" | "ordemTema">,
  preparo: { readonly ctx: ContextoDaFicha; readonly nonce: string },
): TextoDaAcao => {
  const { ctx, nonce } = preparo;
  return {
    instrucoes: instrucoesJulgador(nonce),
    pedido: pedidoS(
      blocoRevisarDeNovo(p),
      [ctx.ficha],
      new Map([[ctx.ficha.id, ctx.proprio]]),
      ctx.contexto,
      nonce,
      ctx.comum,
    ),
  };
};

/**
 * O motivo da contestação na estimativa, que vem antes de a pessoa escrevê-lo: um tamanho típico. É o
 * único texto da estimativa que não é o do pedido.
 */
const MOTIVO_TIPICO = "x".repeat(400);

/* ============================================================ serviço */

export interface DadosNovaLista {
  readonly id: string;
  readonly arquivo: string;
  readonly revisado: RevisorPpc.RevisaoDoArquivo;
  readonly revisao: string | null;
  readonly provider: Provider | null;
  readonly modelo: string | null;
  readonly resultadosIa?: EntradaIa | null;
}

/**
 * A lista viva de um resultado, como `RevisoesPpc.criarLista` a grava: o registro e as pendências, uma
 * por chave (o script de teste real monta por aqui a lista com os resultados da IA).
 */
export function novaLista(d: DadosNovaLista): {
  readonly lista: RevisoesPpc.NovaLista;
  readonly pendencias: ReadonlyArray<{ chave: string; pendencia: PendenciaRevisao }>;
} {
  const resultado: ResultadoRevisaoPpc = RevisorPpc.resultadoParaInterface(d.arquivo, d.revisado);
  const vistas = new Set<string>();
  const pendencias = d.revisado.revisao.pendencias.flatMap((p) => {
    const chave = chavePendencia(p);
    if (vistas.has(chave)) return [];
    vistas.add(chave);
    return [{ chave, pendencia: p }];
  });
  return {
    lista: {
      id: d.id,
      arquivo: d.arquivo,
      sha256: d.revisado.sha256,
      revisao: d.revisao,
      provider: d.provider,
      modelo: d.modelo,
      cnct: resultado.curso.cnct?.slug ?? null,
      forma: resultado.curso.forma,
      markdown: d.revisado.revisao.markdown,
      linhasTextoParaIa: d.revisado.revisao.linhasTextoParaIa,
      resultado,
      resultadosIa: d.resultadosIa ?? null,
    },
    pendencias,
  };
}

export interface OpcoesListaViva {
  /** Recebe o texto bruto de cada ação com IA (só o script de medição usa; o app não grava). */
  readonly registrarTexto?: (acao: string, chave: string, texto: string) => Effect.Effect<void>;
}

export const make = Effect.fn("ListaViva.make")(function* (opcoes: OpcoesListaViva = {}) {
  const persistencia = yield* RevisoesPpc.RevisoesPpc;
  const copias = yield* CopiasComentadas.CopiasComentadas;
  const path = yield* Path.Path;
  const leiturasIa = yield* RevisaoIa.RevisaoIa;
  const revisor = yield* RevisorPpc.RevisorPpc;
  const fs = yield* FileSystem.FileSystem;
  const { exigirAviso } = yield* Preferencias.Preferencias;
  const contextoKb = yield* Effect.context<FontesNormativas.FontesNormativas | PacoteRevisaoPpc.PacoteRevisaoPpc>();
  const contextoMotor = yield* Effect.context<Motor.Motor | FileSystem.FileSystem>();
  const aleatorio = yield* SecureRandom.SecureRandom;
  // Uma ação com IA por vez: um clique duplo não paga duas vezes.
  const vez = yield* Semaphore.make(1);
  const EM_ANDAMENTO = "Já há uma ação com a IA em andamento nesta revisão. Espere ela terminar.";

  const falha = (arquivo: string, motivo: string) => new FalhaRevisaoPpc({ arquivo, motivo });

  const buscar = (id: string) =>
    persistencia.buscarLista(id).pipe(
      Effect.filterOrFail(
        (l): l is RevisoesPpc.RegistroLista => l !== null,
        () => falha("", "Esta lista de pendências não existe mais. Revise o PPC de novo."),
      ),
    );

  /** Grava a lista viva de um resultado e devolve o id dela. */
  const criarLista = Effect.fn("ListaViva.criarLista")(function* (
    d: Omit<DadosNovaLista, "id"> & { readonly id?: string },
    substitui?: string,
  ) {
    const id = d.id ?? `lista-${yield* aleatorio.uuidV4()}`;
    const { lista: nova, pendencias } = novaLista({ ...d, id });
    yield* persistencia
      .criarLista(nova, pendencias, substitui)
      .pipe(Effect.catchTags({ RevisaoEmAndamento: (e) => Effect.fail(falha(e.arquivo, e.message)) }));
    return id;
  });

  const montar = Effect.fn("ListaViva.montar")(function* (registro: RevisoesPpc.RegistroLista) {
    const pendencias = yield* persistencia.pendencias(registro.id);
    const eventos = yield* persistencia.eventos(registro.id);
    const uso = yield* persistencia.usoLista(registro.id);
    const vivas: PendenciaViva[] = pendencias.map((p) => ({
      chave: p.chave,
      pendencia: p.pendencia,
      situacao: p.situacao,
      resolvidaPor: p.resolvidaPor,
      historico: eventos.filter((e) => e.chave === p.chave).map(({ chave: _, ...e }) => e),
      sugestao: p.sugestao,
      aceitaIa: p.pendencia.ficha !== "TRIAGEM",
      // A pendência da IA de antes da IA por bloco foi julgada pela IA da lista.
      julgadaPor: p.pendencia.origem === "ia" ? (p.ia ?? registro.provider) : null,
    }));
    return {
      id: registro.id,
      arquivoOriginal: registro.arquivo,
      sha256: registro.sha256,
      revisao: registro.revisao,
      provider: registro.provider,
      resultado: registro.resultado,
      arquivoAcompanhado: registro.arquivoAcompanhado,
      conversaAoLado:
        registro.conversa === null ? null : { conversa: registro.conversa.id, pasta: registro.conversa.pasta },
      pendencias: vivas,
      uso: { ...uso, custoUsd: Math.round(uso.custoUsd * 1000) / 1000 },
      criadaEm: registro.criadaEm,
      atualizadaEm: registro.atualizadaEm,
    } satisfies ListaPendencias;
  });

  const lista = (id: string) => buscar(id).pipe(Effect.flatMap(montar));

  const pendenciaDe = Effect.fn("ListaViva.pendencia")(function* (registro: RevisoesPpc.RegistroLista, chave: string) {
    const p = (yield* persistencia.pendencias(registro.id)).find((x) => x.chave === chave);
    if (!p) return yield* falha(registro.arquivo, "Esta pendência não está mais na lista.");
    return p;
  });

  const provedor = (registro: RevisoesPpc.RegistroLista, pedido?: Provider) => {
    const provider = pedido ?? registro.provider ?? "claude";
    const modelo = provider === registro.provider ? registro.modelo : (MODELO_PADRAO[provider] ?? null);
    return { provider, modelo };
  };

  const contextoPara = (
    registro: RevisoesPpc.RegistroLista,
    ficha: string,
    markdown = registro.markdown,
    linhas = registro.linhasTextoParaIa,
  ) =>
    contextoDaFicha({
      markdown,
      linhasTextoParaIa: linhas,
      cnct: registro.cnct,
      curso: cursoEmTexto(registro.resultado.curso),
      ficha,
    }).pipe(
      Effect.provideContext(contextoKb),
      Effect.tapError((erro) => Effect.logError("lista viva: contexto da ficha falhou", erro)),
      Effect.mapError(() =>
        falha(registro.arquivo, "Não foi possível montar o contexto deste critério. Reinicie o app e tente de novo."),
      ),
      Effect.filterOrFail(
        (c) => c !== null,
        () => falha(registro.arquivo, "Este apontamento não tem critério para a IA reavaliar."),
      ),
    );

  /** O começo de toda ação com IA: o aviso de uso aceito, a lista e a pendência. */
  const abrirAcao = Effect.fn("ListaViva.abrirAcao")(function* (id: string, chave: string) {
    yield* exigirAviso;
    const registro = yield* buscar(id);
    const p = yield* pendenciaDe(registro, chave);
    return { registro, p };
  });

  /**
   * O preparo de uma ação com IA sobre a pendência: o provider e o modelo, o contexto da ficha (do texto
   * revisado ou, na nova revisão, do arquivo novo) e um nonce novo.
   */
  const prepararAcaoIa = Effect.fn("ListaViva.prepararAcaoIa")(function* (
    registro: RevisoesPpc.RegistroLista,
    p: RevisoesPpc.RegistroPendencia,
    pedido: Provider | undefined,
    texto?: { readonly markdown: string; readonly linhasTextoParaIa: readonly number[] },
  ) {
    const { provider, modelo } = provedor(registro, pedido);
    const ctx = yield* contextoPara(registro, p.pendencia.ficha, texto?.markdown, texto?.linhasTextoParaIa);
    const nonce = yield* novoNonce(aleatorio);
    return { provider, modelo, ctx, nonce };
  });

  /** O preparo da conversa (contestar, sugerir): mais os turnos anteriores da pendência e o prefixo. */
  const prepararConversa = Effect.fn("ListaViva.prepararConversa")(function* (
    registro: RevisoesPpc.RegistroLista,
    p: RevisoesPpc.RegistroPendencia,
    pedido: Provider | undefined,
  ) {
    const preparo = yield* prepararAcaoIa(registro, p, pedido);
    const eventos = (yield* persistencia.eventos(registro.id)).filter((e) => e.chave === p.chave);
    const prefixo = prefixoConversa({ ...preparo.ctx, pendencia: p.pendencia, nonce: preparo.nonce });
    return { ...preparo, anteriores: turnosAnteriores(eventos), prefixo };
  });

  /**
   * O fim de toda ação: a mudança da pendência e o evento no histórico (`fim`, com a pendência como está
   * agora, na trava da lista), e a lista atualizada. A lista pode ter sido apagada, e a pendência, mudada
   * por uma conferência ao salvar (outra chave, resolvida) enquanto a IA respondia: nada se grava. Com
   * `inicio` (a pendência quando a ação começou), recusa também se a situação mudou no meio, porque o
   * resultado da ação foi sobre a pendência de antes.
   */
  const concluirAcao = Effect.fn("ListaViva.concluirAcao")(function* (
    id: string,
    chave: string,
    fim: (atual: RevisoesPpc.RegistroPendencia) => readonly [MudancaDaAcao, RevisoesPpc.Evento],
    inicio?: RevisoesPpc.RegistroPendencia,
  ) {
    yield* persistencia.comTravaDaLista(
      id,
      Effect.gen(function* () {
        const registro = yield* buscar(id);
        const atual = (yield* persistencia.pendencias(id)).find((x) => x.chave === chave);
        const mudou =
          atual === undefined ||
          (inicio !== undefined && (atual.situacao !== inicio.situacao || atual.resolvidaPor !== inicio.resolvidaPor));
        if (mudou) return yield* falha(registro.arquivo, MUDOU_NO_MEIO);
        const [mudanca, evento] = fim(atual);
        yield* persistencia.mudarPendencia(id, chave, mudanca, evento);
      }),
    );
    return yield* lista(id);
  });

  /** Uma ação com IA por vez; a pausa do provider (limite, cota, queda) vira a frase para a pessoa. */
  const comIa = <A, R>(arquivo: string, efeito: Effect.Effect<A, FalhaRevisaoPpc | PausaRevisao | AvisoNaoAceito, R>) =>
    efeito.pipe(
      Effect.catchTags({ PausaRevisao: (pausa: PausaRevisao) => Effect.fail(falha(arquivo, pausa.motivo)) }),
      vez.withPermitsIfAvailable(1),
      Effect.flatMap((o) => (o._tag === "Some" ? Effect.succeed(o.value) : Effect.fail(falha(arquivo, EM_ANDAMENTO)))),
    );

  /* ------------------------------------------------------------ revisar, marcar */

  /**
   * Uma revisão nova, independente de qualquer outra do mesmo arquivo: só a pré-conferência, sem
   * resultados da IA nem situação herdados. As revisões anteriores do arquivo ficam como estão.
   */
  const revisarComEtapas = Effect.fn("ListaViva.revisar")(function* (
    entrada: RevisorPpc.EntradaRevisao,
    aoEtapa: RevisorPpc.AoEtapa,
  ) {
    const revisado = yield* revisor.revisarArquivo({ ...entrada, gravar: true, seOcupada: "recusar", aoEtapa });
    return yield* criarLista({
      arquivo: entrada.arquivo,
      revisado,
      revisao: null,
      provider: null,
      modelo: null,
      resultadosIa: null,
    });
  });

  const revisar = (entrada: RevisorPpc.EntradaRevisao) =>
    Stream.callback<EventoRevisaoPpc, FalhaRevisaoPpc>((fila) =>
      revisarComEtapas(entrada, (etapa) => {
        Queue.offerUnsafe(fila, { tipo: "etapa", etapa });
      }).pipe(
        Effect.flatMap((lista) => Queue.offer(fila, { tipo: "pronto", lista })),
        Effect.andThen(Queue.end(fila)),
      ),
    );

  const marcar = Effect.fn("ListaViva.marcar")(function* (id: string, chave: string, situacao: "aberta" | "resolvida") {
    const registro = yield* buscar(id);
    yield* pendenciaDe(registro, chave);
    return yield* concluirAcao(id, chave, () => [
      { situacao, resolvidaPor: "pessoa" },
      { acao: "marcar", situacao, texto: ROTULO_ACAO[situacao] },
    ]);
  });

  /* ------------------------------------------------------------ estimar */

  const estimar = Effect.fn("ListaViva.estimar")(function* (
    id: string,
    chave: string,
    acao: "contestar" | "sugerir" | "revisarDeNovo",
    pedido?: Provider,
  ) {
    const registro = yield* buscar(id);
    const p = yield* pendenciaDe(registro, chave);
    const { provider } = provedor(registro, pedido);
    // A nova revisão de uma ficha do código não usa IA.
    if (acao === "revisarDeNovo" && p.pendencia.origem === "codigo")
      return { provider, tokensEntrada: 0, tokensSaida: 0, segundos: 5, custoUsd: 0 } satisfies EstimativaAcao;
    // A contestação de uma pendência do código não vai à IA.
    if (acao === "contestar" && p.pendencia.origem === "codigo")
      return { provider, tokensEntrada: 0, tokensSaida: 0, segundos: 1, custoUsd: 0 } satisfies EstimativaAcao;
    // O mesmo texto que a ação manda. Na nova revisão, o arquivo novo ainda não foi escolhido: o texto
    // revisado da lista faz as vezes dele.
    const texto =
      acao === "revisarDeNovo"
        ? textoRevisarDeNovo(p.pendencia, yield* prepararAcaoIa(registro, p, pedido))
        : acao === "contestar"
          ? textoContestacao(yield* prepararConversa(registro, p, pedido), MOTIVO_TIPICO)
          : textoSugestao(yield* prepararConversa(registro, p, pedido));
    return estimarAcao(texto.instrucoes.length + texto.pedido.length, acao, provider) satisfies EstimativaAcao;
  });

  /* ------------------------------------------------------------ conversa */

  /** Uma ação na conversa da pendência: uma sessão nova, sem ferramentas, com o pedido completo. */
  const conversar = (entrada: {
    registro: RevisoesPpc.RegistroLista;
    chave: string;
    acao: "contestar" | "sugerir";
    provider: Provider;
    modelo: string | null;
    texto: TextoDaAcao;
  }) =>
    turnoSemFerramentas({
      provider: entrada.provider,
      modelo: entrada.modelo,
      instrucoes: entrada.texto.instrucoes,
      texto: entrada.texto.pedido,
      tempoTurno: TEMPO_ACAO,
      numero: 1,
      registrarTentativa: (t) =>
        persistencia.gravarAcao(entrada.registro.id, entrada.chave, { acao: entrada.acao, ...t }),
      ...(opcoes.registrarTexto
        ? { registrarTexto: (_: number, texto: string) => opcoes.registrarTexto!(entrada.acao, entrada.chave, texto) }
        : {}),
    }).pipe(Effect.provideContext(contextoMotor));

  /* ------------------------------------------------------------ contestar */

  const contestar = Effect.fn("ListaViva.contestar")(
    function* (id: string, chave: string, motivo: string, pedido?: Provider) {
      const { registro, p } = yield* abrirAcao(id, chave);
      if (p.pendencia.ficha === "TRIAGEM")
        return yield* falha(
          registro.arquivo,
          "Este apontamento é da triagem: remova o trecho ou marque como resolvido.",
        );
      const limpo = motivo.trim();
      if (!limpo)
        return yield* falha(registro.arquivo, "Escreva por que você discorda. Um trecho do PPC ou uma norma ajudam.");
      if (limpo.length > LIMITE_MOTIVO)
        return yield* falha(
          registro.arquivo,
          `Escreva o motivo em até ${LIMITE_MOTIVO.toLocaleString("pt-BR")} caracteres.`,
        );
      // A pendência do código não sai por contestação: a discordância fica registrada (para a
      // curadoria das regras) e a saída é "Já resolvi" com o arquivo corrigido. Sem IA, sem custo.
      if (p.pendencia.origem === "codigo")
        return yield* concluirAcao(
          id,
          chave,
          () => [
            { situacao: "contestada_mantida" },
            { acao: "contestar", situacao: "contestada_mantida", texto: `Mantida: ${MANTIDA_CODIGO}`, motivo: limpo },
          ],
          p,
        );
      const conversa = yield* prepararConversa(registro, p, pedido);
      const { ctx } = conversa;
      const turno = yield* conversar({
        registro,
        chave,
        acao: "contestar",
        provider: conversa.provider,
        modelo: conversa.modelo,
        texto: textoContestacao(conversa, limpo),
      });
      const decisao = turno.ferramentas.length
        ? {
            estado: "contestada_mantida" as const,
            explicacao: "A IA tentou usar uma ferramenta, o que a revisão não permite, e a resposta foi descartada.",
            trechos: [],
            problemas: [],
            iaPediuRetirar: false,
          }
        : conferirContestacao(turno.texto, {
            ficha: ctx.ficha,
            origem: "ia",
            recorte: ctx.recorte,
            secao: ctx.proprio.texto,
            fontes: new Set(ctx.fontes),
            trechoApontado: p.pendencia.trecho,
          });
      const texto =
        decisao.estado === "contestada_aceita"
          ? `Contestada com evidência conferida (fica para conferir): ${ponto(decisao.explicacao)} Trecho conferido: “${decisao.trechos[0]}”.`
          : `Mantida: ${ponto(decisao.explicacao)}${decisao.iaPediuRetirar && decisao.problemas.length ? ` O app não retirou porque ${decisao.problemas.join("; ")}.` : ""}`;
      return yield* concluirAcao(
        id,
        chave,
        () => [
          { situacao: decisao.estado },
          { acao: "contestar", situacao: decisao.estado, texto, motivo: limpo, uso: turno.uso },
        ],
        p,
      );
    },
    (e) => comIa("", e),
  );

  /* ------------------------------------------------------------ sugerir */

  const sugerir = Effect.fn("ListaViva.sugerir")(
    function* (id: string, chave: string, pedido?: Provider) {
      const { registro, p } = yield* abrirAcao(id, chave);
      if (p.pendencia.ficha === "TRIAGEM")
        return yield* falha(registro.arquivo, "Este apontamento é da triagem: o trecho sai do PPC, sem redação nova.");
      const conversa = yield* prepararConversa(registro, p, pedido);
      const { ctx } = conversa;
      const turno = yield* conversar({
        registro,
        chave,
        acao: "sugerir",
        provider: conversa.provider,
        modelo: conversa.modelo,
        texto: textoSugestao(conversa),
      });
      const sugestao = turno.ferramentas.length
        ? null
        : conferirSugestao(turno.texto, {
            recorte: ctx.recorte,
            contexto: ctx.contexto,
            fontes: new Set(ctx.fontes),
            pendencia: [textoDaPendencia(p.pendencia), p.pendencia.oQueFazer, p.pendencia.trecho ?? ""].join("\n"),
          });
      // A sugestão não muda a situação: fica a de agora (a pessoa ou um salvamento pode tê-la mudado).
      if (sugestao === null) {
        yield* concluirAcao(id, chave, (atual) => [
          { situacao: atual.situacao, resolvidaPor: atual.resolvidaPor },
          {
            acao: "sugerir",
            situacao: atual.situacao,
            texto: "A IA não devolveu uma redação que o app pudesse conferir.",
            uso: turno.uso,
          },
        ]);
        return yield* falha(
          registro.arquivo,
          "A IA não devolveu uma redação que o app pudesse conferir. Tente de novo.",
        );
      }
      const n = sugestao.naoConferidos.length;
      return yield* concluirAcao(id, chave, (atual) => [
        { situacao: atual.situacao, resolvidaPor: atual.resolvidaPor, sugestao },
        {
          acao: "sugerir",
          situacao: atual.situacao,
          texto: `Redação sugerida pela IA, para você revisar${n ? `; ${n} ${n === 1 ? "fato não conferido" : "fatos não conferidos"} pelo app` : ""}.`,
          uso: turno.uso,
        },
      ]);
    },
    (e) => comIa("", e),
  );

  /* ------------------------------------------------------------ arquivo novo */

  /**
   * Converte e pré-confere (só o código, sem gravar a cópia) o `.docx` novo de uma lista, com o curso
   * que a pessoa escolheu (se escolheu), e recusa o mesmo arquivo e o que parece outro documento (outro
   * curso, poucos títulos de seção em comum, tamanho muito menor). `consequencia` completa a frase da recusa.
   */
  const lerArquivoNovo = Effect.fn("ListaViva.lerArquivoNovo")(function* (
    registro: RevisoesPpc.RegistroLista,
    arquivo: string,
    consequencia: string,
  ) {
    const novo = yield* revisor.revisarArquivo({ arquivo, gravar: false, ...cursoEscolhido(registro) });
    if (novo.sha256 === registro.sha256)
      return yield* falha(
        arquivo,
        "É o mesmo arquivo revisado. Salve as mudanças no Word e escolha o arquivo atualizado.",
      );
    const nome = path.basename(arquivo);
    const motivo = pareceOutroDocumento({ markdown: registro.markdown, curso: registro.resultado.curso }, novo.revisao);
    if (motivo !== null)
      return yield* falha(
        arquivo,
        `${nome} parece outro documento ou uma versão incompleta (${motivo}). Escolha a versão atualizada e completa deste PPC; ${consequencia}.`,
      );
    return { novo, nome };
  });

  /* ------------------------------------------------------------ revisarDeNovo */

  const revisarDeNovo = Effect.fn("ListaViva.revisarDeNovo")(
    function* (id: string, chave: string, arquivo: string, pedido?: Provider) {
      const { registro, p } = yield* abrirAcao(id, chave);
      const { novo, nome } = yield* lerArquivoNovo(registro, arquivo, "a pendência não foi marcada como resolvida");
      // O que a triagem do arquivo novo aponta (texto dirigido a IA, seções ausentes) e a lista não tem entra nela.
      const atuais = yield* persistencia.pendencias(id);
      const existentes = new Set(atuais.map((x) => x.chave));
      const novasTriagem = novo.revisao.pendencias
        .filter((x) => x.ficha === "TRIAGEM")
        .map((x) => ({ chave: chavePendencia(x), pendencia: x }))
        .filter((x) => !existentes.has(x.chave));
      if (novasTriagem.length)
        yield* persistencia.comTravaDaLista(
          id,
          persistencia.acrescentarPendencias(id, novasTriagem, `Apareceu na nova revisão de ${nome}.`),
        );
      let resolvida: boolean;
      let texto: string;
      let uso = null;
      if (p.pendencia.origem === "codigo") {
        // Casa todas as pendências do código da lista com as do arquivo novo: distingue as regras da
        // triagem e os pontos distintos da mesma ficha (ex.: várias normas revogadas em CT-SUP-12).
        const { casadas } = casarPendencias(
          atuais.filter((x) => x.pendencia.origem === "codigo"),
          novo.revisao.pendencias.filter((x) => x.origem === "codigo"),
        );
        const ainda = casadas.get(chave) ?? null;
        resolvida = ainda === null;
        texto =
          ainda === null
            ? `Conferida na nova revisão de ${nome}: o critério não aponta mais este ponto.`
            : `A nova revisão de ${nome} ainda aponta: ${ponto(ainda.titulo)}`;
      } else {
        const preparo = yield* prepararAcaoIa(registro, p, pedido, novo.revisao);
        const { provider, modelo, ctx, nonce } = preparo;
        // As instruções do julgamento, o `julgarBloco` as monta com o mesmo nonce.
        const julgado = yield* julgarBloco({
          provider,
          modelo,
          nonce,
          bloco: blocoRevisarDeNovo(p.pendencia),
          fichas: [ctx.ficha],
          pedido: textoRevisarDeNovo(p.pendencia, preparo).pedido,
          alvos: alvosPorRecorte([ctx.ficha], new Map([[ctx.ficha.id, ctx.proprio]]), ctx.comum),
          fontes: new Set(ctx.fontes),
          tempoTurno: TEMPO_ACAO,
          revisaoHumana: teveTextoParaIa(retirarTextoParaIa(novo.revisao.markdown, novo.revisao.linhasTextoParaIa)),
          registrarTentativa: (t) => persistencia.gravarAcao(id, chave, { acao: "revisarDeNovo", ...t }),
        }).pipe(Effect.provideContext(contextoMotor));
        const r: ResultadoFichaIa = julgado.resultado.resultados[0]!;
        uso = julgado.uso;
        resolvida = r.estado !== "FALHOU" && estadoDaIa(r) === null;
        texto = resolvida
          ? `Conferida na nova revisão de ${nome}: a IA avaliou o critério de novo e o app conferiu o trecho.`
          : r.estado === "FALHOU"
            ? `A nova revisão de ${nome} não pôde ser conferida (${r.motivoFalha ?? "resposta fora do formato"}); a pendência continua.`
            : `A nova revisão de ${nome} ainda aponta: ${ponto(r.justificativa)}`;
      }
      const situacao: SituacaoPendencia = resolvida ? "resolvida" : "aberta";
      return yield* concluirAcao(
        id,
        chave,
        () => [
          { situacao, resolvidaPor: "revisarDeNovo" },
          { acao: "revisarDeNovo", situacao, texto, uso },
        ],
        p,
      );
    },
    (e, _id, _chave, arquivo) => comIa(arquivo, e),
  );

  /* ------------------------------------------------------------ cópia com a situação */

  /** Os resultados conferidos da leitura com IA que a lista guarda, para entrarem de novo na revisão. */
  const resultadosIa = (registro: RevisoesPpc.RegistroLista) => registro.resultadosIa ?? undefined;

  const gerarCopia = Effect.fn("ListaViva.gerarCopia")(function* (id: string) {
    yield* persistencia.comTravaDaLista(
      id,
      buscar(id).pipe(Effect.flatMap((registro) => regravarCopiaDaLista(registro, { persistencia, revisor, fs }))),
    );
    return yield* lista(id);
  });

  /** Na vez das escritas da lista: o texto e as pendências da mesma versão (nunca no meio de um arquivo novo). */
  const documento = Effect.fn("ListaViva.documento")(function* (id: string) {
    const { registro, pendencias } = yield* persistencia.comTravaDaLista(
      id,
      Effect.gen(function* () {
        const registro = yield* buscar(id);
        return { registro, pendencias: yield* persistencia.pendencias(registro.id) };
      }),
    );
    return documentoRevisado({ ...registro, pendencias });
  });

  /**
   * Confere a leitura com IA ligada à lista antes de trocar o que ela leu (o curso, o arquivo): recusa
   * com ela em andamento e indica se há revisão pausada/preparada para apagar depois que a troca concluir
   * (nunca antes das validações, para não perder uma leitura pausada numa ação recusada).
   */
  const verificarLeitura = Effect.fn("ListaViva.verificarLeitura")(function* (
    registro: RevisoesPpc.RegistroLista,
    acao: string,
  ) {
    if (registro.revisao === null) return { mantida: null as string | null, apagar: null as string | null };
    const revisao = yield* persistencia.resumoRevisao(registro.revisao);
    if (revisao === null) return { mantida: null as string | null, apagar: null as string | null };
    if (revisao.situacao === "em_andamento")
      return yield* falha(
        registro.arquivo,
        `A conferência com IA deste PPC está em andamento. Pause-a antes de ${acao}; o que ela já conferiu fica na lista.`,
      );
    if (revisao.situacao === "concluida") return { mantida: revisao.id, apagar: null as string | null };
    return { mantida: null as string | null, apagar: revisao.id };
  });

  /** Troca a lista inteira: espera as escritas curtas da lista e recusa se uma ação com IA está em andamento. */
  const trocandoALista = <A, E, R>(id: string, arquivo: string | undefined, efeito: Effect.Effect<A, E, R>) =>
    persistencia.comTravaDaLista(id, efeito).pipe(
      vez.withPermitsIfAvailable(1),
      Effect.flatMap((o) =>
        o._tag === "Some"
          ? Effect.succeed(o.value)
          : (arquivo !== undefined
              ? Effect.succeed(arquivo)
              : persistencia.buscarLista(id).pipe(Effect.map((r) => r?.arquivo ?? ""))
            ).pipe(Effect.flatMap((caminho) => Effect.fail(falha(caminho, EM_ANDAMENTO)))),
      ),
    );

  /* ------------------------------------------------------------ "Qual é o curso?" */

  const trocarCurso = Effect.fn("ListaViva.trocarCurso")(
    function* (id: string, cnct: string, forma: string | undefined) {
      const registro = yield* buscar(id);
      const { mantida, apagar } = yield* verificarLeitura(registro, "trocar o curso");
      const ia = resultadosIa(registro);
      const revisado = yield* revisor.revisarArquivo({
        arquivo: registro.arquivo,
        gravar: true,
        copia: registro.resultado.arquivoComentado,
        sha256: registro.sha256,
        cnct,
        ...(forma === undefined ? {} : { forma }),
        ...(ia ? { ia } : {}),
      });
      // A mesma revisão refeita com o curso: a lista nova herda a situação, o histórico e a sugestão de
      // cada pendência, a leitura com IA e o uso das ações, e a anterior sai.
      const novaId = yield* criarLista(
        {
          arquivo: registro.arquivo,
          revisado,
          revisao: mantida,
          provider: registro.provider,
          modelo: registro.modelo,
          resultadosIa: registro.resultadosIa,
        },
        id,
      );
      if (apagar !== null) yield* leiturasIa.apagar(apagar);
      return yield* lista(novaId);
    },
    (efeito, id) => trocandoALista(id, undefined, efeito),
  );

  /* ------------------------------------------------------------ "Enviar a versão corrigida" */

  const revisarArquivoNovo = Effect.fn("ListaViva.revisarArquivoNovo")(
    function* (id: string, arquivo: string) {
      const registro = yield* buscar(id);
      const { apagar } = yield* verificarLeitura(registro, "enviar a versão corrigida");
      const { novo, nome } = yield* lerArquivoNovo(registro, arquivo, "a lista não mudou");
      const pendencias = yield* persistencia.pendencias(id);
      const eventos = yield* persistencia.eventos(id);
      const plano = planoArquivoNovo(
        pendencias,
        novo.revisao.pendencias,
        nome,
        novo.revisao.curso.cnct === null,
        eventos,
      );
      // A cópia primeiro: se ela falha, nada mudou na lista, e a pessoa pode tentar de novo.
      const ia = resultadosIa(registro);
      const final = yield* revisor.revisarArquivo({
        arquivo,
        gravar: true,
        sha256: novo.sha256,
        ...cursoEscolhido(registro),
        ...(ia ? { ia } : {}),
        situacoes: marcasDaCopia(plano.pendenciasFinais, plano.eventosFinais),
      });
      const curso = final.revisao.curso;
      yield* persistencia.aplicarArquivoNovo(
        id,
        plano.mudancas,
        plano.novas,
        `Apareceu na revisão de ${nome}.`,
        {
          arquivo,
          sha256: final.sha256,
          markdown: final.revisao.markdown,
          linhasTextoParaIa: final.revisao.linhasTextoParaIa,
          cnct: curso.cnct?.slug ?? null,
          forma: curso.forma,
          resultado: RevisorPpc.resultadoParaInterface(arquivo, final),
        },
        locaisNoDocumento(final.revisao.pendencias),
      );
      if (apagar !== null) yield* leiturasIa.apagar(apagar);
      return {
        lista: yield* lista(id),
        resolvidas: plano.resolvidas,
        continuam: plano.continuam,
        novas: plano.contagemNovas,
      } satisfies ResultadoArquivoNovo;
    },
    (efeito, id, arquivo) => trocandoALista(id, arquivo, efeito),
  );

  /* ------------------------------------------------------------ conferência ao salvar */

  /** Os eventos da conferência ao salvar de cada lista, para quem a acompanha (`acompanharLista`). */
  const avisosConferencia = yield* PubSub.unbounded<{
    readonly lista: string;
    readonly evento: EventoAcompanhamento;
  }>();
  const avisarConferencia = (lista: string, evento: EventoAcompanhamento) =>
    PubSub.publish(avisosConferencia, { lista, evento }).pipe(Effect.asVoid);
  const agoraIso = Effect.map(DateTime.now, DateTime.formatIso);

  // Uma verificação por lista de cada vez (o vigia de cada fluxo aberto e o foco da janela); a entrada sai
  // do mapa quando ninguém mais a usa.
  const vezDaVerificacao = new Map<string, { readonly semaforo: Semaphore.Semaphore; ativos: number }>();
  // O sha256 que já falhou: o mesmo arquivo não é convertido de novo até mudar, ou até a pessoa escolher o
  // arquivo ou abrir a revisão de novo (a nova tentativa de uma falha passageira).
  const falhouEm = new Map<string, string>();

  const acompanhar = Effect.fn("ListaViva.acompanhar")(function* (id: string, arquivo?: string) {
    if (arquivo !== undefined) {
      // O sha256 confere a extensão, a liberação e o tamanho. O mesmo arquivo, escolhido de novo depois de
      // fechar o app, guarda a última conferência; outro é conferido ao abrir o fluxo. Na trava: uma
      // conferência em curso do acompanhado anterior vê a troca e não grava.
      yield* revisor.sha256(arquivo);
      yield* persistencia.comTravaDaLista(
        id,
        Effect.gen(function* () {
          const registro = yield* buscar(id);
          falhouEm.delete(id);
          yield* persistencia.acompanhar(
            id,
            arquivo,
            arquivo === registro.arquivoAcompanhado ? registro.sha256Conferido : null,
          );
        }),
      );
    } else {
      yield* persistencia.comTravaDaLista(
        id,
        Effect.gen(function* () {
          const registro = yield* buscar(id);
          // Já acompanhando (a interface não chega aqui: o botão sai), só confere a liberação.
          if (registro.arquivoAcompanhado !== null) return yield* revisor.exigirLiberado(registro.arquivoAcompanhado);
          yield* regravarCopiaDaLista(registro, { persistencia, revisor, fs });
          const copia = (yield* buscar(id)).resultado.arquivoComentado;
          // A cópia de uma execução anterior do app, que não foi regravada agora, não está liberada: o
          // original liberado a libera (sem ele, a pessoa escolhe o original de novo, como em toda ação).
          yield* revisor.liberarCopia(registro.arquivo, copia);
          const sha256 = yield* revisor.sha256(copia);
          // A cópia como o app a gravou tem o texto do arquivo revisado: nada a conferir. A que a pessoa
          // já editou é conferida ao abrir o fluxo.
          falhouEm.delete(id);
          yield* persistencia.acompanhar(id, copia, (yield* copias.conhecida(copia)) === sha256 ? sha256 : null);
        }),
      );
    }
    return yield* lista(id);
  });

  /**
   * A conferência ao salvar de `arquivo`, o acompanhado de `registro`: só o código, sem trocar o arquivo da
   * lista, sem regravar a cópia e sem tocar na leitura com IA. Recusa o arquivo que não parece o mesmo PPC.
   * Nula se a lista mudou durante a conversão (saiu, passou a acompanhar outro arquivo ou trocou o texto
   * revisado com "Enviar a versão corrigida"): o resultado não vale para ela, e nada é gravado.
   */
  const conferirSalvamento = Effect.fn("ListaViva.conferirSalvamento")(function* (
    registro: RevisoesPpc.RegistroLista,
    arquivo: string,
  ) {
    const id = registro.id;
    // A conversão, longa, fora da trava da lista: as ações e a leitura com IA seguem enquanto isso.
    const novo = yield* revisor.revisarArquivo({ arquivo, gravar: false, ...cursoEscolhido(registro) });
    const nome = path.basename(arquivo);
    return yield* persistencia.comTravaDaLista(
      id,
      Effect.gen(function* () {
        // Na trava: a lista como está agora (um bloco da IA pode ter entrado).
        const atual = yield* persistencia.buscarLista(id);
        if (atual === null || atual.arquivoAcompanhado !== arquivo || atual.sha256 !== registro.sha256) return null;
        const motivo = pareceOutroDocumento({ markdown: atual.markdown, curso: atual.resultado.curso }, novo.revisao);
        if (motivo !== null)
          return yield* falha(
            arquivo,
            `Este arquivo não parece o mesmo PPC (${motivo}). A lista não mudou; o app confere de novo no próximo salvamento.`,
          );
        const plano = planoArquivoNovo(
          yield* persistencia.pendencias(id),
          novo.revisao.pendencias,
          nome,
          novo.revisao.curso.cnct === null,
          yield* persistencia.eventos(id),
          { salvamento: true },
        );
        yield* persistencia.aplicarConferencia(
          id,
          plano.mudancas,
          plano.novas,
          `Apareceu ao salvar ${nome}.`,
          { ...atual.resultado, criterios: comCriteriosDoCodigo(atual.resultado.criterios, novo.revisao.criterios) },
          novo.sha256,
          retirarTextoParaIa(novo.revisao.markdown, novo.revisao.linhasTextoParaIa),
        );
        return { resolvidas: plano.chavesResolvidas, novas: plano.chavesNovas, continuam: plano.continuam };
      }),
    );
  });

  const verificarUmaVez = Effect.fn("ListaViva.verificarAcompanhado")(function* (id: string) {
    const registro = yield* persistencia.buscarLista(id);
    const arquivo = registro?.arquivoAcompanhado ?? null;
    if (registro === null || arquivo === null) return false;
    const falhou = (erro: FalhaRevisaoPpc) =>
      agoraIso.pipe(
        Effect.flatMap((em) =>
          avisarConferencia(id, {
            tipo: "falhou",
            em,
            motivo: erro.motivo,
            escolherDeNovo: erro.escolherDeNovo === true,
          }),
        ),
      );
    const lido = yield* Effect.result(revisor.sha256(arquivo));
    if (lido._tag === "Failure") {
      yield* falhou(lido.failure);
      return false;
    }
    const sha256 = lido.success;
    if (sha256 === registro.sha256Conferido || sha256 === falhouEm.get(id)) return false;
    const conferido = yield* Effect.result(conferirSalvamento(registro, arquivo));
    if (conferido._tag === "Failure") {
      falhouEm.set(id, sha256);
      yield* falhou(conferido.failure);
      return true;
    }
    // A lista mudou no meio: o vigia do acompanhado novo confere ao começar.
    if (conferido.success === null) return false;
    falhouEm.delete(id);
    yield* avisarConferencia(id, { tipo: "conferido", em: yield* agoraIso, ...conferido.success });
    return true;
  });

  const verificarAcompanhado = (id: string): Effect.Effect<boolean> =>
    Effect.suspend(() => {
      let vezDaLista = vezDaVerificacao.get(id);
      if (vezDaLista === undefined)
        vezDaVerificacao.set(id, (vezDaLista = { semaforo: Semaphore.makeUnsafe(1), ativos: 0 }));
      const v = vezDaLista;
      v.ativos += 1;
      return v.semaforo
        .withPermits(1)(verificarUmaVez(id))
        .pipe(
          // Um defeito (o banco) não derruba o vigia: fica no log, e o próximo salvamento tenta de novo.
          Effect.catchDefect((defeito) =>
            Effect.logError(`conferência ao salvar: a verificação falhou: ${resumoDaFalha(defeito)}`).pipe(
              Effect.as(false),
            ),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              v.ativos -= 1;
              if (v.ativos === 0 && vezDaVerificacao.get(id) === v) vezDaVerificacao.delete(id);
            }),
          ),
        );
    });

  const acompanharLista = (id: string) =>
    Stream.callback<EventoAcompanhamento, FalhaRevisaoPpc>((fila) =>
      Effect.gen(function* () {
        // As assinaturas antes da primeira leitura: nenhuma mudança se perde entre uma e outra.
        const mudancas = yield* persistencia.assinarMudancas;
        const avisos = yield* PubSub.subscribe(avisosConferencia);
        // Abrir o fluxo (reabrir a revisão) tenta de novo o arquivo que falhou; fechado, nada a lembrar.
        falhouEm.delete(id);
        yield* Effect.addFinalizer(() => Effect.sync(() => falhouEm.delete(id)));
        /** O arquivo vigiado e o vigia (nulo: o arquivo não está liberado nesta execução do app). */
        let vigiando: { readonly arquivo: string; readonly vigia: Fiber.Fiber<void> | null } | undefined;
        const ajustarVigia = Effect.fnUntraced(function* (arquivo: string | null) {
          // `fnUntraced`: roda a cada escrita na lista; o vigia e a verificação têm span próprio.
          if (vigiando !== undefined && vigiando.arquivo === arquivo && vigiando.vigia !== null) return;
          const antes = vigiando;
          if (antes?.vigia) yield* Fiber.interrupt(antes.vigia);
          vigiando = undefined;
          if (arquivo === null) return;
          const liberado = yield* Effect.result(revisor.exigirLiberado(arquivo));
          if (liberado._tag === "Failure") {
            // A pessoa escolhe o arquivo de novo; o aviso vai uma vez só por arquivo.
            if (antes?.arquivo !== arquivo) {
              const erro = liberado.failure;
              yield* Queue.offer(fila, {
                tipo: "falhou",
                em: yield* agoraIso,
                motivo: erro.motivo,
                escolherDeNovo: erro.escolherDeNovo === true,
              });
            }
            vigiando = { arquivo, vigia: null };
            return;
          }
          const vigia = yield* Vigia.vigiar(arquivo, verificarAcompanhado(id)).pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, path),
            Effect.forkScoped,
          );
          vigiando = { arquivo, vigia };
        });
        const enviar = Effect.fnUntraced(function* () {
          // `fnUntraced`: roda a cada escrita na lista; `montar` tem span próprio.
          const registro = yield* persistencia.buscarLista(id);
          if (registro === null) return yield* Queue.end(fila);
          yield* Queue.offer(fila, { tipo: "lista", lista: yield* montar(registro) });
          yield* ajustarVigia(registro.arquivoAcompanhado);
        });
        yield* buscar(id);
        yield* enviar();
        // Um consumidor só, na ordem. O aviso `conferido` é publicado depois da escrita da conferência,
        // mas chega por outra assinatura: a lista vai de novo antes dele, para a interface nunca realçar
        // como resolvida uma pendência que ela ainda mostra aberta.
        yield* Stream.merge(
          Stream.fromSubscription(mudancas).pipe(
            Stream.filter((lista) => lista === id),
            Stream.map(() => undefined),
          ),
          Stream.fromSubscription(avisos).pipe(
            Stream.filter((aviso) => aviso.lista === id),
            Stream.map((aviso) => aviso.evento),
          ),
        ).pipe(
          Stream.runForEach((evento) =>
            evento === undefined
              ? enviar()
              : evento.tipo === "conferido"
                ? enviar().pipe(Effect.andThen(Queue.offer(fila, evento)))
                : Queue.offer(fila, evento),
          ),
        );
      }),
    );

  // As leituras com IA das listas que expiram saem com elas.
  const expirar = DateTime.now.pipe(
    Effect.map((agora) => DateTime.formatIso(DateTime.subtract(agora, { days: DIAS_LISTA }))),
    Effect.flatMap(persistencia.expirarListas),
    Effect.andThen(leiturasIa.apagarOrfas),
  );

  /** As discordâncias contra pendências do código, em CSV (separado por ponto e vírgula, como o Excel em português lê). */
  const exportarDiscordancias = persistencia.contestacoes.pipe(
    Effect.map((linhas) => {
      // Texto da pessoa e do PPC: o que começa como fórmula de planilha ganha um apóstrofo na frente.
      const campo = (t: string) => {
        const formula = /^[\t\r]/.test(t) || /^[=+\-@]/.test(t.trimStart());
        const limpo = t.replace(/"/g, '""').replace(/\s+/g, " ").trim();
        return `"${formula ? "'" : ""}${limpo}"`;
      };
      const cabeca = ["data", "arquivo", "ficha", "critério", "apontamento", "trecho", "motivo da coordenação"];
      const corpo = linhas
        .filter((l) => l.pendencia.origem === "codigo")
        .map((l) =>
          [
            l.em.slice(0, 10),
            l.arquivo.split(/[\\/]/).at(-1) ?? l.arquivo,
            l.pendencia.ficha,
            l.pendencia.tituloFicha,
            textoDaPendencia(l.pendencia).replaceAll("\n", " "),
            l.pendencia.trecho ?? "",
            l.motivo ?? "",
          ]
            .map(campo)
            .join(";"),
        );
      return [cabeca.map(campo).join(";"), ...corpo].join("\r\n");
    }),
  );

  // As listas sem uso há mais de `DIAS_LISTA` saem ao subir o servidor (e a cada `listas`).
  yield* expirar;

  const todas = expirar.pipe(
    Effect.andThen(persistencia.todasListas),
    Effect.flatMap((ids) =>
      Effect.forEach(ids, (id) => lista(id).pipe(Effect.option)).pipe(
        Effect.map((achadas) => achadas.flatMap((o) => (o._tag === "Some" ? [o.value] : []))),
      ),
    ),
  );

  /**
   * Na vez das escritas da lista (`comTravaDaLista`): nenhuma troca de curso, arquivo novo ou revisão do
   * mesmo arquivo muda a lista no meio. A leitura com IA que espera a vez para mesclar é interrompida ali.
   */
  const apagar = Effect.fn("ListaViva.apagar")(function* (id: string) {
    yield* persistencia.comTravaDaLista(
      id,
      Effect.gen(function* () {
        const registro = yield* persistencia.buscarLista(id);
        if (registro === null) return;
        // As leituras da lista e a ligada a ela: a execução para antes, para não gravar um bloco numa lista
        // que não existe.
        const leituras = new Set((yield* persistencia.revisoesDaLista(id)).map((r) => r.id));
        if (registro.revisao !== null) leituras.add(registro.revisao);
        for (const leitura of leituras) yield* leiturasIa.apagar(leitura);
        yield* persistencia.apagarLista(id);
        yield* leiturasIa.apagarOrfas;
      }),
    );
  });

  return ListaViva.of({
    revisar,
    lista,
    todas,
    trocarCurso,
    apagar,
    exportarDiscordancias,
    marcar,
    estimar,
    contestar,
    sugerir,
    revisarDeNovo,
    revisarArquivoNovo,
    gerarCopia,
    documento,
    acompanhar,
    verificarAcompanhado,
    acompanharLista,
  });
});

/**
 * Pede as `RevisoesPpc`, as `CopiasComentadas`, a `RevisaoIa`, o `RevisorPpc`, as `Preferencias`, o
 * `Motor`, o `FileSystem`, o `Path`, as `FontesNormativas` e o `PacoteRevisaoPpc` do `kb.sqlite`.
 */
export const layer = (opcoes: OpcoesListaViva = {}) => Layer.effect(ListaViva, make(opcoes));
