// @effect-diagnostics nodeBuiltinImport:off -- operações síncronas sobre os Markdown dos PPCs e os registros dos cursos (node:fs), como o resto do pipeline da base; as cascas Effect ficam nos scripts
/**
 * Versões dos PPCs e pendências: o ano do documento (com a evidência) decide a versão do ID, e o PPC
 * sem ele fica fora da base, em `curadoria/pendencias/ppcs/<campus>/<curso>/<rotulo>.md`.
 *
 * - `definirAnoPpc`: grava ano, evidência e fonte num PPC da base; se o ano não é o da versão, o PPC
 *   muda para a versão certa (ID e arquivo).
 * - `moverParaPendencias`: tira um PPC da base para as pendências, com o motivo.
 * - `promoverPpc`: leva um PPC pendente, já com o ano e a evidência, para a base.
 *
 * Depois de cada operação, o registro do curso aponta a versão mais recente da base como vigente
 * (`ppc.markdown_path` e `ppc.url`); trocar de documento vigente reabre a curadoria das vagas. Os
 * índices não são regenerados aqui: quem chama roda o pipeline da base.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { caminhoTexto, problemas } from "@simplifica-if/kb/esquema/mensagens";
import {
  analisarPpc,
  analisarPpcPendente,
  conferirEvidenciaAno,
  FONTE_TEXTO,
  type PpcPendente,
  type ProvenienciaPpc,
  serializarFrontMatterPendente,
  serializarFrontMatterPpc,
} from "@simplifica-if/kb/ppcs/front-matter";
import {
  analisarReferenciaPpc,
  caminhoPpc,
  compararVersoesPpc,
  idPpc,
  PASTA_PPCS,
  RE_SLUG_PPC,
} from "@simplifica-if/kb/ppcs/ids";
import { esquemaCursoLocal, esquemaPpcCurso, textoRegistro, type CursoLocal } from "../dados/institucional.ts";
import { dataLocalIso } from "../datas.ts";
import { ESTRITO } from "../esquema.ts";
import type { CaminhosBase } from "./caminhos.ts";
import { comChave, type Gravacao, gravarJuntos } from "./gravacao.ts";

/** Pasta das pendências de PPC, relativa à raiz do repositório (fora de `base-conhecimento/`). */
export const PASTA_PENDENCIAS_PPCS = "curadoria/pendencias/ppcs";
export const STATUS_REABERTO = "Precisa de revisão";

export const MotivoVersaoPpc = Schema.Literals([
  "ppc-inexistente",
  "curso-inexistente",
  "registro-invalido",
  "ano-invalido",
  "evidencia-invalida",
  "pendencia-invalida",
  "caminho-invalido",
]);

/** Recusa de uma operação sobre versões de PPC; `detalhe` vai para quem chamou como está. */
export class ErroVersaoPpc extends Schema.TaggedError<ErroVersaoPpc>()("ErroVersaoPpc", {
  motivo: MotivoVersaoPpc,
  detalhe: Schema.String,
}) {
  override get message(): string {
    return this.detalhe;
  }
}
export const ehErroVersaoPpc = Schema.is(ErroVersaoPpc);

const recusa = (motivo: typeof MotivoVersaoPpc.Type, detalhe: string) => new ErroVersaoPpc({ motivo, detalhe });

/** Ano do documento, a evidência literal e a fonte dela (`texto` ou URL https). */
export type EvidenciaAno = { ano: number; evidencia: string; fonte: string };

/** Versão para um PPC do ano `ano`: o ano, ou `ano-2`, `ano-3`… se já há essa versão. */
export function proximaVersao(existentes: Iterable<string>, ano: number): string {
  const usadas = new Set(existentes);
  let versao = String(ano);
  for (let n = 2; usadas.has(versao); n += 1) versao = `${ano}-${n}`;
  return versao;
}

/** Caminho de um PPC pendente, relativo à raiz do repositório. */
export function caminhoPendente(campusId: string, cursoSlug: string, rotulo: string): string {
  return `${PASTA_PENDENCIAS_PPCS}/${campusId}/${cursoSlug}/${rotulo}.md`;
}

