// @effect-diagnostics nodeBuiltinImport:off -- junção de caminhos, pura, para os carregadores síncronos e os serviços
/**
 * Onde ficam, no checkout, os arquivos que o kb lê: os caminhos relativos à raiz do repositório,
 * com `/`, num lugar só. Os carregadores, a compilação, a impressão digital das fontes e o
 * `FontesNormativas` partem daqui.
 *
 * A raiz nunca é descoberta aqui dentro: quem chama a passa. Só os pontos de entrada (a CLI `kb`,
 * os scripts) e os testes chamam `raizRepositorio()`.
 */
import * as NodePath from "node:path";

const BASE = "base-conhecimento";
const INSTITUCIONAL = `${BASE}/institucional/ifpr`;
const REVISAO_PPC = `${BASE}/revisao-ppc`;
const DADOS_KB = "packages/kb/dados";

export const CAMINHOS = {
  /** A base publicada; os `path` das normas e dos índices são relativos a ela. */
  base: BASE,
  normas: `${BASE}/normas`,
  stubs: `${BASE}/normas/stubs.yaml`,
  relacoes: `${BASE}/relacoes.yaml`,
  transicoes: `${BASE}/transicoes.yaml`,
  /** Revisão humana dos fatos de PPC (`fatos/revisoes.ts`). */
  fatosPpc: `${BASE}/fatos-ppc.yaml`,
  configVigencia: `${BASE}/config/vigencia.yaml`,
  correspondencias: `${BASE}/correspondencias`,
  cnct: `${BASE}/catalogos/cnct`,
  indiceCnct: `${BASE}/catalogos/cnct/index.json`,
  /** Os registros institucionais, uma pasta por coleção. */
  institucional: INSTITUCIONAL,
  ppcs: `${INSTITUCIONAL}/ppcs`,
  indicePpcs: `${INSTITUCIONAL}/ppcs/index.json`,
  /** A base da revisão de PPC: as fichas (os critérios), a taxonomia dos tópicos e os marcos normativos. */
  revisaoPpc: REVISAO_PPC,
  fichas: `${REVISAO_PPC}/fichas`,
  topicosFichas: `${REVISAO_PPC}/topicos-fichas.json`,
  marcos: `${REVISAO_PPC}/marcos-normativos.json`,
  skills: ".agents/skills",
  dadosKb: DADOS_KB,
  sinonimos: `${DADOS_KB}/sinonimos.yaml`,
  topicosSecoes: `${DADOS_KB}/topicos-secoes.yaml`,
  /** O código do núcleo que entra na impressão digital do banco. */
  codigoKb: "packages/kb/src",
  anotacoesResolvedor: "avaliacao/resolvedor/citacoes-anotadas.yaml",
  consultasBusca: "avaliacao/busca-secoes/consultas.yaml",
  /** O banco da CLI, quando `KB_SQLITE` não diz outro. */
  banco: "tmp/kb.sqlite",
} as const;

/** Caminho absoluto de um arquivo do checkout em `raiz` (`relativo` com `/`, como em `CAMINHOS`). */
export function noCheckout(raiz: string, relativo: string): string {
  return NodePath.join(raiz, ...relativo.split("/"));
}

/**
 * Chave dos caches dos carregadores síncronos: a raiz resolvida, para que `.` e o caminho absoluto
 * do mesmo checkout caiam na mesma entrada.
 */
export function chaveDoCheckout(raiz: string): string {
  return NodePath.resolve(raiz);
}

/**
 * Raiz do checkout, a partir deste arquivo (`packages/kb/src/`). Só para os pontos de entrada e os
 * testes; o resto do kb recebe a raiz de quem chama.
 */
export function raizRepositorio(): string {
  return NodePath.resolve(import.meta.dirname, "..", "..", "..");
}
