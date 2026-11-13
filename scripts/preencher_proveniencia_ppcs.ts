#!/usr/bin/env bun
/**
 * Uso único (fase 4): acrescenta o front matter de proveniência reconstruída aos PPCs já
 * convertidos, a partir do histórico do git. Não baixa os PDFs: o PDF baixado hoje não prova que é
 * o mesmo arquivo convertido, então hash e versão do conversor ficam `desconhecido`.
 *
 * - `conversao_commit`/`convertido_em`: último commit que acrescentou o arquivo ou o substituiu por
 *   nova conversão (data de autoria). Não contam a mudança de caminho de `8a8cc7e` nem os commits de
 *   pós-processamento (limpeza de ruído e remoção de sumário), listados em
 *   `pos_processamento_commits`.
 * - `fonte_url`: `ppc.url` do campus JSON no commit da conversão, conferido com o `ppc.url` atual de
 *   `dados/institucional/` (só leitura).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  idPpc,
  linhasFrontMatter,
  type ProvenienciaPpc,
  serializarFrontMatterPpc,
} from "@simplifica-if/kb/ppcs/front-matter";
import { RAIZ_PROJETO } from "./config.ts";

/** Commits que só pós-processaram o texto convertido (assunto "Limpa…" e "Remove sumarios…"). */
const POS_PROCESSAMENTO = new Set(["096e70f", "3ed410a", "c628136", "abf13fb", "9a5b159"]);
/** Commit que só moveu `institucional/` para `base-conhecimento/institucional/`. */
const MUDANCA_CAMINHO = "8a8cc7e";
const PREFIXO_NOVO = "base-conhecimento/";

function git(...args: string[]): string {
  const r = Bun.spawnSync(["git", ...args], { cwd: RAIZ_PROJETO, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString();
}

type Evento = { hash: string; curto: string; data: string; status: string };

/** Eventos por caminho relativo a `base-conhecimento/`, do mais antigo ao mais novo. */
function eventosPorArquivo(): Map<string, Evento[]> {
  const log = git(
    "log",
    "--reverse",
    "--no-renames",
    "--format=@%H|%h|%as",
    "--name-status",
    "--",
    "institucional/ifpr/ppcs",
    "base-conhecimento/institucional/ifpr/ppcs",
  );
  const eventos = new Map<string, Evento[]>();
  let atual: Omit<Evento, "status"> | null = null;
  for (const linha of log.split("\n")) {
    if (linha.startsWith("@")) {
      const [hash, curto, data] = linha.slice(1).split("|") as [string, string, string];
      atual = { hash, curto: curto.slice(0, 7), data };
      continue;
    }
    const [status, arquivo] = linha.split("\t");
    if (!atual || !status || !arquivo || !arquivo.endsWith(".md")) continue;
    const relativo = arquivo.startsWith(PREFIXO_NOVO) ? arquivo.slice(PREFIXO_NOVO.length) : arquivo;
    if (!/^institucional\/ifpr\/ppcs\/[^/]+\/[^/]+\.md$/.test(relativo)) continue;
    const lista = eventos.get(relativo) ?? [];
    lista.push({ ...atual, status });
    eventos.set(relativo, lista);
  }
  return eventos;
}

/** `ppc.url` do curso com este `markdown_path` no campus JSON da época do commit. */
function urlNoCommit(hash: string, campusId: string, markdownPath: string): string | null {
  for (const prefixo of ["", PREFIXO_NOVO]) {
    let texto: string;
    try {
      texto = git("show", `${hash}:${prefixo}institucional/ifpr/campi/${campusId}.json`);
    } catch {
      continue;
    }
    const campus = JSON.parse(texto) as { cursos?: Array<{ ppc?: { url?: string; markdown_path?: string } }> };
    const curso = campus.cursos?.find((c) => c.ppc?.markdown_path === markdownPath);
    if (curso?.ppc?.url) return curso.ppc.url;
  }
  return null;
}

function main(): number {
  const eventos = eventosPorArquivo();
  const indice = JSON.parse(
    readFileSync(path.join(RAIZ_PROJETO, "base-conhecimento/institucional/ifpr/ppcs/index.json"), "utf-8"),
  ) as { items: Array<{ id: string; campus_id: string; curso_slug: string; path: string }> };
  const divergentes: string[] = [];
  let gravados = 0;
  for (const item of indice.items) {
    const arquivo = path.join(RAIZ_PROJETO, "base-conhecimento", item.path);
    const texto = readFileSync(arquivo, "utf-8");
    if (linhasFrontMatter(texto)) continue;
    const lista = (eventos.get(item.path) ?? []).filter(
      (e) => e.curto !== MUDANCA_CAMINHO && (e.status === "A" || e.status === "M"),
    );
    const conversoes = lista.filter((e) => !POS_PROCESSAMENTO.has(e.curto));
    const conversao = conversoes.at(-1);
    if (!conversao) throw new Error(`${item.path}: sem commit de conversão no histórico`);
    const posteriores = lista.filter(
      (e) => POS_PROCESSAMENTO.has(e.curto) && lista.indexOf(e) > lista.indexOf(conversao),
    );

    const cursoJson = path.join(RAIZ_PROJETO, "dados/institucional/cursos", item.campus_id, `${item.curso_slug}.json`);
    if (!existsSync(cursoJson)) throw new Error(`${item.id}: curso ausente em dados/institucional/`);
    const urlAtual = (JSON.parse(readFileSync(cursoJson, "utf-8")) as { ppc: { url: string } }).ppc.url;
    const urlConversao = urlNoCommit(conversao.hash, item.campus_id, item.path);
    const fonteUrl = urlConversao ?? urlAtual;
    const notas = [
      "Proveniência reconstruída em 2026-11-13 pelo histórico do git, sem baixar o PDF de novo.",
      "convertido_em é a data de autoria do commit em que o texto convertido entrou no git (conversao_commit).",
      urlConversao
        ? "fonte_url é o ppc.url registrado no campus JSON nesse commit."
        : "fonte_url é o ppc.url atual de dados/institucional/, porque o campus JSON do commit não o registra.",
      "fonte_sha256 e conversor são desconhecidos: o PDF da época não foi guardado, e o conversor não registrava versão.",
    ];
    if (posteriores.length) {
      notas.push("O texto foi pós-processado depois da conversão (limpeza de ruído, remoção de sumário).");
    }
    if (urlConversao && urlConversao !== urlAtual) {
      divergentes.push(`${item.id}: conversão=${urlConversao} atual=${urlAtual}`);
    }
    const proveniencia: ProvenienciaPpc = {
      id: idPpc(item.campus_id, item.curso_slug),
      fonte_url: fonteUrl,
      fonte_sha256: "desconhecido",
      convertido_em: conversao.data,
      conversor: "desconhecido",
      proveniencia: "reconstruida",
      conversao_commit: conversao.hash,
      ...(posteriores.length ? { pos_processamento_commits: posteriores.map((e) => e.hash) } : {}),
      nota_proveniencia: notas.join(" "),
    };
    writeFileSync(arquivo, serializarFrontMatterPpc(proveniencia) + texto, "utf-8");
    gravados += 1;
  }
  console.log(`PPCs com proveniência gravada: ${gravados}`);
  if (divergentes.length) {
    console.log(`URL da conversão diferente do ppc.url atual (${divergentes.length}):`);
    for (const linha of divergentes) console.log(`  ${linha}`);
  }
  return 0;
}

process.exitCode = main();
