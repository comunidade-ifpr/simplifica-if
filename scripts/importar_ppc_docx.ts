#!/usr/bin/env node
/** Leva um PPC novo (ou a versão nova do PPC de um curso) do DOCX da coordenação para a base. */
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Argument from "effect/cli/Argument";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import { ROTULOS_PESSOAIS } from "@simplifica-if/kb/ppcs/dados-pessoais";
import { criarCaminhos } from "./base/caminhos.ts";
import { importarPpcDocx, type ResultadoImportacao } from "./base/importar-ppc.ts";
import { RAIZ_PROJETO } from "./config.ts";
import * as Git from "./git.ts";
import { executarPrincipal } from "./principal.ts";

const PASSOS_SEGUINTES = [
  "node scripts/gerar_base.ts",
  "node scripts/gerar_indice_ppcs.ts",
  "node scripts/validar_base.ts",
  "node scripts/gerar_site.ts",
];

/**
 * Pastas de dados e de saída, que não mudam o texto convertido: alteração nelas não marca o conversor.
 * Arquivo não rastreado também não conta: o próprio DOCX de entrada pode estar no checkout.
 */
const FORA_DO_CONVERSOR = ["base-conhecimento", "site", "tmp", "outputs"];

/**
 * Conversor e versão: o pacote e o commit do checkout, com `-modificado` quando há alteração não
 * comitada em arquivo rastreado fora de `FORA_DO_CONVERSOR`. A saída depende de `packages/ppc`,
 * `packages/docx` e `packages/kb` (front matter, dados pessoais), de `scripts/base/importar-ppc.ts`,
 * `scripts/dados/urls.ts` e deste script; olhar o checkout inteiro não deixa nenhum de fora.
 */
const conversorAtual = Effect.fn("importar_ppc_docx.conversorAtual")(function* () {
  const git = (...args: string[]) => Effect.map(Git.executar(args, { cwd: RAIZ_PROJETO }), (saida) => saida.trim());
  const commit = yield* git("rev-parse", "HEAD");
  const fora = FORA_DO_CONVERSOR.map((pasta) => `:(exclude)${pasta}`);
  const sujo = (yield* git("status", "--porcelain", "--untracked-files=no", "--", ".", ...fora)) !== "";
  return `simplifica-if/packages/ppc@${commit}${sujo ? "-modificado" : ""}`;
});

function relatorio(resultado: ResultadoImportacao): string[] {
  const linhas = [
    `${resultado.substituiu ? "PPC substituído" : "PPC gravado"}: base-conhecimento/${resultado.markdownPath}`,
    `Registro atualizado: base-conhecimento/${resultado.registroPath}`,
  ];
  if (resultado.ppcUrlAnterior) linhas.push(`ppc.url trocado (antes: ${resultado.ppcUrlAnterior})`);
  const omitidos = Object.entries(resultado.omitidos)
    .filter(([, n]) => n)
    .map(([categoria, n]) => `${n} ${ROTULOS_PESSOAIS[categoria as keyof typeof resultado.omitidos]}`);
  linhas.push(`Dados pessoais omitidos: ${omitidos.length ? omitidos.join(", ") : "nenhum"}`);
  const { planilhas, sessoesSei, assinadas } = resultado.urlsLimpas;
  if (planilhas + sessoesSei + assinadas) {
    linhas.push(
      `URLs internas limpas: ${planilhas} planilha(s) do Google, ${sessoesSei} sessão(ões) do SEI, ${assinadas} URL(s) pré-assinada(s)`,
    );
  }
  if (resultado.representacaoGrafica) {
    linhas.push(`Representação gráfica: ${resultado.representacaoGrafica} (o Markdown traz um aviso no lugar)`);
  }
  if (resultado.curadoriaReaberta.length) {
    linhas.push(
      `Curadoria reaberta ("Precisa de revisão"): ${resultado.curadoriaReaberta.map((c) => `ppc.${c}`).join(", ")}; confira contra o texto novo`,
    );
  }
  if (resultado.observacoesAReconferir) {
    linhas.push("ppc.observacoes mantido, mas escrito sobre o texto anterior: a reconferir contra o texto novo");
  }
  linhas.push("\nAntes de comitar, confira o Markdown (e-mail particular sai à mão) e rode:");
  for (const comando of PASSOS_SEGUINTES) linhas.push(`  ${comando}`);
  return linhas;
}

export const comando = Command.make(
  "importar_ppc_docx",
  {
    curso: Argument.String("curso").pipe(Argument.withDescription("chave do curso, <campus_id>/<curso_slug>")),
    arquivoDocx: Argument.String("arquivo.docx").pipe(
      Argument.withDescription("o DOCX do PPC enviado pela coordenação"),
    ),
    fonteUrl: Flag.String("fonte-url").pipe(
      Flag.withMetavar("url"),
      Flag.withDescription("endereço público do PPC (https), gravado em fonte_url e em ppc.url"),
    ),
    substituir: Flag.Boolean("substituir").pipe(
      Flag.withDescription("troca o PPC já gravado do curso (a versão anterior fica no git)"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn("importar_ppc_docx")(function* ({ curso, arquivoDocx, fonteUrl, substituir }) {
    const resultado = yield* importarPpcDocx({
      caminhos: criarCaminhos(),
      curso,
      arquivoDocx,
      fonteUrl,
      substituir,
      agora: DateTime.toDateUtc(yield* DateTime.now),
      conversor: yield* conversorAtual(),
    });
    for (const linha of relatorio(resultado)) yield* Console.log(linha);
  }),
).pipe(
  Command.withDescription(
    "Converte o DOCX do PPC e o grava em institucional/ifpr/ppcs/<campus_id>/<curso_slug>.md, com front matter " +
      "de proveniência registrada, sem dados pessoais. Atualiza ppc.url e ppc.markdown_path do registro do curso. " +
      "Não regenera índices nem o site.",
  ),
);

if (import.meta.main) {
  executarPrincipal("importar_ppc_docx", Command.run(comando, { version: "1.0.0" }));
}
