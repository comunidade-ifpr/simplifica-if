/**
 * O que volta ao reabrir o app (`docs/plans/multitarefa.md`, "Continuidade"), conferido contra o que ainda
 * existe. Só voltam o Início, o Explorar, a conversa (`/conversa?id`) que ainda existe e a rota de um
 * módulo que ele diz que ainda existe (a revisão de PPC, `/revisao-ppc?id`); o resto vai ao Início. O
 * `compacto=1` nunca volta (a janela abre inteira), nem o formulário de uma tarefa (`/tarefa/$nome`).
 *
 * O documento do Explorar (`/explorar/ver?link=…`) volta se o link fica, como os do painel.
 *
 * O núcleo não conhece as rotas, os links (`ifpr://revisao/…`) nem as origens de conversa (`revisao:<lista>`)
 * de um módulo: cada módulo responde pelos seus (`ConferenciaModulo`), e o que é dele e deixou de existir
 * sai com o aviso dele ("Esta revisão foi apagada"). Funções puras.
 */
import { type Continuidade, MAXIMO_TEXTO_CONTINUIDADE, type PainelGuardado } from "@simplifica-if/contratos-app";
import { defaultParseSearch, defaultStringifySearch } from "@tanstack/react-router";

/** O que um módulo diz do que é dele; `undefined` quando a rota, o link ou a origem não é dele. */
export interface ConferenciaModulo {
  readonly rota: (pathname: string, busca: Readonly<Record<string, unknown>>) => boolean | undefined;
  readonly link: (link: string) => boolean | undefined;
  readonly origem: (chave: string) => boolean | undefined;
  /** O aviso quando algo do módulo não voltou por ter deixado de existir. */
  readonly aviso: string;
}

/** Um módulo, antes de reabrir: pergunta ao servidor o que existe dele e devolve a conferência. */
export type ModuloContinuidade = () => Promise<ConferenciaModulo>;

/** O que existe agora: as conversas e a conferência de cada módulo. */
export interface Existentes {
  readonly conversas: ReadonlySet<string>;
  readonly modulos: ReadonlyArray<ConferenciaModulo>;
}

/** A rota como se guarda: sem o `compacto=1` (a janela reaberta não está no modo compacto). */
export function rotaParaGuardar(pathname: string, busca: Readonly<Record<string, unknown>>): string {
  const { compacto: _compacto, ...resto } = busca;
  return `${pathname}${defaultStringifySearch(resto)}`;
}

/** A rota guardada separada no caminho e na busca, como o roteador a lê. */
function separar(rota: string): { readonly pathname: string; readonly busca: Record<string, unknown> } {
  const i = rota.indexOf("?");
  const semHash = (texto: string) => texto.split("#")[0]!;
  return i < 0
    ? { pathname: semHash(rota), busca: {} }
    : { pathname: rota.slice(0, i), busca: defaultParseSearch(semHash(rota.slice(i))) };
}

/** A primeira resposta de um módulo que conhece o item; `undefined` se nenhum o conhece. */
function doModulo(
  modulos: ReadonlyArray<ConferenciaModulo>,
  perguntar: (modulo: ConferenciaModulo) => boolean | undefined,
): { readonly existe: boolean; readonly modulo: ConferenciaModulo } | undefined {
  for (const modulo of modulos) {
    const existe = perguntar(modulo);
    if (existe !== undefined) return { existe, modulo };
  }
  return undefined;
}

/** O resultado da conferência: para onde voltar, o painel sem o que sumiu e os avisos do que sumiu. */
export interface Conferida {
  readonly rota: string;
  readonly painel: PainelGuardado;
  readonly avisos: ReadonlyArray<string>;
}

