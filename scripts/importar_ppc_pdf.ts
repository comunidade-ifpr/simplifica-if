#!/usr/bin/env node
/**
 * Leva um PPC novo (ou a versão nova do PPC de um curso) do PDF publicado para a base, quando a
 * coordenação não tem o DOCX. A conversão (`@simplifica-if/pdf`) reconhece títulos, tabelas com borda,
 * cabeçalhos e rodapés de página, e a limpeza determinística vem em seguida; o que sobra fica para a
 * revisão com IA (skill `revisar-conversao-ppc`), antes do commit.
 */
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Argument from "effect/cli/Argument";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import { criarCaminhos } from "./base/caminhos.ts";
import { importarPpcPdf } from "./base/importar-ppc.ts";
import { conversorAtual, relatorio } from "./importar_ppc_docx.ts";
import { executarPrincipal } from "./principal.ts";

const passosSeguintes = (chave: string) => [
  `node scripts/conversao_ppc.ts diagnosticar ${chave}   # e corrija com a skill revisar-conversao-ppc`,
  `node scripts/conversao_ppc.ts conferir ${chave}`,
  "node scripts/gerar_base.ts",
  "node scripts/validar_base.ts",
];

export const comando = Command.make(
  "importar_ppc_pdf",
  {
    curso: Argument.String("curso").pipe(Argument.withDescription("chave do curso, <campus_id>/<curso_slug>")),
    arquivoPdf: Argument.String("arquivo.pdf").pipe(Argument.withDescription("o PDF do PPC")),
    fonteUrl: Flag.String("fonte-url").pipe(
      Flag.withMetavar("url"),
      Flag.withDescription("endereço público do PPC (https), gravado em fonte_url e em ppc.url"),
    ),
    ano: Flag.Int("ano").pipe(
      Flag.withMetavar("AAAA"),
      Flag.withDescription("ano do documento: a versão do PPC no ID (ppc:<campus>/<curso>/<ano>)"),
      Flag.optional,
    ),
    evidencia: Flag.String("evidencia").pipe(
      Flag.withMetavar("trecho"),
      Flag.withDescription(
        "trecho literal que traz o ano (capa, ato de aprovação); sem ele, o PPC fica pendente, fora da base",
      ),
      Flag.optional,
    ),
    fonteAno: Flag.String("fonte-ano").pipe(
      Flag.withMetavar("texto|url"),
      Flag.withDescription('onde está o trecho: "texto" (no PPC convertido, o padrão) ou a URL https da fonte'),
      Flag.withDefault("texto"),
    ),
    reconverter: Flag.Boolean("reconverter").pipe(
      Flag.withDescription(
        "reconverte o PPC vigente (o mesmo documento) e grava por cima dele; sem a opção, o PPC entra como versão nova",
      ),
      Flag.withDefault(false),
    ),
  },
  Effect.fn("importar_ppc_pdf")(function* ({ curso, arquivoPdf, fonteUrl, ano, evidencia, fonteAno, reconverter }) {
    const resultado = yield* importarPpcPdf({
      caminhos: criarCaminhos(),
      curso,
      arquivoPdf,
      fonteUrl,
      ano: Option.getOrUndefined(ano),
      evidencia: Option.getOrUndefined(evidencia),
      fonteAno,
      reconverter,
      agora: DateTime.toDateUtc(yield* DateTime.now),
      conversor: yield* conversorAtual(undefined, "pdf"),
    });
    const alvo = resultado.id === null ? resultado.markdownPath : `${resultado.id.replace(/^ppc:/u, "")}`;
    for (const linha of relatorio(resultado, passosSeguintes(alvo))) yield* Console.log(linha);
  }),
).pipe(
  Command.withDescription(
    "Converte o PDF do PPC (títulos, tabelas, sem cabeçalhos e rodapés de página), aplica a limpeza " +
      "determinística e, com --ano e --evidencia, grava como versão nova em " +
      "institucional/ifpr/ppcs/<campus_id>/<curso_slug>/<ano>.md, como o importar_ppc_docx.ts. O texto ainda " +
      "passa pela revisão com IA (skill revisar-conversao-ppc) antes do commit. Não regenera os índices.",
  ),
);

if (import.meta.main) {
  executarPrincipal("importar_ppc_pdf", Command.run(comando, { version: "1.0.0" }));
}
