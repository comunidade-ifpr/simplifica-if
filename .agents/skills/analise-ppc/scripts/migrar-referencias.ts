#!/usr/bin/env bun
/**
 * Migração única (fase 2b): `referencias_normativas` das fichas, de texto livre para
 * `{ ref, dispositivo?, papel, nota? }`, e os campos de norma de `marcos-normativos.json` para IDs.
 *
 * O ID e os dispositivos vêm de `resolverCitacao`. Cada citação é conferida por ida e volta: o
 * texto legível renderizado da estrutura tem de ser igual ao original, ou a diferença tem de estar
 * na lista revisada abaixo (`EQUIVALENTES`), ou a informação a mais vai para `nota`. Sem isso, a
 * migração para.
 *
 * Uso: bun run .agents/skills/analise-ppc/scripts/migrar-referencias.ts [--gravar]
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { jsonIndentado } from "@simplifica-if/kb/json";
import {
  carregarUniversoReferencias,
  type PapelReferencia,
  type ReferenciaNormativa,
  referenciasLegiveis,
} from "@simplifica-if/kb/normas/referencia-estruturada";
import { resolverCitacao } from "@simplifica-if/kb/normas/resolver";
import { listarArquivos } from "./arquivos.ts";
import { caminhosPadrao } from "./caminhos.ts";

const gravar = process.argv.includes("--gravar");
const caminhos = caminhosPadrao();
const universo = carregarUniversoReferencias(path.dirname(caminhos.baseConhecimentoDir));

/** Papel `complementar`, revisado ficha a ficha (o padrão é `fundamento`). */
const COMPLEMENTARES = new Map<string, string>([
  ["CT-CURR-03|Resolução CONSUP/IFPR nº 64/2022", "o parâmetro de 1.800 h da norma do IFPR não substitui os mínimos"],
  ["CT-CURR-06|ABNT NBR 6023", "parâmetro formal; o fundamento é o art. 28, § 1º, I"],
  ["CT-CURR-21|Regulamento Geral de Estágio do campus", "fonte local a que o PPC deve remeter"],
  ["CT-CURR-24|Regulamento Geral de Estágio do campus", "fonte local a que o PPC deve remeter"],
  ["CT-CURR-25|Regulamento Geral de Estágio do campus", "fonte local a que o PPC deve remeter"],
  ["CT-IDENT-15|Resolução CNE/CP nº 2/2025", "norma referida pelo art. 45, § 3º, da Res. CNE/CP nº 2/2026"],
]);

/** Informação da citação original que não cabe em `ref` e `dispositivo`. */
const NOTAS = new Map<string, string>([
  ["Nota Técnica PROENS/IFPR nº 1/2025 (SEI nº 3881287)", "SEI nº 3881287"],
  [
    "Catálogo Nacional de Cursos Técnicos (CNCT), perfil profissional do curso correspondente",
    "perfil profissional do curso correspondente",
  ],
]);

/** Dispositivo acrescentado na revisão, com a fonte na base. */
const DISPOSITIVOS_REVISADOS = new Map<string, { dispositivo: string; motivo: string }>([
  [
    "Resolução CNE/CP nº 2/2025",
    {
      dispositivo: "#art1",
      motivo: "a Res. CNE/CP nº 2/2026, art. 45, § 3º, remete ao art. 1º da Res. CNE/CP nº 2/2025 (trava digital)",
    },
  ],
]);

/** Texto original → texto renderizado aceito na revisão (mesma norma, título canônico). */
const EQUIVALENTES = new Map<string, string>([
  ["CNCT", "Catálogo Nacional de Cursos Técnicos (CNCT)"],
  ["Catálogo Nacional de Cursos Técnicos", "Catálogo Nacional de Cursos Técnicos (CNCT)"],
  ["LDB, arts. 61 a 63", "Lei nº 9.394/1996, arts. 61 a 63"],
  ["Resolução CNE/CP nº 2/2025", "Resolução CNE/CP nº 2/2025, art. 1º"],
  [
    "Catálogo Nacional de Cursos Técnicos (CNCT), perfil profissional do curso correspondente",
    "Catálogo Nacional de Cursos Técnicos (CNCT) — perfil profissional do curso correspondente",
  ],
  ["Nota Técnica PROENS/IFPR nº 1/2025 (SEI nº 3881287)", "Nota Técnica PROENS/IFPR nº 1/2025 — SEI nº 3881287"],
]);

const contagem = new Map<string, number>();
const revisados: string[] = [];
let total = 0;

