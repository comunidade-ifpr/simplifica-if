/**
 * Revisão com IA (M1.11, etapa 4): a conferência em código de toda resposta da IA.
 *
 * Nenhuma resposta entra no resultado sem passar por aqui:
 * - o tamanho da resposta inteira, antes do `JSON.parse`, e de cada campo (`LIMITES_RESPOSTA`);
 * - o JSON pelo contrato (Effect Schema `ResultadoIa`), com os estados da ficha (`estados_permitidos`);
 * - um resultado para cada ficha do bloco, nenhum de fora;
 * - cada `trecho` citado existe literalmente no conteúdo do PPC **entregue àquela ficha** (ignorando
 *   espaços e marcação; com reticências, cada pedaço tem ao menos 15 caracteres, e o trecho, 25);
 * - cada fonte é o ID exato de uma norma ou de um dispositivo entregue ao bloco (`fontesPermitidas`),
 *   ou `cnct` quando o CNCT foi entregue;
 * - ATENDE e NAO_ATENDE com ao menos uma evidência conferida; o tema J com o `resumo`;
 * - no critério `ausencia` (etapa 5), NAO_ATENDE com o `tipo_achado`, e a ausência numa seção presente
 *   com a falta em `lacunas`: o trecho conferido no conteúdo da ficha é a prova de que a seção foi lida.
 *
 * A conferência é por ficha: uma ficha com problema não derruba as boas do mesmo bloco. O servidor
 * pede uma nova tentativa com os problemas; se falhar de novo, a ficha sai "a conferir", com o motivo,
 * nunca com um fato que a conferência recusou.
 *
 * Os problemas voltam à IA na nova tentativa, **fora das marcas do PPC**: nunca repetem nada que a IA
 * escreveu (um ID de ficha inventado, um trecho recusado, a mensagem do `JSON.parse` podem trazer a
 * instrução escondida). Só IDs das fichas do bloco, IDs canônicos de dispositivo de uma norma entregue
 * e frases fixas.
 */
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { CRITERIO_PADRAO, type CriterioInconclusivo, TIPOS_ACHADO } from "./pedido.ts";
import { dobrar, type Bloco, type FichaIa } from "./plano.ts";
import { ate, EstadoIa, extrairJson, Texto } from "./resposta.ts";

/** Os tetos da resposta: o texto livre não é conferido contra o PPC, então ele fica curto. */
export const LIMITES_RESPOSTA = {
  resposta: 80_000,
  justificativa: 600,
  lacunas: 5,
  lacuna: 200,
  evidencias: 5,
  trecho: 400,
  oQueFazer: 300,
  fontes: 10,
  resumo: 800,
} as const;

const L = LIMITES_RESPOSTA;

/** Um resultado de ficha, no contrato da `revisar-ppc` reduzido ao que o app usa. */
export const ResultadoIa = Schema.Struct({
  ficha_id: Texto,
  estado: EstadoIa,
  confianca: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  justificativa: ate(L.justificativa).check(Schema.isMinLength(1)),
  evidencias: Schema.Array(Schema.Struct({ trecho: ate(L.trecho) })).check(Schema.isMaxLength(L.evidencias)),
  lacunas: Schema.Array(ate(L.lacuna)).check(Schema.isMaxLength(L.lacunas)),
  o_que_fazer: Schema.optionalKey(ate(L.oQueFazer)),
  fontes: Schema.optionalKey(Schema.Array(ate(120)).check(Schema.isMaxLength(L.fontes))),
  /**
   * Fora do contrato desde a revisão da etapa 5: quem decide a revisão humana é o código (a triagem do
   * texto dirigido a IA). Aceito e descartado, para reconferir as respostas gravadas antes.
   */
  revisao_humana_obrigatoria: Schema.optionalKey(Schema.Boolean),
  /** Só no critério `ausencia`: o tipo do NAO_ATENDE. */
  tipo_achado: Schema.optionalKey(Schema.Literals(TIPOS_ACHADO)),
});
export type ResultadoIa = Omit<typeof ResultadoIa.Type, "revisao_humana_obrigatoria">;

