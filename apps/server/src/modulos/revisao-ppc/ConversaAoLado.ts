/**
 * `ConversaAoLado`: as conversas com a IA ao lado de uma revisão de PPC (`docs/plans/multitarefa.md`,
 * "Conversa ao lado", decisões 2, 9, 11 e 12). A IA não enxerga o PPC em revisão (ele não está na base que
 * o MCP `ifpr` lê): o módulo o leva à pasta da conversa, em Markdown.
 *
 * - **Várias conversas por revisão, uma pasta por conversa** (decisão 12): uma revisão tem discussões
 *   sobre temas diferentes, e o núcleo das pastas (o índice dos anexos, as cópias do Desfazer, apagar com a
 *   pasta) supõe uma conversa por pasta. Antes de cada mensagem enviada pelo painel, `conversarSobre`
 *   retoma a conversa pedida (uma das ligadas à lista, `revisao_ppc_conversas`), ou a nascida da pendência
 *   pedida, ou, sem nenhuma, cria a pasta ("PPC <curso> – <tema>": o critério da pendência, ou
 *   "conversa" na geral; `PastasTrabalho.criar`) e abre uma conversa livre (`Conversas.iniciar`, com a IA
 *   pedida e a origem na revisão), que a lista guarda com a pendência. Tudo na vez da lista
 *   (`comTravaDaLista`): duas mensagens seguidas sobre a mesma pendência não abrem duas conversas, e a
 *   lista não muda no meio. Se a conversa não abre, a pasta nova sai. A conversa apagada pela lista de
 *   conversas sai das listas ao subir o servidor, e a próxima mensagem da pendência dela abre outra. A que
 *   parou no limite e continuou com outra IA (`continuadaCom`) toma o lugar dela, com a mesma pendência, já
 *   ao ser criada (no painel ou na tela cheia), pelo gatilho da tabela (`persistencia/tabelas.ts`): apagar a
 *   original não a deixa órfã, e a continuação apagada devolve a linha à anterior. O painel que ainda pede a
 *   anterior recebe a última da cadeia (`nova`, para a interface reler a lista).
 * - **A pendência que muda de chave** (a conferência ao salvar que lhe dá outro trecho, a leitura com IA que
 *   a substitui): a conversa fica na lista da revisão, com a chave antiga, e a interface a mostra sem a
 *   pendência; "Conversar sobre esta pendência" na nova abre outra. A que muda antes do primeiro envio
 *   também: a conversa nasce ligada à chave pedida (a da origem no painel), com o tema que a interface
 *   mandou (`tema`), e não como geral.
 * - **O que vai à pasta é o que a ficha pede, no envio.** Com `ppc`, o Markdown do PPC (`ARQUIVO_PPC`: o
 *   texto do último arquivo conferido ao salvar, ou o revisado), com um sumário de seções e linhas no topo,
 *   e a nota com o caminho do `.docx` que está no Word; com `docx`, a cópia do `.docx`. Sem a ficha, nada
 *   entra, e a seção da pendência só vai na instrução se a ficha da pendência ficou.
 * - **Sempre atual** (decisão 9): as escritas que trocam o texto da lista passam por aqui (`trocarCurso`,
 *   `revisarArquivoNovo` e a conferência ao salvar, por `conferirAcompanhado` e `acompanharLista`), e o
 *   Markdown e a nota que já estão nas pastas de todas as conversas da lista são regravados logo depois, na
 *   vez da lista, seja qual for o lugar de onde a próxima mensagem sai (o painel ou a tela cheia). A pasta
 *   avisa a IA da mudança no turno seguinte (`PastasTrabalho.abrirTurno`), e o aviso fica na conversa; a
 *   ficha do PPC diz a hora (`atualizadoEm`). "Qual é o curso?" troca o id da lista: as linhas das
 *   conversas e a origem delas passam à lista nova.
 * - **Revisão apagada:** `apagarLista` apaga a lista (`ListaViva.apagar`) e passa a origem de todas as
 *   conversas ao lado (as ligadas e as que as continuaram com outra IA) a "revisão apagada"; as conversas e
 *   as pastas ficam.
 *
 * O módulo chama o núcleo (as conversas e as pastas), nunca o contrário.
 */
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import {
  type AvisoNaoAceito,
  type FalhaPasta,
  type NivelEsforco,
  type OrigemConversa,
  type Provider,
} from "@simplifica-if/contratos-app";
import {
  type ConversaSobre,
  type EventoAcompanhamento,
  FalhaRevisaoPpc,
  type ListaPendencias,
  type ResultadoArquivoNovo,
} from "@simplifica-if/contratos-app/modulos/revisao-ppc";
import { segmentarPpc } from "@simplifica-if/kb/ppcs/secoes";
import type * as Motor from "@simplifica-if/motor";
import { retirarTextoParaIa } from "@simplifica-if/ppc/revisao-ia/plano";
import * as Conversas from "../../Conversas.ts";
import * as PastasTrabalho from "../../PastasTrabalho.ts";
import * as PastasNode from "../../pastas-node.ts";
import * as Historico from "../../persistencia/Historico.ts";
import * as Preferencias from "../../persistencia/Preferencias.ts";
import * as ListaViva from "./ListaViva.ts";
import * as RevisoesPpc from "./persistencia/RevisoesPpc.ts";
import * as RevisorPpc from "./RevisorPpc.ts";

