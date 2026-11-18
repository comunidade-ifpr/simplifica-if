// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- arquivos da rodada lidos e gravados de forma síncrona; `interpretarAgora` monta a data de REVISAR_PPC_AGORA
/**
 * Rodada de análise: caminhos, relógio, hashes e leitura e escrita de JSON.
 * A identificação do curso fica em `identificacao.ts`.
 *
 * Os arquivos da rodada saem sempre iguais: JSON tipado
 * (`@simplifica-if/kb/primitivas/json-tipado`), datas no fuso local com
 * deslocamento (`2026-11-13T10:00:00-03:00`) e caminhos absolutos resolvidos.
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { TAMANHO_MAXIMO_GRUPO } from "@simplifica-if/kb/db/pacote-contexto";
import {
  carregarJsonTipado,
  serializarJsonTipado,
  jsonTipadoIndentado,
} from "@simplifica-if/kb/primitivas/json-tipado";
import { type Dicionario, textoDoValor } from "@simplifica-if/kb/primitivas/valores";
import { compararTexto } from "@simplifica-if/kb/texto";
import { listarArquivos } from "./arquivos.ts";
import { type CaminhosAnalise, caminhosPadrao } from "./caminhos.ts";

/** Tamanho máximo de um grupo de sub-agente (fichas); tópicos maiores viram partes. */
export const TAMANHO_GRUPO_PADRAO = TAMANHO_MAXIMO_GRUPO;

// ---------------------------------------------------------------- relógio

/** Fonte da data e hora atuais; injetável para testes e diferenciais. */
export type Relogio = () => Date;

/**
 * Formato aceito em `REVISAR_PPC_AGORA`:
 * `AAAA-MM-DD`, ou `AAAA-MM-DDTHH:MM[:SS[.ffffff]]` com fuso opcional (`Z` ou `±HH:MM`).
 */
const RE_AGORA = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * Instante de `REVISAR_PPC_AGORA` (data ISO 8601, veja `RE_AGORA`), que o ponto de entrada lê para
 * fixar o relógio em testes. Data sem hora é meia-noite local e data-hora sem fuso é hora local;
 * o resto (inclusive dia que não existe no calendário) dá `undefined`.
 */
export function interpretarAgora(texto: string): Date | undefined {
  const m = RE_AGORA.exec(texto);
  if (!m) return undefined;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Dia que existe no calendário (`new Date` aceitaria 2026-02-30 como 2 de março).
  const calendario = new Date(Date.UTC(ano, mes - 1, dia));
  if (calendario.getUTCMonth() !== mes - 1 || calendario.getUTCDate() !== dia) return undefined;
  // `new Date("AAAA-MM-DD")` seria meia-noite UTC; a data sem hora é meia-noite local.
  const data = texto.length === 10 ? new Date(ano, mes - 1, dia) : new Date(texto);
  return Number.isNaN(data.getTime()) ? undefined : data;
}

const dois = (n: number) => String(n).padStart(2, "0");

/** Hora local com deslocamento, até os segundos (`2026-11-13T10:00:00-03:00`). */
export function agoraIso(relogio: Relogio): string {
  const data = relogio();
  const deslocamento = -data.getTimezoneOffset();
  const sinal = deslocamento < 0 ? "-" : "+";
  const absoluto = Math.abs(deslocamento);
  return (
    `${String(data.getFullYear()).padStart(4, "0")}-${dois(data.getMonth() + 1)}-${dois(data.getDate())}` +
    `T${dois(data.getHours())}:${dois(data.getMinutes())}:${dois(data.getSeconds())}` +
    `${sinal}${dois(Math.floor(absoluto / 60))}:${dois(absoluto % 60)}`
  );
}

/** Hora local para nome de pasta (`2026-11-13t10-00-00`). */
export function timestampSlug(relogio: Relogio): string {
  const data = relogio();
  return (
    `${String(data.getFullYear()).padStart(4, "0")}-${dois(data.getMonth() + 1)}-${dois(data.getDate())}` +
    `t${dois(data.getHours())}-${dois(data.getMinutes())}-${dois(data.getSeconds())}`
  );
}

