#!/usr/bin/env node
/** Leva um PPC novo (ou a versão nova do PPC de um curso) do DOCX da coordenação para a base. */
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Argument from "effect/cli/Argument";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import * as Schema from "effect/Schema";
import { ROTULOS_PESSOAIS } from "@simplifica-if/kb/ppcs/dados-pessoais";
import { criarCaminhos } from "./base/caminhos.ts";
import { importarPpcDocx, type ResultadoImportacao } from "./base/importar-ppc.ts";
import { RAIZ_PROJETO } from "./config.ts";
import * as Git from "./git.ts";
import { executarPrincipal } from "./principal.ts";

const PASSOS_SEGUINTES = ["node scripts/gerar_base.ts", "node scripts/validar_base.ts"];

/**
 * Pastas de dados e de saída, que não mudam o texto convertido: alteração nelas não marca o conversor.
 * Arquivo não rastreado também não conta: o próprio DOCX de entrada pode estar no checkout.
 */
const FORA_DO_CONVERSOR = ["base-conhecimento", "tmp", "outputs"];

/** O git não achou um checkout em `raiz`: sem o commit, a versão do conversor não tem como ser registrada. */
export class ForaDeCheckout extends Schema.TaggedError<ForaDeCheckout>()("ForaDeCheckout", {
  raiz: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return (
      `${this.raiz} não é um checkout git do Simplifica IF: a importação registra o commit do conversor ` +
      "e só roda num clone do repositório, com o git instalado"
    );
  }
}

/**
 * Conversor e versão: o pacote e o commit do checkout, com `-modificado` quando há alteração não
 * comitada em arquivo rastreado fora de `FORA_DO_CONVERSOR`. A saída depende de `packages/ppc`
 * (ou `packages/pdf`), `packages/docx` e `packages/kb` (front matter, dados pessoais), de `scripts/base/importar-ppc.ts`,
 * `scripts/dados/urls.ts` e deste script; olhar o checkout inteiro não deixa nenhum de fora.
 */
export const conversorAtual = Effect.fn("importar_ppc_docx.conversorAtual")(function* (
  raiz: string = RAIZ_PROJETO,
  pacote: "ppc" | "pdf" = "ppc",
) {
  const git = (...args: string[]) =>
    Git.executar(args, { cwd: raiz }).pipe(
      Effect.map((saida) => saida.trim()),
      Effect.catchTags({ GitFalhou: (erro) => Effect.fail(new ForaDeCheckout({ raiz, cause: erro })) }),
    );
  const commit = yield* git("rev-parse", "HEAD");
  const fora = FORA_DO_CONVERSOR.map((pasta) => `:(exclude)${pasta}`);
  const sujo = (yield* git("status", "--porcelain", "--untracked-files=no", "--", ".", ...fora)) !== "";
  return `simplifica-if/packages/${pacote}@${commit}${sujo ? "-modificado" : ""}`;
});

export function relatorio(resultado: ResultadoImportacao, passos: ReadonlyArray<string> = PASSOS_SEGUINTES): string[] {
  const linhas =
    resultado.id === null
      ? [
          `PPC fora da base, pendente: ${resultado.markdownPath}`,
          ...resultado.pendencias.map((p) => `  pendência: ${p}`),
          "Registro do curso não muda. Complete e promova com node scripts/promover_ppc.ts (lista: pnpm pendencias).",
        ]
      : [
          `PPC gravado: base-conhecimento/${resultado.markdownPath} (${resultado.id})`,
          `Registro atualizado: base-conhecimento/${resultado.registroPath}`,
        ];
  if (resultado.substituido) {
    linhas.push(`PPC anterior fica na base, substituído: base-conhecimento/${resultado.substituido}`);
  }
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
  for (const comando of passos) linhas.push(`  ${comando}`);
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
  Effect.fn("importar_ppc_docx")(function* ({ curso, arquivoDocx, fonteUrl, ano, evidencia, fonteAno, reconverter }) {
    const resultado = yield* importarPpcDocx({
      caminhos: criarCaminhos(),
      curso,
      arquivoDocx,
      fonteUrl,
      ano: Option.getOrUndefined(ano),
      evidencia: Option.getOrUndefined(evidencia),
      fonteAno,
      reconverter,
      agora: DateTime.toDateUtc(yield* DateTime.now),
      conversor: yield* conversorAtual(),
    });
    for (const linha of relatorio(resultado)) yield* Console.log(linha);
  }),
).pipe(
  Command.withDescription(
    "Converte o DOCX do PPC e, com --ano e --evidencia, o grava como versão nova em " +
      "institucional/ifpr/ppcs/<campus_id>/<curso_slug>/<ano>.md, com front matter de proveniência registrada, sem " +
      "dados pessoais; o PPC anterior fica na base, substituído, e o registro do curso aponta a versão nova. Sem o " +
      "ano ou a evidência, o PPC fica fora da base, em curadoria/pendencias/ppcs/, com a pendência registrada. " +
      "Não regenera os índices.",
  ),
);

if (import.meta.main) {
  executarPrincipal("importar_ppc_docx", Command.run(comando, { version: "1.0.0" }));
}