function migrarCitacao(fichaId: string, texto: string): ReferenciaNormativa[] {
  total += 1;
  const r = resolverCitacao(texto);
  if (r.id === null) throw new Error(`${fichaId}: sem ID: ${texto} (${r.regra})`);
  contagem.set(`${r.regra} (${r.confianca})`, (contagem.get(`${r.regra} (${r.confianca})`) ?? 0) + 1);
  const papel: PapelReferencia = COMPLEMENTARES.has(`${fichaId}|${texto}`) ? "complementar" : "fundamento";
  let dispositivos = r.dispositivos ?? (r.dispositivoId ? [r.dispositivoId] : []);
  const revisao = DISPOSITIVOS_REVISADOS.get(texto);
  if (revisao) dispositivos = [revisao.dispositivo];
  const nota = NOTAS.get(texto);
  const entradas: ReferenciaNormativa[] = dispositivos.length
    ? dispositivos.map((dispositivo) => ({ ref: r.id!, dispositivo, papel }))
    : [{ ref: r.id, papel }];
  if (nota) entradas[0]!.nota = nota;

  const legiveis = referenciasLegiveis(entradas, universo);
  if (legiveis.length !== 1) throw new Error(`${fichaId}: a citação não volta a ser uma só: ${texto}`);
  const renderizado = legiveis[0]!.texto;
  const motivos: string[] = [];
  if (r.confianca < 1) motivos.push(`confiança ${r.confianca} (${r.regra})`);
  if (!dispositivos.length) motivos.push("sem dispositivo");
  if (papel === "complementar") motivos.push(`complementar: ${COMPLEMENTARES.get(`${fichaId}|${texto}`)}`);
  if (revisao) motivos.push(`dispositivo acrescentado: ${revisao.motivo}`);
  if (nota) motivos.push(`nota: ${nota}`);
  if (renderizado !== texto) {
    if (EQUIVALENTES.get(texto) !== renderizado) {
      throw new Error(`${fichaId}: ida e volta diverge: ${JSON.stringify(texto)} → ${JSON.stringify(renderizado)}`);
    }
    motivos.push(`texto renderizado: ${renderizado}`);
  }
  revisados.push(`${fichaId}\t${texto}\t${r.id}\t${dispositivos.join(" ") || "—"}\t${papel}\t${motivos.join("; ")}`);
  return entradas;
}

for (const arquivo of listarArquivos(caminhos.fichasDir, ".json")) {
  const original = readFileSync(arquivo, "utf-8");
  const ficha = JSON.parse(original) as Record<string, unknown>;
  if (jsonIndentado(ficha) !== original) throw new Error(`${arquivo}: serialização não reproduz o arquivo`);
  const referencias = ficha.referencias_normativas;
  if (!Array.isArray(referencias)) continue;
  if (referencias.some((item) => typeof item !== "string")) throw new Error(`${arquivo}: já migrada`);
  ficha.referencias_normativas = (referencias as string[]).flatMap((texto) => migrarCitacao(String(ficha.id), texto));
  if (gravar) writeFileSync(arquivo, jsonIndentado(ficha), "utf-8");
}

/** Marcos: `vigente`, `substitui` e `antecessoras_historicas` viram IDs; dispositivos, `id#dispositivo`. */
const marcosOriginal = readFileSync(caminhos.marcosNormativosPath, "utf-8");
const registroMarcos = JSON.parse(marcosOriginal) as { versao: number; marcos: Record<string, unknown>[] };
if (jsonIndentado(registroMarcos) !== marcosOriginal) throw new Error("marcos: serialização não reproduz o arquivo");
const idDe = (texto: string, contexto: string): string => {
  const r = resolverCitacao(texto);
  if (r.id === null || r.confianca < 0.98) throw new Error(`${contexto}: ${texto} → ${r.id} (${r.regra})`);
  const dispositivos = r.dispositivos ?? (r.dispositivoId ? [r.dispositivoId] : []);
  if (dispositivos.length > 1) throw new Error(`${contexto}: mais de um dispositivo em ${texto}`);
  const id = `${r.id}${dispositivos[0] ?? ""}`;
  console.log(`marco\t${contexto}\t${texto}\t${id}`);
  return id;
};
registroMarcos.versao = 3;
for (const marco of registroMarcos.marcos) {
  const contexto = String(marco.id);
  marco.vigente = idDe(String(marco.vigente), `${contexto}.vigente`);
  for (const campo of ["substitui", "antecessoras_historicas", "dispositivos_revogados"]) {
    marco[campo] = (marco[campo] as string[]).map((texto) => idDe(texto, `${contexto}.${campo}`));
  }
}
if (gravar) writeFileSync(caminhos.marcosNormativosPath, jsonIndentado(registroMarcos), "utf-8");

console.log(revisados.join("\n"));
console.log(`\n${total} citações migradas por regra:`);
for (const [regra, quantidade] of contagem) console.log(`  ${regra}: ${quantidade}`);
console.log(gravar ? "Gravado." : "Simulação; use --gravar para escrever.");