const RE_CAMINHO_PENDENTE = new RegExp(
  `^${PASTA_PENDENCIAS_PPCS}/(${RE_SLUG_PPC})/(${RE_SLUG_PPC})/(${RE_SLUG_PPC})\\.md$`,
);

/** Campus, curso e rótulo de um caminho de pendência; `null` se não for um. */
export function partesDoCaminhoPendente(
  caminho: string,
): { campusId: string; cursoSlug: string; rotulo: string } | null {
  const m = RE_CAMINHO_PENDENTE.exec(caminho);
  return m ? { campusId: m[1]!, cursoSlug: m[2]!, rotulo: m[3]! } : null;
}

/** Rótulo livre para uma pendência nova na pasta do curso: `preferido`, ou com sufixo. */
export function rotuloLivre(caminhos: CaminhosBase, campusId: string, cursoSlug: string, preferido: string): string {
  const pasta = NodePath.join(caminhos.raizProjeto, PASTA_PENDENCIAS_PPCS, campusId, cursoSlug);
  const usados = new Set(
    NodeFS.existsSync(pasta) ? NodeFS.readdirSync(pasta).map((nome) => nome.replace(/\.md$/, "")) : [],
  );
  let rotulo = preferido;
  for (let n = 2; usados.has(rotulo); n += 1) rotulo = `${preferido}-${n}`;
  return rotulo;
}

function versoesNaBase(caminhos: CaminhosBase, campusId: string, cursoSlug: string): string[] {
  const pasta = NodePath.join(caminhos.raiz, PASTA_PPCS, campusId, cursoSlug);
  if (!NodeFS.existsSync(pasta)) return [];
  return NodeFS.readdirSync(pasta)
    .filter((nome) => nome.endsWith(".md"))
    .map((nome) => nome.slice(0, -3));
}

const decodificarCurso = Schema.decodeUnknownResult(esquemaCursoLocal, ESTRITO);
const ORDEM_CURSO = Object.keys(esquemaCursoLocal.fields);
const ORDEM_PPC = Object.keys(esquemaPpcCurso.fields);

function lerRegistro(caminhos: CaminhosBase, campusId: string, cursoSlug: string) {
  const arquivo = NodePath.join(caminhos.institucional, "ifpr", "cursos", campusId, `${cursoSlug}.json`);
  if (!NodeFS.existsSync(arquivo)) {
    throw recusa("curso-inexistente", `Curso inexistente: ${campusId}/${cursoSlug} (registro não encontrado)`);
  }
  const resultado = decodificarCurso(JSON.parse(NodeFS.readFileSync(arquivo, "utf-8")));
  if (Result.isFailure(resultado)) {
    const linhas = problemas(resultado.failure.issue).map(
      (p) => `${caminhoTexto(p.caminho) || "(raiz)"}: ${p.mensagem}`,
    );
    throw recusa("registro-invalido", `registro de ${campusId}/${cursoSlug} fora do schema: ${linhas.join("; ")}`);
  }
  return { arquivo, registro: resultado.success };
}

function conferirEvidencia(evidencia: EvidenciaAno, corpo: string): void {
  if (!Number.isInteger(evidencia.ano) || evidencia.ano < 1900 || evidencia.ano > 2999) {
    throw recusa("ano-invalido", `o ano deve ter quatro dígitos: ${evidencia.ano}`);
  }
  const ano = String(evidencia.ano);
  if (!evidencia.evidencia.includes(ano)) {
    throw recusa("evidencia-invalida", `a evidência deve conter o ano ${ano}: "${evidencia.evidencia}"`);
  }
  if (evidencia.fonte !== FONTE_TEXTO && !/^https:\/\/\S+$/.test(evidencia.fonte)) {
    throw recusa("evidencia-invalida", `a fonte do ano deve ser "texto" ou URL https: ${evidencia.fonte}`);
  }
  const problema = conferirEvidenciaAno({ ano_evidencia: evidencia.evidencia, ano_fonte: evidencia.fonte }, corpo);
  if (problema) throw recusa("evidencia-invalida", problema);
}

/**
 * O registro do curso com o vigente na versão mais recente de `versoes` (o estado da pasta depois da
 * operação). `mesmoDocumento` diz se a troca de caminho é o mesmo PPC renomeado (não reabre as vagas).
 * Sem versão na base, o curso fica sem `markdown_path` e mantém `ppc.url`.
 */