// ---------------------------------------------------------------- arquivos

/** Caminho absoluto, com symlinks resolvidos na parte que existe. */
export function resolverCaminho(caminho: string): string {
  const absoluto = NodePath.resolve(caminho);
  let existente = absoluto;
  const resto: string[] = [];
  while (!NodeFS.existsSync(existente)) {
    const pai = NodePath.dirname(existente);
    if (pai === existente) return absoluto;
    resto.unshift(NodePath.basename(existente));
    existente = pai;
  }
  return NodePath.join(NodeFS.realpathSync(existente), ...resto);
}

export function existe(caminho: string): boolean {
  return NodeFS.existsSync(caminho);
}

export function ehDiretorio(caminho: string): boolean {
  return NodeFS.existsSync(caminho) && NodeFS.statSync(caminho).isDirectory();
}

/** Lê um JSON da rodada (fracionários preservados). */
export function lerJsonDaRodada(caminho: string): unknown {
  return carregarJsonTipado(caminho);
}

/** Grava um JSON da rodada, indentado e com `\n` final. */
export function escreverJsonDaRodada(caminho: string, valor: unknown): void {
  NodeFS.mkdirSync(NodePath.dirname(caminho), { recursive: true });
  NodeFS.writeFileSync(caminho, jsonTipadoIndentado(valor), "utf-8");
}

/** Grava um texto da rodada em UTF-8, criando a pasta. */
export function escreverTextoDaRodada(caminho: string, texto: string): void {
  NodeFS.mkdirSync(NodePath.dirname(caminho), { recursive: true });
  NodeFS.writeFileSync(caminho, texto, "utf-8");
}

/** Texto em UTF-8 estrito, com quebras de linha universais. */
export { lerTexto } from "@simplifica-if/kb/texto";

export function sha256Texto(texto: string): string {
  return NodeCrypto.createHash("sha256").update(texto, "utf8").digest("hex");
}

/** Hash do JSON compacto com chaves ordenadas por code point. */
export function sha256JsonPayload(valor: unknown): string {
  return sha256Texto(serializarJsonTipado(valor, { ordenarChaves: true, separadores: [",", ":"] }));
}

export function sha256Arquivo(caminho: string): string {
  return NodeCrypto.createHash("sha256").update(NodeFS.readFileSync(caminho)).digest("hex");
}

/** Hash de nome e conteúdo dos `*.json` do diretório, em ordem de nome. */
export function sha256CatalogoJson(diretorio: string): string {
  const arquivos = listarArquivos(diretorio, ".json");
  if (!arquivos.length) return sha256Texto("[]");
  const hash = NodeCrypto.createHash("sha256");
  for (const arquivo of arquivos) {
    hash.update(Buffer.from(NodePath.basename(arquivo), "utf8"));
    hash.update(Buffer.from([0]));
    hash.update(NodeFS.readFileSync(arquivo));
    hash.update(Buffer.from([0]));
  }
  return hash.digest("hex");
}

/** Fichas na ordem dos nomes de arquivo. */
export function carregarFichas(fichasDir: string): Dicionario[] {
  return listarArquivos(fichasDir, ".json").map((arquivo) => lerJsonDaRodada(arquivo) as Dicionario);
}

/** Itens ordenados pelo texto do `id` (code point); sem `id`, o texto vazio. */
export function ordenarPorId<T extends Dicionario>(itens: T[]): T[] {
  return [...itens].sort((a, b) => compararTexto(textoDoValor(a.id ?? ""), textoDoValor(b.id ?? "")));
}

