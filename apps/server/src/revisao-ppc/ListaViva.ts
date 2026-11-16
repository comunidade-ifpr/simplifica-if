// @effect-diagnostics nodeBuiltinImport:off -- o id e o nonce da lista (`node:crypto`)
/**
 * `ListaViva`: a lista de pendências que a pessoa mantém (M1.11, etapa 5b), no servidor, e as ações
 * dentro de cada pendência.
 *
 * - **A lista** nasce de cada análise (a pré-conferência, `analisar`) e de cada revisão com IA concluída
 *   (`criarLista`, chamada pela `RevisaoIa`). Fica no `conversas.sqlite` (`Listas`), com o texto do PPC
 *   que as ações usam; sobrevive a fechar o app e à cota. A situação marcada passa para a lista nova do
 *   mesmo arquivo com o mesmo conteúdo (chave da pendência igual).
 * - **O roteiro**: as paradas são os temas com pendência ou critério conferido, na ordem do parecer da
 *   PROENS; a lista lembra as paradas vistas e onde a pessoa estava.
 * - **"Vou ajustar" e "Já resolvi"** (`marcar`): só mudam a situação, sem IA.
 * - **"Já resolvi" com o arquivo novo** (`reanalisar`): o servidor converte e pré-confere o `.docx` novo
 *   e reconfere **só a ficha da pendência**: no código (fichas D e triagem) e, nas da IA, num lote de uma
 *   ficha conferido como no julgamento. A situação sai do resultado: `resolvida` só se a ficha não
 *   aponta mais nada; senão volta a `aberta`, com o que ainda falta.
 * - **"Discordo…"** (`contestar`) e **"Sugerir texto"** (`sugerir`): uma sessão sem ferramentas, com o
 *   pedido e a conferência do `conversa.ts` do `packages/ppc`. Quem decide é o código (ver lá).
 * - O uso de cada ação com IA fica em `acoes_ia` e soma ao uso da revisão com IA de onde a lista veio.
 *   Uma ação com IA por vez; a estimativa vem antes (`estimar`).
 */
import * as NodeCrypto from "node:crypto";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import type * as SqlClient from "effect/sql/SqlClient";
import {
  type EstimativaAcao,
  FalhaRevisaoPpc,
  type ListaPendencias,
  type PendenciaViva,
  type Provider,
  type ResultadoRevisaoPpc,
  type SituacaoPendencia,
} from "@simplifica-if/contratos-app";
import type { FontesNormativas } from "@simplifica-if/kb/FontesNormativas";
import * as Motor from "@simplifica-if/motor";
import {
  conferirContestacao,
  conferirSugestao,
  instrucoesConversa,
  pedidoContestacao,
  pedidoSugestao,
  prefixoConversa,
  type TurnoAnterior,
} from "@simplifica-if/ppc/revisao-ia/conversa";
import { estimarAcao } from "@simplifica-if/ppc/revisao-ia/estimativa";
import { pedidoS } from "@simplifica-if/ppc/revisao-ia/pedido";
import { retirarTextoParaIa, teveTextoParaIa } from "@simplifica-if/ppc/revisao-ia/plano";
import { MODELO_PADRAO } from "@simplifica-if/ppc/revisao-ia/tipos";
import {
  chavePendencia,
  estadoDaIa,
  type MarcaPendencia,
  NOME_DA_FORMA,
  type ResultadoFichaIa,
  TEMAS,
} from "@simplifica-if/ppc/revisao-previa";
import { Listas, type RegistroLista } from "../persistencia/Listas.ts";
import { Revisoes } from "../persistencia/Revisoes.ts";
import { AnalisePpc, type EntradaAnalise, type RevisaoDoArquivo, resultadoParaInterface } from "./AnalisePpc.ts";
import { julgarBloco, PausaRevisao, turnoSemFerramentas } from "./julgamento.ts";
import { contextoDaFicha, type PlanoRevisaoIa } from "./preparo.ts";

export const TEMPO_ACAO = Duration.minutes(4);
export const LIMITE_MOTIVO = 1500;