function registroComVigente(
  registro: CursoLocal,
  campusId: string,
  cursoSlug: string,
  versoes: ReadonlyMap<string, string>,
  mesmoDocumento: (de: string, para: string) => boolean,
  hoje: string,
): CursoLocal {
  const atual = registro.ppc?.markdown_path;
  const ultima = [...versoes.keys()].sort(compararVersoesPpc).at(-1);
  const novo = ultima === undefined ? undefined : caminhoPpc(campusId, cursoSlug, ultima);
  if (novo === atual) return registro;
  let ppc: NonNullable<CursoLocal["ppc"]> = registro.ppc ?? {};
  if (novo === undefined) {
    const { markdown_path: _antes, ...resto } = ppc;
    ppc = resto;
  } else {
    ppc = comChave(ppc, "markdown_path", novo, ORDEM_PPC);
    ppc = comChave(ppc, "url", versoes.get(ultima!)!, ORDEM_PPC);
    const trocouDocumento = !(atual && mesmoDocumento(atual, novo));
    if (trocouDocumento && (ppc.vagas !== undefined || ppc.trecho_vagas !== undefined)) {
      ppc = comChave(ppc, "curadoria_vagas", STATUS_REABERTO, ORDEM_PPC);
      ppc = comChave(ppc, "data_curadoria_vagas", hoje, ORDEM_PPC);
    }
  }
  return comChave(registro, "ppc", ppc, ORDEM_CURSO);
}

/** `fonte_url` de cada versão da base do curso. */
function fontesDasVersoes(caminhos: CaminhosBase, campusId: string, cursoSlug: string): Map<string, string> {
  const fontes = new Map<string, string>();
  for (const versao of versoesNaBase(caminhos, campusId, cursoSlug)) {
    const relativo = caminhoPpc(campusId, cursoSlug, versao);
    const { proveniencia } = analisarPpc(
      NodeFS.readFileSync(NodePath.join(caminhos.raiz, relativo), "utf-8"),
      relativo,
    );
    fontes.set(versao, proveniencia.fonte_url);
  }
  return fontes;
}

/** Grava as trocas e, só depois de todas, apaga os arquivos que saíram (o original de um PPC movido). */
function aplicar(gravacoes: Gravacao[], remover: string[]): void {
  gravarJuntos(gravacoes);
  for (const caminho of remover) NodeFS.rmSync(caminho, { force: true });
  // Pastas de curso e de campus que ficaram vazias saem (até a pasta `ppcs`).
  for (const caminho of remover) {
    let pasta = NodePath.dirname(caminho);
    while (NodePath.basename(pasta) !== "ppcs" && NodeFS.existsSync(pasta) && NodeFS.readdirSync(pasta).length === 0) {
      NodeFS.rmdirSync(pasta);
      pasta = NodePath.dirname(pasta);
    }
  }
}

function lerPpcDaBase(caminhos: CaminhosBase, chave: string) {
  const ref = analisarReferenciaPpc(chave);
  if (!ref?.versao) throw recusa("ppc-inexistente", `PPC deve ser <campus>/<curso>/<versao>: ${chave}`);
  const relativo = caminhoPpc(ref.campusId, ref.cursoSlug, ref.versao);
  const arquivo = NodePath.join(caminhos.raiz, relativo);
  if (!NodeFS.existsSync(arquivo)) throw recusa("ppc-inexistente", `PPC inexistente na base: ${relativo}`);
  const texto = NodeFS.readFileSync(arquivo, "utf-8");
  const fim = texto.indexOf("\n---\n", 3);
  const { proveniencia: meta } = analisarPpc(texto, relativo);
  return { ...ref, versao: ref.versao, relativo, arquivo, meta, corpo: texto.slice(fim + 5) };
}

export type ResultadoAno = {
  /** Chave antes e depois (diferem quando o ano mudou a versão). */
  chaveAnterior: string;
  chave: string;
  /** Caminho do PPC vigente do curso depois da operação (relativo a `base-conhecimento/`). */
  vigente: string | null;
};