export interface EntradaConversarSobre {
  readonly lista: string;
  /** Retoma esta conversa (uma das ligadas à lista, ou a continuação de uma delas). */
  readonly conversa?: string;
  /** Sem `conversa`: a conversa nascida desta pendência, que se abre se ainda não há. */
  readonly pendencia?: string;
  /** O tema da pasta nova quando a `pendencia` já não está na lista (mudou de chave antes do envio). */
  readonly tema?: string;
  /** A pendência em foco (a ficha dela ficou), por cuja seção a instrução de leitura manda começar. */
  readonly chave?: string;
  readonly provider: Provider;
  readonly modelo?: string;
  readonly esforco?: NivelEsforco;
  readonly ppc: boolean;
  readonly docx: boolean;
}

/** O Markdown do PPC na pasta: um nome só, que "Enviar a versão corrigida" com outro arquivo regrava. */
export const ARQUIVO_PPC = "PPC em revisão.md";

/** A nota da pasta, ao lado do Markdown: qual `.docx` está no Word e onde. */
export const NOTA = "Sobre o PPC.md";

/** A origem da conversa ao lado depois que a revisão sai. */
export const ORIGEM_APAGADA: OrigemConversa = { rotulo: "revisão apagada", rota: null };

export class ConversaAoLado extends Context.Service<
  ConversaAoLado,
  {
    readonly conversarSobre: (
      entrada: EntradaConversarSobre,
    ) => Effect.Effect<ConversaSobre, FalhaRevisaoPpc | AvisoNaoAceito | Motor.FalhaProvider | FalhaPasta>;
    /** Apaga a revisão (`ListaViva.apagar`); as conversas ao lado ficam, com a origem "revisão apagada". */
    readonly apagarLista: (id: string) => Effect.Effect<void>;
    /** `ListaViva.trocarCurso`, com a origem das conversas ao lado na lista nova e o Markdown regravado. */
    readonly trocarCurso: (
      id: string,
      cnct: string,
      forma: string | undefined,
    ) => Effect.Effect<ListaPendencias, FalhaRevisaoPpc>;
    /** `ListaViva.revisarArquivoNovo`, com o Markdown da pasta regravado. */
    readonly revisarArquivoNovo: (id: string, arquivo: string) => Effect.Effect<ResultadoArquivoNovo, FalhaRevisaoPpc>;
    /** `ListaViva.verificarAcompanhado`, com o Markdown da pasta regravado se houve conferência. */
    readonly conferirAcompanhado: (id: string) => Effect.Effect<void>;
    /** `ListaViva.acompanharLista`, com o Markdown da pasta regravado a cada conferência. */
    readonly acompanharLista: (id: string) => Stream.Stream<EventoAcompanhamento, FalhaRevisaoPpc>;
  }
