/**
 * `ConversaAoLado`: a conversa com a IA ao lado de uma revisão de PPC (`docs/plans/multitarefa.md`,
 * "Conversa ao lado", decisões 2, 9, 11 e 12). A IA não enxerga o PPC em revisão (ele não está na base que
 * o MCP `ifpr` lê): o módulo o leva à pasta da conversa, em Markdown.
 *
 * - **Uma conversa por revisão.** Antes de cada mensagem enviada pelo painel, `conversarSobre` retoma a
 *   conversa da revisão (`conversa_id` da lista) ou, na primeira, cria a pasta ("PPC <curso> – conversa",
 *   `PastasTrabalho.criar`) e abre uma conversa livre (`Conversas.iniciar`, com a IA pedida e a origem na
 *   revisão), que a lista guarda. Tudo na vez da lista (`comTravaDaLista`): duas mensagens seguidas não
 *   abrem duas conversas, e a lista não muda no meio. Se a conversa não abre, a pasta nova sai. A conversa
 *   apagada pela lista de conversas sai das listas ao subir o servidor, e a próxima mensagem abre outra. A
 *   que parou no limite e continuou com outra IA (`continuadaCom`) passa a ser a da revisão.
 * - **O que vai à pasta é o que a ficha pede, no envio.** Com `ppc`, o Markdown do PPC (`ARQUIVO_PPC`: o
 *   texto do último arquivo conferido ao salvar, ou o revisado), com um sumário de seções e linhas no topo,
 *   e a nota com o caminho do `.docx` que está no Word; com `docx`, a cópia do `.docx`. Sem a ficha, nada
 *   entra, e a seção da pendência só vai na instrução se a ficha da pendência ficou.
 * - **Sempre atual** (decisão 9): as escritas que trocam o texto da lista passam por aqui (`trocarCurso`,
 *   `revisarArquivoNovo` e a conferência ao salvar, por `conferirAcompanhado` e `acompanharLista`), e o
 *   Markdown e a nota que já estão na pasta são regravados logo depois, na vez da lista, seja qual for o
 *   lugar de onde a próxima mensagem sai (o painel ou a tela cheia). A pasta avisa a IA da mudança no turno
 *   seguinte (`PastasTrabalho.abrirTurno`), e o aviso fica na conversa; a ficha do PPC diz a hora
 *   (`atualizadoEm`). "Qual é o curso?" troca o id da lista: a origem das conversas passa à lista nova.
 * - **Revisão apagada:** `apagarLista` apaga a lista (`ListaViva.apagar`) e passa a origem das conversas ao
 *   lado (a ligada e a que a continuou com outra IA) a "revisão apagada"; as conversas e a pasta ficam.
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
    /** Apaga a revisão (`ListaViva.apagar`); a conversa ao lado fica, com a origem "revisão apagada". */
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
  // que está saindo, e a origem que `apagarLista` muda é a da conversa ligada.
  const vez = yield* Semaphore.make(1);
  const codificador = new TextEncoder();
  // Quando o Markdown de cada lista foi regravado por último nesta execução, para a ficha do PPC.
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
    if (gravado === "regravado") atualizados.set(registro.id, DateTime.formatIso(yield* DateTime.now));
    return gravado;
  });

  /**
   * Regrava o Markdown e a nota que já estão na pasta da conversa ao lado da lista `id` (a ficha do PPC já
   * os levou), depois de uma escrita que pode ter trocado o texto. Sem o Markdown na pasta, nada entra.
   * Nunca falha: o erro vai para o log, e a próxima mensagem com a ficha do PPC tenta de novo.
   */
  const regravar = Effect.fn("ConversaAoLado.regravar")(function* (id: string) {
    yield* persistencia
      .comTravaDaLista(
        id,
        Effect.gen(function* () {
          const registro = yield* persistencia.buscarLista(id);
          if (registro === null || registro.conversa === null) return;
          const pasta = registro.conversa.pasta;
          if (Option.isNone(yield* Effect.option(fs.lstat(path.join(pasta, ARQUIVO_PPC))))) return;
          yield* gravarPpc(pasta, registro, markdownDa(registro));
        }),
      )
      .pipe(
        Effect.catchTags({
          FalhaPasta: (erro) => Effect.logWarning(`conversa ao lado: o texto do PPC não foi regravado: ${erro.motivo}`),
        }),
      );
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

          // A conversa da revisão, se ainda existe (a pessoa pode tê-la apagado); senão, uma nova, na pasta
          // nova, que sai vazia se a conversa não abre.
          let ligada =
            registro.conversa === null
              ? undefined
              : Option.getOrUndefined(yield* historico.buscar(registro.conversa.id));
          // A conversa que parou no limite e continuou com outra IA: a revisão passa à continuação.
          while (ligada?.continuadaCom !== undefined) {
            const seguinte = Option.getOrUndefined(yield* historico.buscar(ligada.continuadaCom.id));
            if (seguinte === undefined) break;
            ligada = seguinte;
          }
          if (ligada !== undefined && ligada.id !== registro.conversa?.id)
            yield* persistencia.ligarConversa(registro.id, ligada.id, ligada.pastaTrabalho);
          let conversa: string;
          let pasta: string;
          if (ligada !== undefined) {
            conversa = ligada.id;
            pasta = ligada.pastaTrabalho;
          } else {
            const criada = yield* pastas.criar(`${comPpc(nomeDoPpc(registro))} – conversa`);
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
            yield* persistencia.ligarConversa(registro.id, conversa, pasta);
          }

          let ppc: ConversaSobre["ppc"] = null;
          if (entrada.ppc) {
            const md = markdownDa(registro);
            const gravado = yield* gravarPpc(pasta, registro, md);
            const titulo =
              entrada.chave === undefined
                ? null
                : ((yield* persistencia.pendencias(registro.id)).find((p) => p.chave === entrada.chave)?.pendencia
                    .secao ?? null);
            const atualizadoEm = gravado === "novo" ? null : (atualizados.get(registro.id) ?? null);
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
          // `nova`: a lista passou a guardar outra conversa (a aberta agora, ou a continuação da que guardava).
          const nova = ligada === undefined || ligada.id !== registro.conversa?.id;
          return { conversa, nova, ppc, docx: anexado } satisfies ConversaSobre;
        }),
      ),
    );
  });

  /**
   * As conversas ao lado da revisão `id`: a que a lista guarda e as de origem nela (a que continuou a dela
   * com outra IA, que a lista só passa a guardar na próxima mensagem pelo painel).
   */
  const conversasDaRevisao = Effect.fn("ConversaAoLado.conversasDaRevisao")(function* (
    id: string,
    ligada: string | undefined,
  ) {
    const rota = rotaDaRevisao(id);
    const daOrigem = (yield* historico.listar).filter((c) => c.origem?.rota === rota).map((c) => c.id);
    return new Set(ligada === undefined ? daOrigem : [ligada, ...daOrigem]);
  });

  const apagarLista = Effect.fn("ConversaAoLado.apagarLista")(function* (id: string) {
    yield* vez.withPermits(1)(
      Effect.gen(function* () {
        const ligada = (yield* persistencia.buscarLista(id))?.conversa?.id;
        yield* viva.apagar(id);
        atualizados.delete(id);
        for (const conversa of yield* conversasDaRevisao(id, ligada))
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
    if (registro !== null)
      for (const conversa of yield* conversasDaRevisao(id, registro.conversa?.id))
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