/**
 * Grava `ano_documento`, `ano_evidencia` e `ano_fonte` no PPC `chave` (`campus/curso/versao`). Se a
 * versão não começa pelo ano, o PPC passa à versão do ano (com sufixo, se ocupada): arquivo e ID
 * novos, e o registro do curso continua apontando a versão mais recente.
 */
export function definirAnoPpc(
  caminhos: CaminhosBase,
  chave: string,
  evidencia: EvidenciaAno,
  agora: Date,
): ResultadoAno {
  const ppc = lerPpcDaBase(caminhos, chave);
  conferirEvidencia(evidencia, ppc.corpo);
  const { arquivo: arquivoRegistro, registro } = lerRegistro(caminhos, ppc.campusId, ppc.cursoSlug);
  const ano = String(evidencia.ano);
  const outras = versoesNaBase(caminhos, ppc.campusId, ppc.cursoSlug).filter((v) => v !== ppc.versao);
  const versao = ppc.versao.startsWith(ano) ? ppc.versao : proximaVersao(outras, evidencia.ano);
  const relativo = caminhoPpc(ppc.campusId, ppc.cursoSlug, versao);
  const proveniencia: ProvenienciaPpc = {
    ...ppc.meta,
    id: idPpc(ppc.campusId, ppc.cursoSlug, versao),
    ano_documento: ano,
    ano_evidencia: evidencia.evidencia,
    ano_fonte: evidencia.fonte,
  };
  const fontes = fontesDasVersoes(caminhos, ppc.campusId, ppc.cursoSlug);
  fontes.delete(ppc.versao);
  fontes.set(versao, proveniencia.fonte_url);
  const novoRegistro = registroComVigente(
    registro,
    ppc.campusId,
    ppc.cursoSlug,
    fontes,
    (de, para) => de === ppc.relativo && para === relativo,
    dataLocalIso(agora),
  );
  const gravacoes: Gravacao[] = [
    { destino: NodePath.join(caminhos.raiz, relativo), texto: serializarFrontMatterPpc(proveniencia) + ppc.corpo },
  ];
  if (novoRegistro !== registro) gravacoes.push({ destino: arquivoRegistro, texto: textoRegistro(novoRegistro) });
  aplicar(gravacoes, versao === ppc.versao ? [] : [ppc.arquivo]);
  return {
    chaveAnterior: `${ppc.campusId}/${ppc.cursoSlug}/${ppc.versao}`,
    chave: `${ppc.campusId}/${ppc.cursoSlug}/${versao}`,
    vigente: novoRegistro.ppc?.markdown_path ?? null,
  };
}

/** A lista de pendências não pode vir vazia (o formato de cada uma o front matter confere). */
function conferirPendencias(pendencias: readonly string[]): void {
  if (!pendencias.length) throw recusa("pendencia-invalida", "informe ao menos uma pendência (<campo>: <motivo>)");
}

export type ResultadoPendencia = {
  /** Caminho do arquivo pendente, relativo à raiz do repositório. */
  arquivo: string;
  vigente: string | null;
};

/**
 * Tira o PPC `chave` da base para `curadoria/pendencias/ppcs/<campus>/<curso>/<versao>.md`, sem `id`
 * nem os campos do ano (a pendência `ano: <motivo>` os substitui). Se ele era o vigente, o curso passa
 * à versão anterior da base, ou fica sem `markdown_path`.
 */