>()("@simplifica-if/server/modulos/revisao-ppc/ConversaAoLado") {}

/** O nome do arquivo, sem a pasta (Windows ou POSIX). */
const nomeDoArquivo = (caminho: string) => caminho.split(/[\\/]/).pop() || caminho;

/** O nome do PPC (o curso no CNCT, ou o arquivo sem a extensão). */
export const nomeDoPpc = (registro: Pick<RevisoesPpc.RegistroLista, "arquivo" | "resultado">): string =>
  registro.resultado.curso.cnct?.denominacao ?? nomeDoArquivo(registro.arquivo).replace(/\.docx$/i, "");

/** "PPC <nome>", sem repetir o "PPC" que o nome do arquivo já traz. */
export const comPpc = (nome: string): string => (/^PPC\b/i.test(nome) ? nome : `PPC ${nome}`);

/**
 * O Markdown da pasta: o título, de onde veio, o sumário (cada seção com a linha em que começa neste
 * arquivo) e o texto do PPC. Devolve também a linha de cada seção, pelo título.
 */
export function markdownDaConversa(
  arquivo: string,
  markdown: string,
): { readonly texto: string; readonly linhaDaSecao: (titulo: string) => number | undefined } {
  const secoes = segmentarPpc(markdown, "tecnico");
  const cabeca = [
    `# ${nomeDoArquivo(arquivo)}`,
    "",
    `O texto do PPC em revisão no Simplifica IF, convertido do .docx. Leia-o inteiro antes de responder. A nota “${NOTA}”, nesta pasta, diz qual arquivo está no Word.`,
    "",
    "## Sumário (seção e linha neste arquivo)",
    "",
  ];
  // As linhas do cabeçalho, do sumário e do separador antes do texto do PPC.
  const deslocamento = cabeca.length + secoes.length + 3;
  const linha = (s: { readonly linhaInicio: number }) => s.linhaInicio + deslocamento;
  const sumario = secoes.map((s) => `- ${s.titulo}: linha ${linha(s)}`);
  const texto = [...cabeca, ...sumario, "", "---", "", markdown].join("\n");
  return {
    texto,
    linhaDaSecao: (titulo) => {
      const secao = secoes.find((s) => s.titulo === titulo);
      return secao === undefined ? undefined : linha(secao);
    },
  };
}

/** A nota com os caminhos: o `.docx` que está no Word (o acompanhado) e o revisado. */
export function notaDaConversa(registro: Pick<RevisoesPpc.RegistroLista, "arquivo" | "arquivoAcompanhado">): string {
  const linhas = [
    "# O PPC desta conversa",
    "",
    registro.arquivoAcompanhado === null
      ? `O arquivo revisado: ${registro.arquivo}`
      : `O arquivo que está no Word, acompanhado pelo app: ${registro.arquivoAcompanhado}`,
    ...(registro.arquivoAcompanhado === null || registro.arquivoAcompanhado === registro.arquivo
      ? []
      : ["", `O arquivo revisado: ${registro.arquivo}`]),
    "",
    "O Markdown ao lado é uma cópia em texto, refeita pelo app quando o arquivo é salvo no Word. Para mudar o PPC, a pessoa edita o .docx no Word.",
    "",
  ];
  return linhas.join("\n");
}

/** O tema da pasta de uma conversa nova: o critério da pendência (ou o título dela), curto. */
export function temaDaPendencia(p: { readonly tituloFicha: string; readonly titulo: string }): string {
  const tema = (p.tituloFicha.trim() || p.titulo.trim()).replace(/\s+/g, " ");
  if (tema.length <= 40) return tema;
  const corte = tema.slice(0, 40);
  const espaco = corte.lastIndexOf(" ");
  return `${(espaco > 20 ? corte.slice(0, espaco) : corte).replace(/[\s.,;:–-]+$/, "")}…`;
}

