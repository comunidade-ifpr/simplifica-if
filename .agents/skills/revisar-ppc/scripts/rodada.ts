/**
 * Rodada de análise: caminhos, relógio, hashes e leitura e escrita de JSON
 * (porte de `common.py`). A identificação do curso fica em `identificacao.ts`.
 *
 * Os arquivos da rodada precisam sair idênticos aos do Python: JSON pelo
 * `json` do Python (`@simplifica-if/kb/python/json`), datas no fuso local com
 * deslocamento (`2026-11-13T10:00:00-03:00`) e caminhos resolvidos como
 * `Path.resolve()`.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { TAMANHO_MAXIMO_GRUPO } from "@simplifica-if/kb/db/pacote-contexto";
import { carregarJsonPy, dumpsPy, jsonIndentadoPy } from "@simplifica-if/kb/python/json";
import { type ObjetoPy, strPy } from "@simplifica-if/kb/python/valores";
import { compararTexto } from "@simplifica-if/kb/texto";
import { listarArquivos } from "./arquivos.ts";
import { type CaminhosAnalise, caminhosPadrao } from "./caminhos.ts";

/** Tamanho máximo de um grupo de sub-agente (fichas); tópicos maiores viram partes. */
export const TAMANHO_GRUPO_PADRAO = TAMANHO_MAXIMO_GRUPO;

// ---------------------------------------------------------------- relógio

/** Fonte da data e hora atuais; injetável para testes e diferenciais. */
export type Relogio = () => Date;

/**
 * Formato aceito em `REVISAR_PPC_AGORA`, o mesmo de `_fixar_relogio` em `converter_docx.py`:
 * `AAAA-MM-DD`, ou `AAAA-MM-DDTHH:MM[:SS[.ffffff]]` com fuso opcional (`Z` ou `±HH:MM`).
 */
const RE_AGORA = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * Relógio da linha de comando: a variável `REVISAR_PPC_AGORA` (data ISO 8601, veja `RE_AGORA`)
 * fixa o instante, para testes e diferenciais; sem ela, a hora do sistema. Como no Python
 * (`datetime.fromisoformat(...).astimezone()`), data sem hora é meia-noite local e data-hora sem
 * fuso é hora local; o resto é recusado.
 */
export function relogioDoAmbiente(): Date {
  const fixo = process.env.REVISAR_PPC_AGORA;
  if (fixo) {
    const m = RE_AGORA.exec(fixo);
    const [ano, mes, dia] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
    // Dia que existe no calendário (`new Date` aceitaria 2026-02-30 como 2 de março).
    const calendario = new Date(Date.UTC(ano, mes - 1, dia));
    const diaValido = m && calendario.getUTCMonth() === mes - 1 && calendario.getUTCDate() === dia;
    // `new Date("AAAA-MM-DD")` seria meia-noite UTC; a data sem hora é meia-noite local.
    const data = !diaValido ? null : fixo.length === 10 ? new Date(ano, mes - 1, dia) : new Date(fixo);
    if (!data || Number.isNaN(data.getTime())) throw new Error(`REVISAR_PPC_AGORA inválida: ${fixo}`);
    return data;
  }
  return new Date();
}

const dois = (n: number) => String(n).padStart(2, "0");