export function moverParaPendencias(
  caminhos: CaminhosBase,
  chave: string,
  pendencias: readonly string[],
  agora: Date,
): ResultadoPendencia {
  conferirPendencias(pendencias);
  const ppc = lerPpcDaBase(caminhos, chave);
  const { arquivo: arquivoRegistro, registro } = lerRegistro(caminhos, ppc.campusId, ppc.cursoSlug);
  const { id: _id, ano_documento: _ano, ano_evidencia: _ev, ano_fonte: _af, ...resto } = ppc.meta;
  const pendente: PpcPendente = { ...resto, pendencias: [...pendencias] };
  let frontMatter: string;
  try {
    frontMatter = serializarFrontMatterPendente(pendente);
  } catch (erro) {
    throw recusa("pendencia-invalida", `${ppc.relativo}: ${(erro as Error).message}`);
  }
  const rotulo = rotuloLivre(caminhos, ppc.campusId, ppc.cursoSlug, ppc.versao);
  const destino = caminhoPendente(ppc.campusId, ppc.cursoSlug, rotulo);
  const fontes = fontesDasVersoes(caminhos, ppc.campusId, ppc.cursoSlug);
  fontes.delete(ppc.versao);
  const novoRegistro = registroComVigente(
    registro,
    ppc.campusId,
    ppc.cursoSlug,
    fontes,
    () => false,
    dataLocalIso(agora),
  );
  const gravacoes: Gravacao[] = [
    { destino: NodePath.join(caminhos.raizProjeto, destino), texto: frontMatter + ppc.corpo },
  ];
  if (novoRegistro !== registro) gravacoes.push({ destino: arquivoRegistro, texto: textoRegistro(novoRegistro) });
  aplicar(gravacoes, [ppc.arquivo]);
  return { arquivo: destino, vigente: novoRegistro.ppc?.markdown_path ?? null };
}

export type ResultadoPromocao = { chave: string; id: string; vigente: boolean };

/**
 * Leva o PPC pendente `arquivoPendente` (relativo à raiz do repositório, ou absoluto) para a base, com
 * o ano e a evidência: versão do ano (com sufixo, se ocupada), sem a lista de pendências. Se ele passa
 * a ser a versão mais recente, o curso o aponta como vigente.
 */
export function promoverPpc(
  caminhos: CaminhosBase,
  arquivoPendente: string,
  evidencia: EvidenciaAno,
  agora: Date,
): ResultadoPromocao {
  const absoluto = NodePath.resolve(caminhos.raizProjeto, arquivoPendente);
  const relativo = NodePath.relative(caminhos.raizProjeto, absoluto).split(NodePath.sep).join("/");
  const partes = partesDoCaminhoPendente(relativo);
  if (!partes) {
    throw recusa(
      "caminho-invalido",
      `PPC pendente deve estar em ${PASTA_PENDENCIAS_PPCS}/<campus>/<curso>/<rotulo>.md: ${relativo}`,
    );
  }
  if (!NodeFS.existsSync(absoluto)) throw recusa("ppc-inexistente", `PPC pendente não encontrado: ${relativo}`);
  const texto = NodeFS.readFileSync(absoluto, "utf-8");
  let pendente: PpcPendente;
  let corpo: string;
  try {
    ({ pendente, corpo } = analisarPpcPendente(texto, relativo));
  } catch (erro) {
    throw recusa("pendencia-invalida", (erro as Error).message);
  }
  conferirEvidencia(evidencia, corpo);
  const { campusId, cursoSlug } = partes;
  const { arquivo: arquivoRegistro, registro } = lerRegistro(caminhos, campusId, cursoSlug);
  const versao = proximaVersao(versoesNaBase(caminhos, campusId, cursoSlug), evidencia.ano);
  const { pendencias: _p, ano_documento: _a, ano_evidencia: _e, ano_fonte: _f, ...resto } = pendente;
  const proveniencia: ProvenienciaPpc = {
    id: idPpc(campusId, cursoSlug, versao),
    ano_documento: String(evidencia.ano),
    ano_evidencia: evidencia.evidencia,
    ano_fonte: evidencia.fonte,
    ...resto,
  };
  const destino = caminhoPpc(campusId, cursoSlug, versao);
  const fontes = fontesDasVersoes(caminhos, campusId, cursoSlug);
  fontes.set(versao, proveniencia.fonte_url);
  const novoRegistro = registroComVigente(registro, campusId, cursoSlug, fontes, () => false, dataLocalIso(agora));
  const gravacoes: Gravacao[] = [
    { destino: NodePath.join(caminhos.raiz, destino), texto: serializarFrontMatterPpc(proveniencia) + corpo },
  ];
  if (novoRegistro !== registro) gravacoes.push({ destino: arquivoRegistro, texto: textoRegistro(novoRegistro) });
  aplicar(gravacoes, [absoluto]);
  return {
    chave: `${campusId}/${cursoSlug}/${versao}`,
    id: proveniencia.id,
    vigente: novoRegistro.ppc?.markdown_path === destino,
  };
}