/** A rota da revisão `id`, a da origem das conversas ao lado dela. */
const rotaDaRevisao = (id: string) => `/revisao-ppc?id=${id}`;

/** A origem da conversa ao lado na lista de conversas: o rótulo com o curso e a rota da revisão. */
const origemDaRevisao = (registro: Pick<RevisoesPpc.RegistroLista, "id" | "arquivo" | "resultado">) => {
  const nome = nomeDoPpc(registro);
  return {
    rotulo: registro.resultado.curso.cnct === null ? `da revisão de “${nome}”` : `da revisão do PPC de ${nome}`,
    rota: rotaDaRevisao(registro.id),
  } satisfies OrigemConversa;
};

/** A instrução que vai na ficha do PPC (e fica à vista na mensagem gravada). */
export function instrucaoDoPpc(
  gravado: "novo" | "regravado" | "igual",
  secao: { readonly titulo: string; readonly linha: number | undefined } | undefined,
  atualizadoEm: string | null,
): string {
  const naSecao =
    secao === undefined ? "" : `seção “${secao.titulo}”${secao.linha === undefined ? "" : ` (linha ${secao.linha})`}`;
  if (gravado === "novo")
    return `Leia o arquivo inteiro antes de responder${naSecao === "" ? "" : `, começando pela ${naSecao}`}.`;
  if (gravado === "regravado")
    return `O texto foi atualizado com o último salvamento do PPC: releia o arquivo${naSecao === "" ? "" : `, começando pela ${naSecao}`}, antes de responder.`;
  const atualizado = atualizadoEm === null ? "" : ", atualizado com o último salvamento";
  return `O PPC continua nesse arquivo${atualizado}${naSecao === "" ? "" : `; veja a ${naSecao}`}.`;
}