export class ListaViva extends Context.Service<
  ListaViva,
  {
    /** A pré-conferência (`AnalisePpc.analisar`) com a lista viva gravada: o resultado traz o `lista`. */
    readonly analisar: (entrada: EntradaAnalise) => Effect.Effect<ResultadoRevisaoPpc, FalhaRevisaoPpc>;
    readonly lista: (id: string) => Effect.Effect<ListaPendencias, FalhaRevisaoPpc>;
    readonly ultima: Effect.Effect<ListaPendencias | null>;
    readonly apagar: (id: string) => Effect.Effect<void>;
    readonly marcar: (
      id: string,
      chave: string,
      situacao: "aberta" | "vou_ajustar" | "resolvida",
    ) => Effect.Effect<ListaPendencias, FalhaRevisaoPpc>;
    readonly verParada: (id: string, ordem: number) => Effect.Effect<ListaPendencias, FalhaRevisaoPpc>;
    readonly estimar: (
      id: string,
      chave: string,
      acao: "contestar" | "sugerir" | "reanalisar",
      provider?: Provider,
    ) => Effect.Effect<EstimativaAcao, FalhaRevisaoPpc>;
    readonly contestar: (
      id: string,
      chave: string,
      motivo: string,
      provider?: Provider,
    ) => Effect.Effect<ListaPendencias, FalhaRevisaoPpc>;
    readonly sugerir: (
      id: string,
      chave: string,
      provider?: Provider,
    ) => Effect.Effect<ListaPendencias, FalhaRevisaoPpc>;
    readonly reanalisar: (
      id: string,
      chave: string,
      arquivo: string,
      provider?: Provider,
    ) => Effect.Effect<ListaPendencias, FalhaRevisaoPpc>;
    readonly gerarCopia: (id: string) => Effect.Effect<ListaPendencias, FalhaRevisaoPpc>;
  }
>()("@simplifica-if/server/revisao-ppc/ListaViva") {}

/* ============================================================ criar */

export interface DadosNovaLista {
  readonly id?: string;
  readonly arquivo: string;
  readonly analisado: RevisaoDoArquivo;
  readonly revisao: string | null;
  readonly provider: Provider | null;
  readonly modelo: string | null;
}

/** Grava a lista viva de um resultado e devolve o resultado com o `lista`. Pede as `Listas`. */
export const criarLista = Effect.fn("ListaViva.criarLista")(function* (d: DadosNovaLista) {
  const listas = yield* Listas;
  const id = d.id ?? `lista-${NodeCrypto.randomUUID()}`;
  const resultado: ResultadoRevisaoPpc = { ...resultadoParaInterface(d.arquivo, d.analisado), lista: id };
  const vistas = new Set<string>();
  const pendencias = resultado.pendencias.flatMap((p) => {
    const chave = chavePendencia(p);
    if (vistas.has(chave)) return [];
    vistas.add(chave);
    return [{ chave, pendencia: p }];
  });
  yield* listas.criar(
    {
      id,
      arquivo: d.arquivo,
      sha256: d.analisado.sha256,
      revisao: d.revisao,
      provider: d.provider,
      modelo: d.modelo,
      cnct: resultado.curso.cnct?.slug ?? null,
      forma: resultado.curso.forma,
      markdown: d.analisado.revisao.markdown,
      linhasTextoParaIa: d.analisado.revisao.linhasTextoParaIa,
      nonce: NodeCrypto.randomBytes(8).toString("hex"),
      resultado,
    },
    pendencias,
  );
  return resultado;
});

/* ============================================================ textos */

