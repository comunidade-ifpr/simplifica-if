#!/usr/bin/env node
// @effect-diagnostics globalConsole:off nodeBuiltinImport:off globalDate:off -- script de execução única da curadoria, síncrono, com a casca de scripts/cli.ts: imprime no console, consulta o git e usa o relógio da importação
/** Leva um PPC novo (ou a versão nova do PPC de um curso) do DOCX da coordenação para a base. */
import * as NodeChildProcess from "node:child_process";
import { criarCaminhos } from "./base/caminhos.ts";
import { ErroImportacao, importarPpcDocx, type ResultadoImportacao } from "./base/importar-ppc.ts";
import { ROTULOS_PESSOAIS } from "./base/validacao/normas.ts";
import { lerArgumentos } from "./cli.ts";
import { RAIZ_PROJETO } from "./config.ts";

const USO = `uso: node scripts/importar_ppc_docx.ts <campus_id>/<curso_slug> <arquivo.docx> --fonte-url <url> [--substituir]

Converte o DOCX do PPC e o grava em institucional/ifpr/ppcs/<campus_id>/<curso_slug>.md, com
front matter de proveniência registrada, sem dados pessoais. Atualiza ppc.url e ppc.markdown_path
do registro do curso. Não regenera índices nem o site.

  --fonte-url <url>  endereço público do PPC (https), gravado em fonte_url e em ppc.url
  --substituir       troca o PPC já gravado do curso (a versão anterior fica no git)
  -h, --help         mostra esta ajuda`;

const PASSOS_SEGUINTES = [
  "node scripts/gerar_base.ts",
  "node scripts/gerar_indice_ppcs.ts",
  "node scripts/validar_base.ts",
  "node scripts/gerar_site.ts",
];

function git(...args: string[]): string {
  return NodeChildProcess.execFileSync("git", args, { cwd: RAIZ_PROJETO, encoding: "utf-8" }).trim();
}

/**
 * Conversor e versão: o pacote e o commit do checkout, com `-modificado` quando a conversão
 * (`packages/ppc`, `packages/docx`) tem alteração não comitada.
 */
function conversorAtual(): string {
  const commit = git("rev-parse", "HEAD");
  const sujo = git("status", "--porcelain", "--", "packages/ppc", "packages/docx") !== "";
  return `simplifica-if/packages/ppc@${commit}${sujo ? "-modificado" : ""}`;
}

function relatar(resultado: ResultadoImportacao): void {
  console.log(
    `${resultado.substituiu ? "PPC substituído" : "PPC gravado"}: base-conhecimento/${resultado.markdownPath}`,
  );
  console.log(`Registro atualizado: base-conhecimento/${resultado.registroPath}`);
  if (resultado.ppcUrlAnterior) console.log(`ppc.url trocado (antes: ${resultado.ppcUrlAnterior})`);
  const omitidos = Object.entries(resultado.omitidos)
    .filter(([, n]) => n)
    .map(([categoria, n]) => `${n} ${ROTULOS_PESSOAIS[categoria as keyof typeof ROTULOS_PESSOAIS]}`);
  console.log(`Dados pessoais omitidos: ${omitidos.length ? omitidos.join(", ") : "nenhum"}`);
  const { planilhas, sessoesSei, assinadas } = resultado.urlsLimpas;
  if (planilhas + sessoesSei + assinadas) {
    console.log(
      `URLs internas limpas: ${planilhas} planilha(s) do Google, ${sessoesSei} sessão(ões) do SEI, ${assinadas} URL(s) pré-assinada(s)`,
    );
  }
  if (resultado.representacaoGrafica) {
    console.log(`Representação gráfica: ${resultado.representacaoGrafica} (o Markdown traz um aviso no lugar)`);
  }
  if (resultado.curadoriaReaberta.length) {
    console.log(
      `Curadoria reaberta ("Precisa de revisão"): ${resultado.curadoriaReaberta.map((c) => `ppc.${c}`).join(", ")}; confira contra o texto novo`,
    );
  }
  console.log("\nAntes de comitar, confira o Markdown (e-mail particular sai à mão) e rode:");
  for (const comando of PASSOS_SEGUINTES) console.log(`  ${comando}`);
}

function main(): number {
  const args = lerArgumentos(
    process.argv.slice(2),
    { "fonte-url": { type: "string" }, substituir: { type: "boolean" } },
    { uso: USO, posicionais: true },
  );
  if ("codigo" in args) return args.codigo;
  const [curso, arquivoDocx, ...sobra] = args.positionals;
  const fonteUrl = args.values["fonte-url"];
  if (!curso || !arquivoDocx || sobra.length || !fonteUrl) {
    console.error(`${USO}\nerro: informe o curso, o arquivo .docx e --fonte-url`);
    return 2;
  }
  try {
    const resultado = importarPpcDocx({
      caminhos: criarCaminhos(),
      curso,
      arquivoDocx,
      fonteUrl,
      substituir: args.values.substituir ?? false,
      agora: new Date(),
      conversor: conversorAtual(),
    });
    relatar(resultado);
    return 0;
  } catch (erro) {
    if (erro instanceof ErroImportacao) {
      console.error(`erro: ${erro.message}`);
      return 1;
    }
    throw erro;
  }
}

process.exitCode = main();