/** Caminho relativo a `base` quando dentro dela; senão, absoluto. */
export function caminhoRelativoSeguro(caminho: string, base: string): string {
  const alvo = resolverCaminho(caminho);
  const raiz = resolverCaminho(base);
  if (alvo === raiz) return ".";
  const prefixo = raiz.endsWith(NodePath.sep) ? raiz : raiz + NodePath.sep;
  return alvo.startsWith(prefixo) ? alvo.slice(prefixo.length) : alvo;
}

// ---------------------------------------------------------------- caminhos da rodada

export type CaminhosRodada = {
  rodadaDir: string;
  suporteDir: string;
  artefatosConversaoDir: string;
  ppc: string;
  ppcBruto: string;
  metadata: string;
  manifesto: string;
  preparacaoDocx: string;
  cnctContexto: string;
  contextoEstruturalSubagents: string;
  validacoesCruzadasContexto: string;
  gruposAvulsosDir: string;
  promptsSubagentsDir: string;
  promptsSubagentsManifest: string;
  resultadosSubagents: string;
  gruposSubagents: string;
  relatorioHtml: string;
};

/** Arquivos da rodada: o relatório na raiz e o resto em `arquivos-suporte/`. */
export function caminhosRodada(rodada: string): CaminhosRodada {
  const rodadaDir = resolverCaminho(rodada);
  const base = NodePath.join(rodadaDir, "arquivos-suporte");
  return {
    rodadaDir,
    suporteDir: base,
    artefatosConversaoDir: NodePath.join(base, "artefatos-conversao"),
    ppc: NodePath.join(base, "PPC.md"),
    ppcBruto: NodePath.join(base, "PPC-bruto.md"),
    metadata: NodePath.join(base, "metadata.json"),
    manifesto: NodePath.join(base, "manifesto-rodada.json"),
    preparacaoDocx: NodePath.join(base, "preparacao-docx.json"),
    cnctContexto: NodePath.join(base, "cnct-contexto.json"),
    contextoEstruturalSubagents: NodePath.join(base, "contexto-estrutural-subagents.json"),
    validacoesCruzadasContexto: NodePath.join(base, "validacoes-cruzadas-contexto.json"),
    gruposAvulsosDir: NodePath.join(base, "grupos-avulsos"),
    promptsSubagentsDir: NodePath.join(base, "prompts-subagents"),
    promptsSubagentsManifest: NodePath.join(base, "prompts-subagents", "manifest.json"),
    resultadosSubagents: NodePath.join(base, "resultados-subagents.json"),
    gruposSubagents: NodePath.join(base, "grupos-subagents.json"),
    relatorioHtml: NodePath.join(rodadaDir, "relatorio-revisao.html"),
  };
}

/** Grava `manifesto-rodada.json` com os hashes de PPC, fichas, validações e prompts. */
export function atualizarManifestoBase(
  rodada: string,
  opcoes: { caminhos?: CaminhosAnalise; relogio: Relogio },
): Dicionario {
  const skill = opcoes.caminhos ?? caminhosPadrao();
  const caminhos = caminhosRodada(rodada);
  const promptSubagent = NodePath.join(skill.promptsDir, "subagent-lote-fichas.md");
  const promptSintese = NodePath.join(skill.promptsDir, "sintese-transversal.md");
  const manifesto = {
    rodada_id: NodePath.basename(rodada),
    rodada_dir: resolverCaminho(rodada),
    ppc_sha256: sha256Arquivo(caminhos.ppc),
    fichas_sha256: sha256CatalogoJson(skill.fichasDir),
    validacoes_cruzadas_sha256: sha256CatalogoJson(skill.validacoesCruzadasDir),
    prompt_subagent_sha256: NodeFS.existsSync(promptSubagent) ? sha256Arquivo(promptSubagent) : "",
    prompt_sintese_transversal_sha256: NodeFS.existsSync(promptSintese) ? sha256Arquivo(promptSintese) : "",
    execucao: "subagents-na-conversa",
    criado_em: agoraIso(opcoes.relogio),
  };
  escreverJsonDaRodada(caminhos.manifesto, manifesto);
  return manifesto;
}