const ROTULO_ACAO: Record<"aberta" | "vou_ajustar" | "resolvida", string> = {
  aberta: "Reaberta por você.",
  vou_ajustar: "Você marcou que vai ajustar.",
  resolvida: "Você marcou como resolvida (sem reanálise do arquivo).",
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

/* ============================================================ serviço */

export const make = Effect.fn("ListaViva.make")(function* (opcoes: { readonly tempoAcao?: Duration.Duration } = {}) {
  const tempoAcao = opcoes.tempoAcao ?? TEMPO_ACAO;
  const listas = yield* Listas;
  const revisoes = yield* Revisoes;
  const analise = yield* AnalisePpc;
  const contextoKb = yield* Effect.context<FontesNormativas | SqlClient.SqlClient>();
  const contextoMotor = yield* Effect.context<Motor.Motor>();
  const contextoListas = yield* Effect.context<Listas>();
  // Uma ação com IA por vez: um clique duplo não paga duas vezes.
  const vez = yield* Semaphore.make(1);

  const falha = (arquivo: string, motivo: string) => new FalhaRevisaoPpc({ arquivo, motivo });

  const buscar = (id: string) =>
    listas.buscar(id).pipe(
      Effect.filterOrFail(
        (l): l is RegistroLista => l !== null,
        () => falha("", "Esta lista de pendências não existe mais. Analise o PPC de novo."),
      ),
    );

  const montar = Effect.fn("ListaViva.montar")(function* (registro: RegistroLista) {
    const pendencias = yield* listas.pendencias(registro.id);
    const eventos = yield* listas.eventos(registro.id);
    const uso = yield* listas.uso(registro.id);
    const vivas: PendenciaViva[] = pendencias.map((p) => ({
      chave: p.chave,
      pendencia: p.pendencia,
      situacao: p.situacao,
      resolvidaPor: p.resolvidaPor,
      historico: eventos.filter((e) => e.chave === p.chave).map(({ chave: _, ...e }) => e),
      sugestao: p.sugestao,
      aceitaIa: p.pendencia.ficha !== "TRIAGEM",
    }));
    const ordens = [
      ...new Set([...registro.resultado.pendencias, ...registro.resultado.criterios].map((x) => x.ordemTema)),
    ].sort((a, b) => a - b);
    const vistas = new Set(registro.paradasVistas);
    return {
      id: registro.id,
      arquivoOriginal: registro.arquivo,
      revisao: registro.revisao,
      provider: registro.provider,
      resultado: registro.resultado,
      pendencias: vivas,
      paradas: ordens.map((ordem) => ({ ordem, tema: TEMAS[ordem]?.titulo ?? "Outros", vista: vistas.has(ordem) })),
      paradaAtual: registro.paradaAtual,
      uso: { ...uso, custoUsd: Math.round(uso.custoUsd * 1000) / 1000 },
      criadaEm: registro.criadaEm,
      atualizadaEm: registro.atualizadaEm,
    } satisfies ListaPendencias;
  });

  const lista = (id: string) => buscar(id).pipe(Effect.flatMap(montar));

  const pendenciaDe = Effect.fn("ListaViva.pendencia")(function* (registro: RegistroLista, chave: string) {
    const p = (yield* listas.pendencias(registro.id)).find((x) => x.chave === chave);
    if (!p) return yield* falha(registro.arquivo, "Esta pendência não está mais na lista.");
    return p;
  });

  const provedor = (registro: RegistroLista, pedido?: Provider) => {
    const provider = pedido ?? registro.provider ?? "claude";
    const modelo = provider === registro.provider ? registro.modelo : (MODELO_PADRAO[provider] ?? null);
    return { provider, modelo };
  };

  const cursoEmTexto = (r: RegistroLista) => {
    const c = r.resultado.curso;
    return c.cnct
      ? `${c.cnct.denominacao}${c.forma ? `, forma de oferta ${NOME_DA_FORMA[c.forma] ?? c.forma}` : ", forma de oferta não identificada"}`
      : null;
  };

  const contextoPara = (
    registro: RegistroLista,
    ficha: string,
    markdown = registro.markdown,
    linhas = registro.linhasTextoParaIa,
  ) =>
    contextoDaFicha({
      markdown,
      linhasTextoParaIa: linhas,
      cnct: registro.cnct,
      curso: cursoEmTexto(registro),
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

  /** Uma ação com IA por vez; a pausa do provider (limite, cota, queda) vira a frase para a pessoa. */
  const comIa = <A, R>(arquivo: string, efeito: Effect.Effect<A, FalhaRevisaoPpc | PausaRevisao, R>) =>
    efeito.pipe(
      Effect.catchTags({ PausaRevisao: (pausa: PausaRevisao) => Effect.fail(falha(arquivo, pausa.motivo)) }),
      vez.withPermitsIfAvailable(1),
      Effect.flatMap((o) =>
        o._tag === "Some"
          ? Effect.succeed(o.value)
          : Effect.fail(falha(arquivo, "Já há uma ação com a IA em andamento. Espere ela terminar.")),
      ),
    );

  /* ------------------------------------------------------------ analisar, marcar, paradas */

  const analisar = Effect.fn("ListaViva.analisar")(function* (entrada: EntradaAnalise) {
    const analisado = yield* analise.analisarCompleto(entrada);
    return yield* criarLista({
      arquivo: entrada.arquivo,
      analisado,
      revisao: null,
      provider: null,
      modelo: null,
    }).pipe(Effect.provideContext(contextoListas));
  });

  const marcar = Effect.fn("ListaViva.marcar")(function* (
    id: string,
    chave: string,
    situacao: "aberta" | "vou_ajustar" | "resolvida",
  ) {
    const registro = yield* buscar(id);
    yield* pendenciaDe(registro, chave);
    yield* listas.mudar(
      id,
      chave,
      { situacao, resolvidaPor: "pessoa" },
      { acao: "marcar", situacao, texto: ROTULO_ACAO[situacao] },
    );
    return yield* lista(id);
  });

  const verParada = Effect.fn("ListaViva.verParada")(function* (id: string, ordem: number) {
    yield* buscar(id);
    yield* listas.verParada(id, ordem);
    return yield* lista(id);
  });

  /* ------------------------------------------------------------ estimar */

  const estimar = Effect.fn("ListaViva.estimar")(function* (
    id: string,
    chave: string,
    acao: "contestar" | "sugerir" | "reanalisar",
    pedido?: Provider,
  ) {
    const registro = yield* buscar(id);
    const p = yield* pendenciaDe(registro, chave);
    const { provider } = provedor(registro, pedido);
    // A reanálise de uma ficha do código não usa IA.
    if (acao === "reanalisar" && p.pendencia.origem === "codigo")
      return { provider, tokensEntrada: 0, tokensSaida: 0, segundos: 5, custoUsd: 0 } satisfies EstimativaAcao;
    const ctx = yield* contextoPara(registro, p.pendencia.ficha);
    const prefixo = prefixoConversa({ ...ctx, pendencia: p.pendencia, nonce: registro.nonce });
    const texto =
      acao === "contestar"
        ? pedidoContestacao(prefixo, "x".repeat(400), [], registro.nonce)
        : acao === "sugerir"
          ? pedidoSugestao(prefixo, [])
          : prefixo;
    return estimarAcao(
      texto.length + instrucoesConversa(registro.nonce).length,
      acao,
      provider,
    ) satisfies EstimativaAcao;
  });

  /* ------------------------------------------------------------ contestar */

  const contestar = Effect.fn("ListaViva.contestar")(
    function* (id: string, chave: string, motivo: string, pedido?: Provider) {
      const registro = yield* buscar(id);
      const p = yield* pendenciaDe(registro, chave);
      if (!p.pendencia.ficha || p.pendencia.ficha === "TRIAGEM")
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
      const { provider, modelo } = provedor(registro, pedido);
      const ctx = yield* contextoPara(registro, p.pendencia.ficha);
      const eventos = (yield* listas.eventos(id)).filter((e) => e.chave === chave);
      const prefixo = prefixoConversa({ ...ctx, pendencia: p.pendencia, nonce: registro.nonce });
      const turno = yield* turnoSemFerramentas({
        provider,
        modelo,
        instrucoes: instrucoesConversa(registro.nonce),
        texto: pedidoContestacao(prefixo, limpo, turnosAnteriores(eventos), registro.nonce),
        tempoTurno: tempoAcao,
        numero: 1,
        manterCache: true,
        registrarTentativa: (t) => listas.gravarAcao(id, chave, { acao: "contestar", ...t }),
      }).pipe(Effect.provideContext(contextoMotor));
      const decisao = turno.ferramentas.length
        ? {
            estado: "contestada_mantida" as const,
            explicacao: "A IA tentou usar uma ferramenta, o que a revisão não permite, e a resposta foi descartada.",
            trechos: [],
            problemas: [],
            iaPediuRetirar: false,
          }
        : conferirContestacao(turno.texto, { ficha: ctx.ficha, recorte: ctx.recorte, fontes: new Set(ctx.fontes) });
      const texto =
        decisao.estado === "contestada_aceita"
          ? `Retirada: ${ponto(decisao.explicacao)}${decisao.trechos[0] ? ` Trecho conferido: “${decisao.trechos[0]}”.` : ""}`
          : `Mantida: ${ponto(decisao.explicacao)}${decisao.iaPediuRetirar && decisao.problemas.length ? ` O app não retirou porque ${decisao.problemas.join("; ")}.` : ""}`;
      yield* listas.mudar(
        id,
        chave,
        { situacao: decisao.estado },
        { acao: "contestar", situacao: decisao.estado, texto, motivo: limpo, uso: turno.uso },
      );
      return yield* lista(id);
    },
    (e) => comIa("", e),
  );

  /* ------------------------------------------------------------ sugerir */

  const sugerir = Effect.fn("ListaViva.sugerir")(
    function* (id: string, chave: string, pedido?: Provider) {
      const registro = yield* buscar(id);
      const p = yield* pendenciaDe(registro, chave);
      if (p.pendencia.ficha === "TRIAGEM")
        return yield* falha(registro.arquivo, "Este apontamento é da triagem: o trecho sai do PPC, sem redação nova.");
      const { provider, modelo } = provedor(registro, pedido);
      const ctx = yield* contextoPara(registro, p.pendencia.ficha);
      const eventos = (yield* listas.eventos(id)).filter((e) => e.chave === chave);
      const prefixo = prefixoConversa({ ...ctx, pendencia: p.pendencia, nonce: registro.nonce });
      const turno = yield* turnoSemFerramentas({
        provider,
        modelo,
        instrucoes: instrucoesConversa(registro.nonce),
        texto: pedidoSugestao(prefixo, turnosAnteriores(eventos)),
        tempoTurno: tempoAcao,
        numero: 1,
        manterCache: true,
        registrarTentativa: (t) => listas.gravarAcao(id, chave, { acao: "sugerir", ...t }),
      }).pipe(Effect.provideContext(contextoMotor));
      const sugestao = turno.ferramentas.length
        ? null
        : conferirSugestao(turno.texto, { recorte: ctx.recorte, contexto: ctx.contexto, fontes: new Set(ctx.fontes) });
      if (sugestao === null) {
        yield* listas.mudar(
          id,
          chave,
          { situacao: p.situacao, resolvidaPor: p.resolvidaPor },
          {
            acao: "sugerir",
            situacao: p.situacao,
            texto: "A IA não devolveu uma redação que o app pudesse conferir.",
            uso: turno.uso,
          },
        );
        return yield* falha(
          registro.arquivo,
          "A IA não devolveu uma redação que o app pudesse conferir. Tente de novo.",
        );
      }
      const n = sugestao.naoConferidos.length;
      yield* listas.mudar(
        id,
        chave,
        { situacao: p.situacao, resolvidaPor: p.resolvidaPor, sugestao },
        {
          acao: "sugerir",
          situacao: p.situacao,
          texto: `Redação sugerida pela IA, para você revisar${n ? `; ${n} ${n === 1 ? "fato não conferido" : "fatos não conferidos"} pelo app` : ""}.`,
          uso: turno.uso,
        },
      );
      return yield* lista(id);
    },
    (e) => comIa("", e),
  );

  /* ------------------------------------------------------------ reanalisar */

  const reanalisar = Effect.fn("ListaViva.reanalisar")(
    function* (id: string, chave: string, arquivo: string, pedido?: Provider) {
      const registro = yield* buscar(id);
      const p = yield* pendenciaDe(registro, chave);
      const novo = yield* analise.revisarArquivo({
        arquivo,
        gravar: false,
        ...(registro.cnct === null ? {} : { cnct: registro.cnct }),
        ...(registro.forma === null ? {} : { forma: registro.forma }),
      });
      if (novo.sha256 === registro.sha256)
        return yield* falha(
          arquivo,
          "É o mesmo arquivo analisado. Salve as mudanças no Word e escolha o arquivo atualizado.",
        );
      const ficha = p.pendencia.ficha;
      const nome = arquivo.split(/[\\/]/).at(-1) ?? arquivo;
      let resolvida: boolean;
      let texto: string;
      let uso = null;
      if (p.pendencia.origem === "codigo") {
        // A ficha D (ou a triagem) inteira: a pendência só sai se a ficha não apontar mais nada no arquivo novo.
        const ainda = novo.revisao.pendencias.filter((x) => x.ficha === ficha && x.origem === "codigo");
        resolvida = ainda.length === 0;
        texto = resolvida
          ? `Conferida na reanálise de ${nome}: o critério não aponta mais nada.`
          : `A reanálise de ${nome} ainda aponta: ${ponto(ainda[0]!.mensagem.split("\n")[0]!)}`;
      } else {
        const { provider, modelo } = provedor(registro, pedido);
        const ctx = yield* contextoPara(registro, ficha, novo.revisao.markdown, novo.revisao.linhasTextoParaIa);
        const bloco = {
          id: `reanalise-${ficha.toLowerCase()}`,
          tipo: "S" as const,
          tema: p.pendencia.tema,
          ordemTema: p.pendencia.ordemTema,
          fichas: [ficha],
        };
        const pedidoTexto = pedidoS(
          bloco,
          [ctx.ficha],
          new Map([[ficha, ctx.proprio]]),
          ctx.contexto,
          registro.nonce,
          ctx.comum,
        );
        const julgado = yield* julgarBloco({
          provider,
          modelo,
          nonce: registro.nonce,
          bloco,
          fichas: [ctx.ficha],
          pedido: pedidoTexto,
          fontes: new Set(ctx.fontes),
          tempoTurno: tempoAcao,
          revisaoHumana: teveTextoParaIa(retirarTextoParaIa(novo.revisao.markdown, novo.revisao.linhasTextoParaIa)),
          registrarTentativa: (t) => listas.gravarAcao(id, chave, { acao: "reanalisar", ...t }),
        }).pipe(Effect.provideContext(contextoMotor));
        const r: ResultadoFichaIa = julgado.resultado.resultados[0]!;
        uso = julgado.uso;
        resolvida = r.estado !== "FALHOU" && estadoDaIa(r) === null;
        texto = resolvida
          ? `Conferida na reanálise de ${nome}: a IA avaliou o critério de novo e o app conferiu o trecho.`
          : r.estado === "FALHOU"
            ? `A reanálise de ${nome} não pôde ser conferida (${r.motivoFalha ?? "resposta fora do formato"}); a pendência continua.`
            : `A reanálise de ${nome} ainda aponta: ${ponto(r.justificativa)}`;
      }
      const situacao: SituacaoPendencia = resolvida ? "resolvida" : "aberta";
      yield* listas.mudar(
        id,
        chave,
        { situacao, resolvidaPor: "reanalise" },
        { acao: "reanalisar", situacao, texto, uso },
      );
      return yield* lista(id);
    },
    (e, _id, _chave, arquivo) => comIa(arquivo, e),
  );

  /* ------------------------------------------------------------ cópia com a situação */

  const gerarCopia = Effect.fn("ListaViva.gerarCopia")(function* (id: string) {
    const registro = yield* buscar(id);
    const pendencias = yield* listas.pendencias(id);
    const eventos = yield* listas.eventos(id);
    const situacoes: Record<string, MarcaPendencia> = {};
    for (const p of pendencias) {
      if (p.situacao === "aberta") continue;
      const ultimo = eventos.filter((e) => e.chave === p.chave).at(-1);
      const nota =
        p.situacao === "resolvida"
          ? p.resolvidaPor === "reanalise"
            ? "Conferida na reanálise do arquivo atualizado."
            : "Marcada pela coordenação, sem reanálise."
          : p.situacao === "contestada_mantida" && ultimo?.acao === "contestar"
            ? ultimo.texto.replace(/^Mantida: /, "Resposta da revisão: ")
            : undefined;
      situacoes[p.chave] = { situacao: p.situacao, ...(nota ? { nota } : {}) };
    }
    // A lista da revisão com IA: os resultados conferidos da IA entram de novo, como na conclusão.
    let ia: { resultados: ResultadoFichaIa[]; fora: string[] } | undefined;
    if (registro.revisao !== null) {
      const revisao = yield* revisoes.buscar(registro.revisao);
      const plano = revisao?.plano as PlanoRevisaoIa | null | undefined;
      const blocos = yield* revisoes.blocos(registro.revisao);
      ia = {
        resultados: blocos.flatMap((b) => (b.resultado as { resultados: ResultadoFichaIa[] }).resultados),
        fora: plano?.fora ?? [],
      };
    }
    const final = yield* analise.revisarArquivo({
      arquivo: registro.arquivo,
      gravar: true,
      sha256: registro.sha256,
      ...(registro.cnct === null ? {} : { cnct: registro.cnct }),
      ...(registro.forma === null ? {} : { forma: registro.forma }),
      ...(ia ? { ia } : {}),
      situacoes,
    });
    yield* listas.trocarResultado(id, { ...resultadoParaInterface(registro.arquivo, final), lista: id });
    return yield* lista(id);
  });

  const ultima = listas.ultima.pipe(
    Effect.flatMap((id) => (id === null ? Effect.succeed(null) : lista(id).pipe(Effect.orElseSucceed(() => null)))),
  );

  return ListaViva.of({
    analisar,
    lista,
    ultima,
    apagar: listas.apagar,
    marcar,
    verParada,
    estimar,
    contestar,
    sugerir,
    reanalisar,
    gerarCopia,
  });
});

/** Pede as `Listas`, as `Revisoes`, a `AnalisePpc`, o `Motor`, as `FontesNormativas` e o `SqlClient` do `kb.sqlite`. */
export const layer = (opcoes: { readonly tempoAcao?: Duration.Duration } = {}) => Layer.effect(ListaViva, make(opcoes));