/** `datetime.now().astimezone().isoformat(timespec="seconds")`: hora local com deslocamento. */
export function agoraIso(relogio: Relogio = relogioDoAmbiente): string {
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

/** `datetime.now().astimezone().strftime("%Y-%m-%dt%H-%M-%S")`. */
export function timestampSlug(relogio: Relogio = relogioDoAmbiente): string {
  const data = relogio();
  return (
    `${String(data.getFullYear()).padStart(4, "0")}-${dois(data.getMonth() + 1)}-${dois(data.getDate())}` +
    `t${dois(data.getHours())}-${dois(data.getMinutes())}-${dois(data.getSeconds())}`
  );
}

// ---------------------------------------------------------------- arquivos

/** `Path(caminho).resolve()`: absoluto, com symlinks resolvidos na parte que existe. */
export function resolverCaminho(caminho: string): string {
  const absoluto = path.resolve(caminho);
  let existente = absoluto;
  const resto: string[] = [];
  while (!existsSync(existente)) {
    const pai = path.dirname(existente);
    if (pai === existente) return absoluto;
    resto.unshift(path.basename(existente));
    existente = pai;
  }
  return path.join(realpathSync(existente), ...resto);
}

export function existe(caminho: string): boolean {
  return existsSync(caminho);
}

export function ehDiretorio(caminho: string): boolean {
  return existsSync(caminho) && statSync(caminho).isDirectory();
}

/** `read_json`: JSON do Python (floats preservados). */
export function lerJsonPy(caminho: string): unknown {
  return carregarJsonPy(caminho);
}

/** `write_json`: JSON indentado do Python, com `\n` final. */
export function escreverJsonPy(caminho: string, valor: unknown): void {
  mkdirSync(path.dirname(caminho), { recursive: true });
  writeFileSync(caminho, jsonIndentadoPy(valor), "utf-8");
}

/** `write_text`. */
export function escreverTextoPy(caminho: string, texto: string): void {
  mkdirSync(path.dirname(caminho), { recursive: true });
  writeFileSync(caminho, texto, "utf-8");
}

/** `Path.read_text(encoding="utf-8")`: UTF-8 estrito com quebras de linha universais. */
export { lerTexto } from "@simplifica-if/kb/texto";

export function sha256Texto(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex");
}

/** `sha256_json_payload`: hash do JSON compacto com chaves ordenadas por code point. */
export function sha256JsonPayload(valor: unknown): string {
  return sha256Texto(dumpsPy(valor, { ordenarChaves: true, separadores: [",", ":"] }));
}

export function sha256Arquivo(caminho: string): string {
  return createHash("sha256").update(readFileSync(caminho)).digest("hex");
}

/** `sha256_catalogo_json`: hash de nome e conteúdo dos `*.json` do diretório, em ordem de nome. */
export function sha256CatalogoJson(diretorio: string): string {
  const arquivos = listarArquivos(diretorio, ".json");
  if (!arquivos.length) return sha256Texto("[]");
  const hash = createHash("sha256");
  for (const arquivo of arquivos) {
    hash.update(Buffer.from(path.basename(arquivo), "utf8"));
    hash.update(Buffer.from([0]));
    hash.update(readFileSync(arquivo));
    hash.update(Buffer.from([0]));
  }
  return hash.digest("hex");
}

/** `load_fichas`: fichas na ordem dos nomes de arquivo. */
export function carregarFichas(fichasDir: string): ObjetoPy[] {
  return listarArquivos(fichasDir, ".json").map((arquivo) => lerJsonPy(arquivo) as ObjetoPy);
}

/** `sorted(itens, key=lambda item: str(item.get("id", "")))`. */
export function ordenarPorId<T extends ObjetoPy>(itens: T[]): T[] {
  return [...itens].sort((a, b) => compararTexto(strPy(a.id ?? ""), strPy(b.id ?? "")));
}

/** `safe_relpath`: caminho relativo a `base` quando dentro dela; senão, absoluto. */
export function caminhoRelativoSeguro(caminho: string, base: string): string {
  const alvo = resolverCaminho(caminho);
  const raiz = resolverCaminho(base);
  if (alvo === raiz) return ".";
  const prefixo = raiz.endsWith(path.sep) ? raiz : raiz + path.sep;
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

/** `round_paths`: arquivos da rodada em `arquivos-suporte/` (ou na raiz, em rodadas antigas). */
export function caminhosRodada(rodada: string): CaminhosRodada {
  const rodadaDir = resolverCaminho(rodada);
  const legados = ["PPC.md", "metadata.json", "manifesto-rodada.json"].map((nome) => path.join(rodadaDir, nome));
  const suporte = path.join(rodadaDir, "arquivos-suporte");
  const base = !existsSync(suporte) && legados.some((caminho) => existsSync(caminho)) ? rodadaDir : suporte;
  return {
    rodadaDir,
    suporteDir: base,
    artefatosConversaoDir: path.join(base, "artefatos-conversao"),
    ppc: path.join(base, "PPC.md"),
    ppcBruto: path.join(base, "PPC-bruto.md"),
    metadata: path.join(base, "metadata.json"),
    manifesto: path.join(base, "manifesto-rodada.json"),
    preparacaoDocx: path.join(base, "preparacao-docx.json"),
    cnctContexto: path.join(base, "cnct-contexto.json"),
    contextoEstruturalSubagents: path.join(base, "contexto-estrutural-subagents.json"),
    validacoesCruzadasContexto: path.join(base, "validacoes-cruzadas-contexto.json"),
    gruposAvulsosDir: path.join(base, "grupos-avulsos"),
    promptsSubagentsDir: path.join(base, "prompts-subagents"),
    promptsSubagentsManifest: path.join(base, "prompts-subagents", "manifest.json"),
    resultadosSubagents: path.join(base, "resultados-subagents.json"),
    gruposSubagents: path.join(base, "grupos-subagents.json"),
    relatorioHtml: path.join(rodadaDir, "relatorio-revisao.html"),
  };
}

/** `update_manifesto_base`: grava `manifesto-rodada.json` com os hashes de PPC, fichas, validações e prompts. */
export function atualizarManifestoBase(
  rodada: string,
  opcoes: { caminhos?: CaminhosAnalise; relogio?: Relogio } = {},
): ObjetoPy {
  const skill = opcoes.caminhos ?? caminhosPadrao();
  const caminhos = caminhosRodada(rodada);
  const promptSubagent = path.join(skill.promptsDir, "subagent-lote-fichas.md");
  const promptSintese = path.join(skill.promptsDir, "sintese-transversal.md");
  const manifesto = {
    rodada_id: path.basename(rodada),
    rodada_dir: resolverCaminho(rodada),
    ppc_sha256: sha256Arquivo(caminhos.ppc),
    fichas_sha256: sha256CatalogoJson(skill.fichasDir),
    validacoes_cruzadas_sha256: sha256CatalogoJson(skill.validacoesCruzadasDir),
    prompt_subagent_sha256: existsSync(promptSubagent) ? sha256Arquivo(promptSubagent) : "",
    prompt_sintese_transversal_sha256: existsSync(promptSintese) ? sha256Arquivo(promptSintese) : "",
    execucao: "subagents-na-conversa",
    criado_em: agoraIso(opcoes.relogio),
  };
  escreverJsonPy(caminhos.manifesto, manifesto);
  return manifesto;
}