const make = Effect.gen(function* () {
  const persistencia = yield* RevisoesPpc.RevisoesPpc;
  const viva = yield* ListaViva.ListaViva;
  const revisor = yield* RevisorPpc.RevisorPpc;
  const pastas = yield* PastasTrabalho.PastasTrabalho;
  const conversas = yield* Conversas.Conversas;
  const historico = yield* Historico.Historico;
  const { exigirAviso } = yield* Preferencias.Preferencias;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  // A revisão apagada só sai depois de uma preparação em curso: nenhuma conversa nova se liga a uma lista
  // que está saindo, e as origens que `apagarLista` muda são as das conversas ligadas.
  const vez = yield* Semaphore.make(1);
  const codificador = new TextEncoder();
  // Quando o Markdown de cada pasta foi regravado por último nesta execução, para a ficha do PPC.
  const atualizados = new Map<string, string>();

  // A conversa ao lado apagada (pela lista de conversas, que não conhece o módulo) sai das listas.
  for (const conversa of yield* persistencia.conversasLigadas)
    if (Option.isNone(yield* historico.buscar(conversa))) yield* persistencia.desligarConversa(conversa);

  /** O texto do PPC como vai à pasta: o do último arquivo conferido ao salvar, ou o revisado. */
  const markdownDa = (registro: RevisoesPpc.RegistroLista) =>
    markdownDaConversa(
      registro.arquivo,
      registro.markdownConferido ?? retirarTextoParaIa(registro.markdown, registro.linhasTextoParaIa),
    );

  /** Grava o Markdown e a nota; devolve o que houve com o Markdown. */
  const gravarPpc = Effect.fn("ConversaAoLado.gravarPpc")(function* (
    pasta: string,
    registro: RevisoesPpc.RegistroLista,
    md: ReturnType<typeof markdownDaConversa>,
  ) {
    const gravado = yield* pastas.gravar(pasta, ARQUIVO_PPC, codificador.encode(md.texto));
    yield* pastas.gravar(pasta, NOTA, codificador.encode(notaDaConversa(registro)));
    if (gravado === "regravado") atualizados.set(pasta, DateTime.formatIso(yield* DateTime.now));
    return gravado;
  });

  /** As pastas das conversas ligadas à lista `id` (cada conversa tem a sua). */
  const pastasDa = (id: string) =>
    persistencia.conversasDaLista(id).pipe(Effect.map((ligadas) => [...new Set(ligadas.map((l) => l.pasta))]));

  /**
   * Regrava o Markdown e a nota que já estão nas pastas das conversas ao lado da lista `id` (a ficha do PPC
   * já os levou), depois de uma escrita que pode ter trocado o texto. Na pasta sem o Markdown, nada entra.
   * Nunca falha: o erro de uma pasta vai para o log, as outras seguem, e a próxima mensagem com a ficha do
   * PPC tenta de novo.
   */
  const regravar = Effect.fn("ConversaAoLado.regravar")(function* (id: string) {
    yield* persistencia.comTravaDaLista(
      id,
      Effect.gen(function* () {
        const registro = yield* persistencia.buscarLista(id);
        if (registro === null) return;
        const md = markdownDa(registro);
        for (const pasta of yield* pastasDa(id)) {
          if (Option.isNone(yield* Effect.option(fs.lstat(path.join(pasta, ARQUIVO_PPC))))) continue;
          yield* gravarPpc(pasta, registro, md).pipe(
            Effect.catchTags({
              FalhaPasta: (erro) =>
                Effect.logWarning(`conversa ao lado: o texto do PPC não foi regravado: ${erro.motivo}`),
            }),
          );
        }
      }),
    );
  });

  /** A última conversa da cadeia de continuações de `id` que ainda existe (a própria, sem continuação). */
  const seguirContinuacoes = Effect.fn("ConversaAoLado.seguirContinuacoes")(function* (id: string) {
    let atual = Option.getOrUndefined(yield* historico.buscar(id));
    const cadeia = atual === undefined ? [] : [atual.id];
    while (atual?.continuadaCom !== undefined) {
      const seguinte = Option.getOrUndefined(yield* historico.buscar(atual.continuadaCom.id));
      if (seguinte === undefined) break;
      atual = seguinte;
      cadeia.push(atual.id);
    }
    return { ultima: atual, cadeia };
  });

  /** O `.docx` para anexar: liberado, um arquivo comum e dentro do limite do revisor. */
  const lerDocx = Effect.fn("ConversaAoLado.lerDocx")(function* (original: string) {
    yield* revisor.exigirLiberado(original);
    const naoLeu = () =>
      new FalhaRevisaoPpc({ arquivo: original, motivo: "Não foi possível ler o .docx para anexar." });
    const info = yield* fs.stat(original).pipe(Effect.mapError(naoLeu));
    if (info.type !== "File" || Number(info.size) > RevisorPpc.LIMITES.bytesDoArquivo) return yield* naoLeu();
    return yield* fs.readFile(original).pipe(Effect.mapError(naoLeu));
  });

  const conversarSobre = Effect.fn("ConversaAoLado.conversarSobre")(function* (entrada: EntradaConversarSobre) {
    yield* exigirAviso;
    return yield* vez.withPermits(1)(
      persistencia.comTravaDaLista(
        entrada.lista,
        Effect.gen(function* () {
          const registro = yield* persistencia.buscarLista(entrada.lista);
          if (registro === null)
            return yield* new FalhaRevisaoPpc({ arquivo: "", motivo: "Esta revisão não existe mais no app." });
          // O `.docx` antes de tudo: sem ele (a revisão reaberta sem o arquivo liberado), nada se cria.
          const original = registro.arquivoAcompanhado ?? registro.arquivo;
          const docx = entrada.docx ? yield* lerDocx(original) : undefined;

          // A conversa pedida: a que o painel já tem (uma das ligadas, ou a continuação de uma delas); sem ela,
          // a nascida da pendência pedida. A ligada segue pela continuação, se continuou com outra IA (a linha
          // passa à continuação), e a apagada (pela lista de conversas, nesta execução) não volta.
          const pendencias = yield* persistencia.pendencias(registro.id);
          const daPendencia =
            entrada.pendencia === undefined ? undefined : pendencias.find((p) => p.chave === entrada.pendencia);
          // Da mais nova para a mais antiga: a pendência com mais de uma (a anterior foi apagada) fica na última.
          const ligadas = [];
          for (const l of (yield* persistencia.conversasDaLista(registro.id)).toReversed())
            ligadas.push({ ...l, ...(yield* seguirContinuacoes(l.conversa)) });
          // A pedida pode ser uma anterior da cadeia (o painel ainda com a que continuou na tela cheia): vale a
          // última da cadeia dela.
          const ultimaPedida =
            entrada.conversa === undefined ? undefined : (yield* seguirContinuacoes(entrada.conversa)).ultima?.id;
          const achada =
            (entrada.conversa === undefined
              ? undefined
              : ligadas.find(
                  (l) =>
                    l.cadeia.includes(entrada.conversa!) ||
                    (ultimaPedida !== undefined && l.ultima?.id === ultimaPedida),
                )) ??
            (entrada.pendencia === undefined
              ? undefined
              : ligadas.find((l) => l.ultima !== undefined && l.pendencia === entrada.pendencia));
          let ligada: { readonly conversa: string; readonly pasta: string } | undefined;
          let nova = false;
          if (achada?.ultima !== undefined) {
            if (achada.ultima.id !== achada.conversa) {
              yield* persistencia.trocarConversa(achada.conversa, achada.ultima.id, achada.ultima.pastaTrabalho);
              nova = true;
            }
            ligada = { conversa: achada.ultima.id, pasta: achada.ultima.pastaTrabalho };
          }
          let conversa: string;
          let pasta: string;
          if (ligada !== undefined) {
            conversa = ligada.conversa;
            pasta = ligada.pasta;
          } else {
            // A pendência que mudou de chave antes do primeiro envio (o salvamento lhe deu outro trecho) liga a
            // conversa à chave pedida, a do painel, com o tema que a interface mandou.
            const tema =
              daPendencia !== undefined
                ? temaDaPendencia(daPendencia.pendencia)
                : entrada.pendencia !== undefined && entrada.tema !== undefined && entrada.tema.trim() !== ""
                  ? temaDaPendencia({ tituloFicha: entrada.tema, titulo: "" })
                  : "conversa";
            const criada = yield* pastas.criar(`${comPpc(nomeDoPpc(registro))} – ${tema}`);
            pasta = criada;
            conversa = yield* conversas
              .iniciar(
                {
                  provider: entrada.provider,
                  pastaTrabalho: criada,
                  ...(entrada.modelo === undefined ? {} : { modelo: entrada.modelo }),
                  ...(entrada.esforco === undefined ? {} : { esforco: entrada.esforco }),
                },
                // Sem tarefa, o canal não decide nada.
                "estavel",
                origemDaRevisao(registro),
              )
              .pipe(
                Effect.catchTags({
                  PastaTrabalhoInvalida: () =>
                    Effect.fail(new FalhaRevisaoPpc({ arquivo: "", motivo: "A pasta da conversa sumiu." })),
                  TarefaDesconhecida: (erro) => Effect.die(erro),
                  // Só a continuação de outra conversa as pede.
                  SessaoDesconhecida: (erro) => Effect.die(erro),
                  TurnoEmAndamento: (erro) => Effect.die(erro),
                }),
                Effect.map((iniciada) => iniciada.sessao),
                Effect.onError(() => PastasNode.removerPastaVazia(criada).pipe(Effect.ignore)),
              );
            yield* persistencia.ligarConversa(registro.id, conversa, pasta, entrada.pendencia ?? null);
            nova = true;
          }

          let ppc: ConversaSobre["ppc"] = null;
          if (entrada.ppc) {
            const md = markdownDa(registro);
            const gravado = yield* gravarPpc(pasta, registro, md);
            const titulo =
              entrada.chave === undefined
                ? null
                : (pendencias.find((p) => p.chave === entrada.chave)?.pendencia.secao ?? null);
            const atualizadoEm = gravado === "novo" ? null : (atualizados.get(pasta) ?? null);
            ppc = {
              arquivo: ARQUIVO_PPC,
              instrucao: instrucaoDoPpc(
                gravado,
                titulo === null ? undefined : { titulo, linha: md.linhaDaSecao(titulo) },
                atualizadoEm,
              ),
              atualizadoEm,
            };
          }

          let anexado: string | null = null;
          if (docx !== undefined) {
            anexado = nomeDoArquivo(original);
            yield* pastas.gravar(pasta, anexado, docx);
          }
          // `nova`: as conversas da lista mudaram (a aberta agora, ou a continuação de uma delas), ou a conversa
          // não é a que o painel pediu (a continuação dela).
          return {
            conversa,
            nova: nova || (entrada.conversa !== undefined && conversa !== entrada.conversa),
            ppc,
            docx: anexado,
          } satisfies ConversaSobre;
        }),
      ),
    );
  });

  /**
   * As conversas ao lado da revisão `id`: as que a lista guarda (`ligadas`) e as de origem nela (as que
   * continuaram uma delas com outra IA, que a lista só passa a guardar na próxima mensagem pelo painel).
   */
  const conversasDaRevisao = Effect.fn("ConversaAoLado.conversasDaRevisao")(function* (
    id: string,
    ligadas: ReadonlyArray<string>,
  ) {
    const rota = rotaDaRevisao(id);
    const daOrigem = (yield* historico.listar).filter((c) => c.origem?.rota === rota).map((c) => c.id);
    return new Set([...ligadas, ...daOrigem]);
  });

  const apagarLista = Effect.fn("ConversaAoLado.apagarLista")(function* (id: string) {
    yield* vez.withPermits(1)(
      Effect.gen(function* () {
        const ligadas = yield* persistencia.conversasDaLista(id);
        yield* viva.apagar(id);
        for (const l of ligadas) atualizados.delete(l.pasta);
        for (const conversa of yield* conversasDaRevisao(
          id,
          ligadas.map((l) => l.conversa),
        ))
          yield* conversas.mudarOrigem(conversa, ORIGEM_APAGADA).pipe(Effect.ignore);
      }),
    );
  });

  const trocarCurso = Effect.fn("ConversaAoLado.trocarCurso")(function* (
    id: string,
    cnct: string,
    forma: string | undefined,
  ) {
    const lista = yield* viva.trocarCurso(id, cnct, forma);
    // A lista nova herda as conversas da antiga: a origem passa a ela, com o curso escolhido.
    const registro = yield* persistencia.buscarLista(lista.id);
    const ligadas = (yield* persistencia.conversasDaLista(lista.id)).map((l) => l.conversa);
    if (registro !== null)
      for (const conversa of yield* conversasDaRevisao(id, ligadas))
        yield* conversas.mudarOrigem(conversa, origemDaRevisao(registro)).pipe(Effect.ignore);
    yield* regravar(lista.id);
    return lista;
  });

  const revisarArquivoNovo = Effect.fn("ConversaAoLado.revisarArquivoNovo")(function* (id: string, arquivo: string) {
    const resultado = yield* viva.revisarArquivoNovo(id, arquivo);
    yield* regravar(id);
    return resultado;
  });

  const conferirAcompanhado = Effect.fn("ConversaAoLado.conferirAcompanhado")(function* (id: string) {
    if (yield* viva.verificarAcompanhado(id)) yield* regravar(id);
  });

  const acompanharLista = (id: string) =>
    viva.acompanharLista(id).pipe(Stream.tap((evento) => (evento.tipo === "conferido" ? regravar(id) : Effect.void)));

  return ConversaAoLado.of({
    conversarSobre,
    apagarLista,
    trocarCurso,
    revisarArquivoNovo,
    conferirAcompanhado,
    acompanharLista,
  });
});

/**
 * Pede a `ListaViva`, as `RevisoesPpc`, o `RevisorPpc`, as `PastasTrabalho`, as `Conversas`, o
 * `Historico`, as `Preferencias`, o `FileSystem` e o `Path`.
 */
export const layer = Layer.effect(ConversaAoLado, make);