const Casca = Schema.Struct({
  bloco: Schema.optionalKey(Texto),
  resultados: Schema.Array(Schema.Unknown),
  resumo: Schema.optionalKey(ate(L.resumo)),
});

const decodificarCasca = Schema.decodeUnknownResult(Casca);
const decodificarResultado = Schema.decodeUnknownResult(ResultadoIa);

/** Normalização para a comparação literal: a de `dobrar`, mais aspas tipográficas. */
const normalizar = (s: string) => dobrar(s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'"));

/** O conteúdo entregue preparado para a conferência dos trechos (normalize uma vez por ficha). */
export const alvoDosTrechos = (conteudo: string) => normalizar(conteudo);

const PEDACO_MINIMO = 15;
const TRECHO_MINIMO = 25;

/**
 * O trecho existe no alvo. Com reticências, cada pedaço tem ao menos 15 caracteres e existe, na ordem
 * do texto; o trecho todo soma ao menos 25 (sem isso, "est ... 400" passaria em quase qualquer texto).
 */
const pedacosDoTrecho = (trecho: string) =>
  trecho
    .split(/\s*(?:\.\.\.|…|\[\.\.\.\]|\[…\])\s*/)
    .map(normalizar)
    .filter((p) => p.length > 0);

/** O trecho tem a forma que a conferência consegue conferir (pedaços de 15, ao menos 25 no todo). */
export function trechoConferivel(trecho: string): boolean {
  const pedacos = pedacosDoTrecho(trecho);
  return (
    pedacos.length > 0 &&
    pedacos.every((p) => p.length >= PEDACO_MINIMO) &&
    pedacos.reduce((t, p) => t + p.length, 0) >= TRECHO_MINIMO
  );
}

/** O maior pedaço contínuo do trecho (entre reticências), normalizado, ou 0 se o trecho não tem a forma. */
export const maiorPedaco = (trecho: string) =>
  trechoConferivel(trecho) ? Math.max(...pedacosDoTrecho(trecho).map((p) => p.length)) : 0;

export function trechoExiste(trecho: string, alvo: string): boolean {
  const pedacos = pedacosDoTrecho(trecho);
  if (!trechoConferivel(trecho)) return false;
  // Na ordem do texto: cada pedaço depois do anterior (reticências não reordenam o PPC).
  let desde = 0;
  for (const p of pedacos) {
    const onde = alvo.indexOf(p, desde);
    if (onde < 0) return false;
    desde = onde + p.length;
  }
  return true;
}

/** A fonte é o ID exato de algo entregue: o dispositivo (`ref#disp`), a norma sem `#`, ou `cnct`. */
export const fonteValida = (fonte: string, fontes: ReadonlySet<string>) => fontes.has(fonte);

export type Conferencia = {
  /** As fichas aprovadas na conferência, com o resultado. */
  validos: Map<string, ResultadoIa>;
  /** Os problemas de cada ficha recusada (ou `*` para a resposta inteira). Só texto do app. */
  problemas: Map<string, string[]>;
  resumo: string | null;
};

const adicionar = (mapa: Map<string, string[]>, chave: string, problema: string) =>
  mapa.set(chave, [...(mapa.get(chave) ?? []), problema]);

/** A forma dos IDs canônicos das normas (`br/lei/1996/9394`, `ifpr/consup/res/2024/190#art5-par1`). */
const ID_CANONICO = /^(br|ifpr)(\/[a-z0-9-]{1,20}){2,5}(#[a-z0-9-]{1,40})?$/;

/**
 * A fonte recusada, como volta à IA: só um ID na forma canônica cuja norma (sem o `#`) foi entregue
 * ao bloco (o dispositivo é que não foi); qualquer outra coisa pode ser texto da IA e vira frase fixa.
 */
const fonteParaCorrecao = (fonte: string, fontes: ReadonlySet<string>) =>
  ID_CANONICO.test(fonte) && fontes.has(fonte.split("#")[0]!)
    ? `fonte fora do contexto entregue: ${fonte} (cite a norma sem o # ou um dispositivo da lista)`
    : "fonte fora do contexto entregue: use só os IDs listados no contexto";

/** Confere a resposta de um bloco. Nunca lança: o que falha vira problema. */
export function conferirResposta(
  texto: string,
  bloco: Bloco,
  fichas: readonly FichaIa[],
  entrada: {
    alvoDaFicha: (ficha: string) => string;
    fontes: ReadonlySet<string>;
    criterio?: CriterioInconclusivo | undefined;
    /**
     * A seção do critério já normalizada (`alvoDosTrechos(secaoDaFicha(…))`), ou `null` sem seção: a
     * prova de leitura da ausência. Sem a função, a ausência só confere o trecho no conteúdo da ficha.
     */
    secaoDaFicha?: (ficha: string) => string | null;
  },
): Conferencia {
  const criterio = entrada.criterio ?? CRITERIO_PADRAO;
  const validos = new Map<string, ResultadoIa>();
  const problemas = new Map<string, string[]>();
  const bruto = extrairJson(texto, L.resposta);
  if (Result.isFailure(bruto)) {
    adicionar(problemas, "*", "a resposta não é um objeto JSON válido (ou passa do tamanho máximo)");
    return { validos, problemas, resumo: null };
  }
  const casca = decodificarCasca(bruto.success);
  if (Result.isFailure(casca)) {
    adicionar(problemas, "*", "a resposta não segue o contrato (`resultados` em lista; `resumo` até 800 caracteres)");
    return { validos, problemas, resumo: null };
  }
  const resumo = casca.success.resumo?.trim() || null;
  if (bloco.tipo === "J" && !resumo) adicionar(problemas, "*", "falta o `resumo` do tema");
  const porId = new Map(fichas.map((f) => [f.id, f]));
  for (const item of casca.success.resultados) {
    const id = (item as { ficha_id?: unknown } | null)?.ficha_id;
    const ficha = typeof id === "string" ? porId.get(id) : undefined;
    if (!ficha) {
      // O ID que a IA escreveu não volta: pode ser a instrução escondida.
      adicionar(problemas, "*", "há um resultado com `ficha_id` que não é de nenhum critério deste bloco");
      continue;
    }
    const fichaId = ficha.id;
    if (validos.has(fichaId) || problemas.has(fichaId)) {
      adicionar(problemas, fichaId, "resultado repetido");
      validos.delete(fichaId);
      continue;
    }
    const decodificado = decodificarResultado(item);
    if (Result.isFailure(decodificado)) {
      adicionar(
        problemas,
        fichaId,
        "fora do contrato: confira os campos, os estados e os limites (justificativa até 600 caracteres, até 5 lacunas de 200 e 5 evidências)",
      );
      continue;
    }
    // No critério conservador, o `tipo_achado` não foi pedido: não entra no resultado (o rebaixamento
    // por confiança continua valendo como na etapa 4).
    // O `tipo_achado` só vale no critério `ausencia` e num NAO_ATENDE; a revisão humana não vem da IA.
    const { tipo_achado: tipoAchado, revisao_humana_obrigatoria: _ignorada, ...semTipo } = decodificado.success;
    const r: ResultadoIa =
      criterio === "ausencia" && tipoAchado && semTipo.estado === "NAO_ATENDE"
        ? { ...semTipo, tipo_achado: tipoAchado }
        : semTipo;
    const erros: string[] = [];
    if (!ficha.estados_permitidos.includes(r.estado)) erros.push(`estado ${r.estado} não é permitido para a ficha`);
    const alvo = entrada.alvoDaFicha(fichaId);
    let conferidas = 0;
    const conferidosNoAlvo: string[] = [];
    r.evidencias.forEach((e, i) => {
      if (!e.trecho.trim()) return;
      if (trechoExiste(e.trecho, alvo)) {
        conferidas += 1;
        conferidosNoAlvo.push(e.trecho);
      } else
        erros.push(
          `trecho que não está no conteúdo entregue a este critério (evidência ${i + 1}): copie literalmente, ao menos 25 caracteres, ou retire`,
        );
    });
    for (const fonte of r.fontes ?? [])
      if (!fonteValida(fonte, entrada.fontes)) erros.push(fonteParaCorrecao(fonte, entrada.fontes));
    if (r.estado === "ATENDE" && conferidas === 0) erros.push("ATENDE sem trecho do PPC");
    if (r.estado === "NAO_ATENDE" && conferidas === 0)
      erros.push("NAO_ATENDE sem trecho do PPC: cite o trecho da seção lida que mostra o problema ou a falta");
    if (criterio === "ausencia" && r.estado === "NAO_ATENDE") {
      if (!r.tipo_achado)
        erros.push("NAO_ATENDE sem `tipo_achado`: use ausencia_em_secao_presente, contradicao ou merito");
      else if (r.tipo_achado === "ausencia_em_secao_presente") {
        if (!r.lacunas.some((l) => l.trim()))
          erros.push("NAO_ATENDE por ausência sem `lacunas`: diga o que falta na seção lida");
        // A prova de leitura é da seção do critério, não do comum do bloco (quadro, matriz) nem de um
        // aviso de seção não achada: sem a seção no recorte, a ausência não se prova.
        const secao = entrada.secaoDaFicha?.(fichaId);
        if (secao === null)
          erros.push(
            "NAO_ATENDE por ausência sem a seção no recorte: o código não achou a seção deste critério; use INCONCLUSIVO",
          );
        else if (
          secao !== undefined &&
          conferidosNoAlvo.length &&
          !conferidosNoAlvo.some((t) => trechoExiste(t, secao))
        )
          erros.push(
            "NAO_ATENDE por ausência com trecho fora da seção do critério: cite a seção lida (o recorte deste critério ou as seções do tema), não o quadro de identificação nem a matriz",
          );
      }
    }
    if (erros.length) problemas.set(fichaId, erros);
    else validos.set(fichaId, r);
  }
  for (const f of fichas)
    if (!validos.has(f.id) && !problemas.has(f.id)) adicionar(problemas, f.id, "sem resultado na resposta");
  return { validos, problemas, resumo };
}

/** Os problemas de uma resposta, para o fim do pedido da nova tentativa (numa sessão nova). */
export function pedidoDeCorrecao(conferencia: Conferencia): string {
  const linhas = [...conferencia.problemas].map(
    ([ficha, erros]) => `- ${ficha === "*" ? "resposta" : ficha}: ${erros.join("; ")}`,
  );
  return [
    "Uma resposta anterior a este mesmo pedido não passou na conferência automática:",
    ...linhas,
    "Responda de novo só com o JSON completo e corrigido (todos os critérios do bloco). Trechos têm de ser cópia literal do conteúdo entregue a cada critério; fontes, só os IDs do contexto.",
  ].join("\n");
}

/** O motivo, para a pessoa, de uma ficha que ficou "a conferir" por falhar na conferência. */
export function motivoLegivel(erros: readonly string[]): string {
  if (erros.some((e) => e.startsWith("trecho"))) return "a IA citou um trecho que não está no documento";
  if (erros.some((e) => e.startsWith("fonte"))) return "a IA citou uma norma que não estava entre as consultadas";
  if (erros.some((e) => e.startsWith("ATENDE"))) return "a IA disse que atende sem mostrar o trecho";
  if (erros.some((e) => e.startsWith("NAO_ATENDE por ausência sem a seção") || e.includes("fora da seção do critério")))
    return "a IA apontou uma falta sem mostrar a seção do documento onde ela devia estar";
  if (erros.some((e) => e.startsWith("NAO_ATENDE sem `tipo_achado`") || e.startsWith("NAO_ATENDE por ausência")))
    return "a IA apontou um problema sem dizer o tipo ou o que falta";
  if (erros.some((e) => e.startsWith("NAO_ATENDE"))) return "a IA apontou um problema sem mostrar o trecho";
  return "a resposta da IA veio fora do formato esperado";
}
