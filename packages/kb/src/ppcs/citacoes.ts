// @effect-diagnostics nodeBuiltinImport:off -- carregador síncrono do índice e do texto dos PPCs, usado pelos scripts e pela compilação do banco
/**
 * Citações normativas extraídas dos PPCs convertidos (`base-conhecimento/institucional/ifpr/ppcs/`),
 * pelo resolvedor de `normas/resolver.ts`. Tudo é derivado dos arquivos do checkout, sem relógio e
 * com ordem estável (PPC por id, citação por posição).
 */
import * as Schema from "effect/Schema";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { idDoAto } from "../normas/ids.ts";
import { raizRepositorio, type Registro } from "../normas/registro.ts";
import { type Citacao, extrairCitacoes, registroPadrao } from "../normas/resolver.ts";
import { compararTexto } from "../texto.ts";
import { mascararFrontMatter } from "./front-matter.ts";
import { textoDaSecao } from "./secoes.ts";

const esquemaItemPpc = Schema.StructWithRest(
  Schema.Struct({
    id: Schema.String,
    campus_id: Schema.String,
    campus_nome: Schema.String,
    curso_slug: Schema.String,
    curso_nome: Schema.String,
    nivel: Schema.String,
    tipo_oferta: Schema.String,
    path: Schema.String,
    ano_documento: Schema.optionalKey(Schema.Int),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);
export type ItemPpc = typeof esquemaItemPpc.Type;
const decodificarIndicePpcs = Schema.decodeUnknownSync(Schema.Struct({ items: Schema.Array(esquemaItemPpc) }));

export function caminhoBase(raiz: string = raizRepositorio()): string {
  return NodePath.join(raiz, "base-conhecimento");
}

/**
 * Texto integral de uma seção do índice (`secoes/<tipo>.jsonl`): lê o PPC em `caminhoRelativo`
 * (o `path` da seção, relativo a `base-conhecimento/`) e devolve as linhas `linha_inicio`–`linha_fim`.
 * O git guarda só preview e linhas; o texto integral vem do próprio Markdown.
 */
export function lerTextoSecao(
  secao: { path: string; linha_inicio: number; linha_fim: number },
  opcoes: { incluirTitulo?: boolean; raiz?: string; cache?: Map<string, string> } = {},
): string {
  // `cache` (caminho → texto) evita reler o mesmo PPC a cada seção, como na compilação do kb.sqlite.
  let texto = opcoes.cache?.get(secao.path);
  if (texto === undefined) {
    texto = NodeFS.readFileSync(NodePath.join(caminhoBase(opcoes.raiz), secao.path), "utf-8").replace(/\r\n?/g, "\n");
    opcoes.cache?.set(secao.path, texto);
  }
  return textoDaSecao(texto, secao.linha_inicio, secao.linha_fim, { incluirTitulo: opcoes.incluirTitulo ?? false });
}

/** Itens de `ppcs/index.json`, ordenados por id. */
export function carregarIndicePpcs(raiz: string = raizRepositorio()): ItemPpc[] {
  const arquivo = NodePath.join(caminhoBase(raiz), "institucional", "ifpr", "ppcs", "index.json");
  const indice = decodificarIndicePpcs(JSON.parse(NodeFS.readFileSync(arquivo, "utf-8")));
  return [...indice.items].sort((a, b) => compararTexto(a.id, b.id));
}

/**
 * Citações de um PPC pelo caminho relativo a `base-conhecimento/` (como `ppc.markdown_path`). O front
 * matter de proveniência fica em branco: não gera citação, e as linhas continuam as do arquivo.
 */
export function citacoesDoArquivo(
  caminhoRelativo: string,
  registro: Registro = registroPadrao(),
  raiz: string = raizRepositorio(),
): Citacao[] {
  const bruto = NodeFS.readFileSync(NodePath.join(caminhoBase(raiz), caminhoRelativo), "utf-8").replace(/\r\n?/g, "\n");
  const texto = mascararFrontMatter(bruto);
  return extrairCitacoes(texto, registro);
}

export interface Ocorrencia {
  linha: number;
  trecho: string;
  regra: string;
  confianca: number;
  dispositivoId?: string;
  dispositivos?: string[];
}

export interface PpcCitante {
  ppc: string;
  campus: string;
  curso: string;
  nivel: string;
  tipo_oferta: string;
  path: string;
  ocorrencias: Ocorrencia[];
}

/**
 * Regras do resolvedor que completam ou corrigem citações incompletas dos PPCs: confiança menor, e a
 * citação deve ser conferida no trecho antes de se afirmar algo substantivo (AGENTS.md).
 */
export const REGRAS_BAIXA_CONFIANCA: ReadonlySet<string> = new Set([
  "dcnept-2021-orgao-trocado",
  "orgao-ausente-registro",
  "orgao-no-documento",
]);

/** Uma linha de trecho legível: espaços colapsados. */
export function trechoLimpo(trecho: string): string {
  return trecho
    .replace(/<br\s*\/?>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Ocorrência de uma citação gravada no `kb.sqlite` (`citacoes.dispositivos_json`): o resolvedor põe
 * em `dispositivoId` o primeiro dispositivo e em `dispositivos` a lista, só quando há mais de um.
 */
export function ocorrenciaGravada(citacao: {
  linha: number;
  trecho: string;
  regra: string;
  confianca: number;
  dispositivos: readonly string[];
}): Ocorrencia {
  const lista = citacao.dispositivos;
  return {
    linha: citacao.linha,
    trecho: trechoLimpo(citacao.trecho),
    regra: citacao.regra,
    confianca: citacao.confianca,
    ...(lista.length ? { dispositivoId: lista[0]! } : {}),
    ...(lista.length > 1 ? { dispositivos: [...lista] } : {}),
  };
}

/** A lista de dispositivos de uma citação cobre o dispositivo pedido (sem `#`) ou um subordinado dele? */
export function cobreDispositivo(lista: readonly string[], dispositivo: string): boolean {
  const alvo = `#${dispositivo}`;
  return lista.some((d) => d === alvo || d.startsWith(`${alvo}-`));
}

/** Saída de `kb citacoes <id>`: a norma no registro e os PPCs que a citam. */
export interface RelatorioCitacoes {
  id: string;
  titulo: string | null;
  situacao: string;
  total_ppcs: number;
  total_ocorrencias: number;
  ppcs: PpcCitante[];
}

export function relatorioCitacoes(id: string, ppcs: PpcCitante[], registro: Registro): RelatorioCitacoes {
  const entrada = registro.obter(idDoAto(id.split("#")[0]!));
  return {
    id,
    titulo: entrada?.title ?? null,
    situacao: entrada?.situacao ?? "nao-registrada",
    total_ppcs: ppcs.length,
    total_ocorrencias: ppcs.reduce((total, ppc) => total + ppc.ocorrencias.length, 0),
    ppcs,
  };
}

function ocorrencia(citacao: Citacao): Ocorrencia {
  return {
    linha: citacao.linha,
    trecho: trechoLimpo(citacao.trecho),
    regra: citacao.regra,
    confianca: citacao.confianca,
    ...(citacao.dispositivoId ? { dispositivoId: citacao.dispositivoId } : {}),
    ...(citacao.dispositivos ? { dispositivos: citacao.dispositivos } : {}),
  };
}

/**
 * PPCs que citam a norma `id` (o ato: variantes e dispositivos do argumento são ignorados na
 * comparação; com `dispositivo`, só as citações daquele dispositivo ou de seus filhos).
 */
export function ppcsQueCitam(
  idConsultado: string,
  opcoes: { registro?: Registro; raiz?: string; confiancaMinima?: number } = {},
): PpcCitante[] {
  const registro = opcoes.registro ?? registroPadrao();
  const raiz = opcoes.raiz ?? raizRepositorio();
  const [idNorma, dispositivo] = idConsultado.split("#") as [string, string | undefined];
  const ato = idDoAto(idNorma);
  const minimo = opcoes.confiancaMinima ?? 0;
  const saida: PpcCitante[] = [];
  for (const ppc of carregarIndicePpcs(raiz)) {
    const ocorrencias = citacoesDoArquivo(ppc.path, registro, raiz)
      .filter((citacao) => citacao.id !== null && idDoAto(citacao.id) === ato && citacao.confianca >= minimo)
      .filter((citacao) => {
        if (!dispositivo) return true;
        return cobreDispositivo(
          citacao.dispositivos ?? (citacao.dispositivoId ? [citacao.dispositivoId] : []),
          dispositivo,
        );
      })
      .map(ocorrencia);
    if (ocorrencias.length === 0) continue;
    saida.push({
      ppc: ppc.id,
      campus: ppc.campus_nome,
      curso: ppc.curso_nome,
      nivel: ppc.nivel,
      tipo_oferta: ppc.tipo_oferta,
      path: ppc.path,
      ocorrencias,
    });
  }
  return saida;
}

/** Uma norma citada por um PPC: o ato, quantas citações, as linhas e as regras do resolvedor. */
export interface NormaCitadaNoPpc {
  /** ID do ato (sem variante nem dispositivo). */
  id: string;
  /** Citações do ato no PPC, as mesmas que `ppcsQueCitam(id)` conta para este PPC. */
  ocorrencias: number;
  linhas: number[];
  regras: string[];
}

/**
 * Normas citadas por um PPC, a partir das citações resolvidas na ordem do documento (as de
 * `citacoesDoArquivo` ou da tabela `citacoes`): uma entrada por ato, da mais citada para a menos
 * citada e, no empate, pelo ID. Citações não resolvidas ficam fora.
 */
export function normasCitadasNoPpc(
  citacoes: readonly { id: string | null; linha: number; regra: string }[],
): NormaCitadaNoPpc[] {
  const porAto = new Map<string, { ocorrencias: number; linhas: Set<number>; regras: Set<string> }>();
  for (const citacao of citacoes) {
    if (citacao.id === null) continue;
    const ato = idDoAto(citacao.id);
    const atual = porAto.get(ato) ?? { ocorrencias: 0, linhas: new Set<number>(), regras: new Set<string>() };
    atual.ocorrencias += 1;
    atual.linhas.add(citacao.linha);
    atual.regras.add(citacao.regra);
    porAto.set(ato, atual);
  }
  return [...porAto]
    .map(([id, n]) => ({
      id,
      ocorrencias: n.ocorrencias,
      linhas: [...n.linhas].sort((a, b) => a - b),
      regras: [...n.regras].sort(compararTexto),
    }))
    .sort((a, b) => b.ocorrencias - a.ocorrencias || compararTexto(a.id, b.id));
}

/** Normas citadas pelo PPC em `caminhoRelativo` (relativo a `base-conhecimento/`), pelos arquivos. */
export function normasCitadasDoArquivo(
  caminhoRelativo: string,
  registro: Registro = registroPadrao(),
  raiz: string = raizRepositorio(),
): NormaCitadaNoPpc[] {
  return normasCitadasNoPpc(citacoesDoArquivo(caminhoRelativo, registro, raiz));
}