export function conferirContinuidade(guardada: Continuidade, existentes: Existentes): Conferida {
  const avisos = new Set<string>();
  const sumiu = (modulo: ConferenciaModulo) => avisos.add(modulo.aviso);
  // Os links da base continuam (o leitor diz se um sumiu na atualização); os de um módulo, só se existem.
  const fica = (link: string) => {
    const doMod = doModulo(existentes.modulos, (modulo) => modulo.link(link));
    if (doMod !== undefined && !doMod.existe) sumiu(doMod.modulo);
    return doMod === undefined || doMod.existe;
  };

  const { pathname, busca } = separar(guardada.rota);
  const { compacto: _compacto, ...semCompacto } = busca;
  let volta: boolean;
  // O documento aberto em tela cheia pode ser de um módulo (o PPC da revisão, `ifpr://revisao/…`).
  if (pathname === "/explorar/ver" && typeof semCompacto.link === "string") volta = fica(semCompacto.link);
  else if (pathname === "/" || pathname === "/explorar" || pathname.startsWith("/explorar/")) volta = true;
  else if (pathname === "/conversa") volta = typeof busca.id === "string" && existentes.conversas.has(busca.id);
  else {
    const doMod = doModulo(existentes.modulos, (modulo) => modulo.rota(pathname, semCompacto));
    if (doMod !== undefined && !doMod.existe) sumiu(doMod.modulo);
    volta = doMod?.existe === true;
  }
  const rota = volta ? rotaParaGuardar(pathname, semCompacto) : "/";

  const { links, posicao } = guardada.painel.trilha;
  const trilha: Array<string> = [];
  let novaPosicao = -1;
  links.forEach((link, i) => {
    if (fica(link) && trilha.at(-1) !== link) trilha.push(link);
    if (i === posicao) novaPosicao = trilha.length - 1;
  });
  const marcados = guardada.painel.marcados.filter(fica);

  let conversa = guardada.painel.conversa;
  if (conversa !== undefined && !existentes.conversas.has(conversa.id)) conversa = undefined;
  const origem = conversa?.origem;
  if (conversa !== undefined && origem !== undefined) {
    const doMod = doModulo(existentes.modulos, (modulo) => modulo.origem(origem.chave));
    if (doMod !== undefined && !doMod.existe) sumiu(doMod.modulo);
    // A origem que ninguém conhece ou que sumiu sai: a conversa segue como livre.
    if (doMod?.existe !== true) conversa = { id: conversa.id };
  }

  const lendoSumiu = posicao >= 0 && links[posicao] !== undefined && !fica(links[posicao]);
  const painel: PainelGuardado = {
    aberto: guardada.painel.aberto && !(guardada.painel.aba === "ler" && (lendoSumiu || trilha.length === 0)),
    aba: guardada.painel.aba,
    trilha: { links: trilha, posicao: trilha.length === 0 ? -1 : Math.max(0, novaPosicao) },
    marcados,
    preso: guardada.painel.preso,
    ...(conversa === undefined ? {} : { conversa }),
  };
  return { rota, painel, avisos: [...avisos] };
}

/**
 * O que se grava, dentro do limite das preferências (`MAXIMO_TEXTO_CONTINUIDADE`): a rota longa demais (um
 * filtro do Explorar com muito texto) grava o Início, e o link longo demais sai da trilha e dos marcados.
 * O resto grava do mesmo jeito.
 */
export function continuidadeQueCabe(continuidade: Continuidade): Continuidade {
  const cabe = (texto: string) => texto.length <= MAXIMO_TEXTO_CONTINUIDADE;
  const { links, posicao } = continuidade.painel.trilha;
  if (cabe(continuidade.rota) && links.every(cabe) && continuidade.painel.marcados.every(cabe)) return continuidade;
  const trilha: Array<string> = [];
  let novaPosicao = -1;
  links.forEach((link, i) => {
    if (cabe(link)) trilha.push(link);
    if (i === posicao) novaPosicao = trilha.length - 1;
  });
  return {
    rota: cabe(continuidade.rota) ? continuidade.rota : "/",
    painel: {
      ...continuidade.painel,
      trilha: { links: trilha, posicao: trilha.length === 0 ? -1 : Math.max(0, novaPosicao) },
      marcados: continuidade.painel.marcados.filter(cabe),
    },
  };
}
