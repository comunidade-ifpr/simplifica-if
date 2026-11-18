/**
 * Publicação do relatório no Surge.
 *
 * Só chama a CLI `surge` (por padrão `npx --yes surge`; o ponto de entrada troca o comando pelo de
 * `REVISAR_PPC_SURGE_CMD`) com a pasta do site e o domínio, e confere a saída. O processo sobe pelo
 * `ChildProcessSpawner` e a pasta é montada pelo `FileSystem`.
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { search } from "@simplifica-if/kb/primitivas/regex";
import { asciiNfkd, casefold } from "@simplifica-if/kb/primitivas/texto";
import { aparar, apararCaracteres } from "@simplifica-if/kb/texto";

/**
 * A CLI do Surge não publicou. A saída completa (que pode trazer e-mail e token da conta) fica em
 * `cause` e, quando a CLI falha ou não confirma, no log `surge-erro.log`; a mensagem diz o que
 * houve, o código de saída, as últimas linhas do stderr com os e-mails mascarados e o caminho do
 * log.
 */
export class ErroPublicacaoSurge extends Schema.TaggedError<ErroPublicacaoSurge>()("ErroPublicacaoSurge", {
  categoria: Schema.Literals(["nao-iniciou", "falhou", "pediu-login", "sem-confirmacao"]),
  codigo: Schema.optional(Schema.Number),
  /** Código do erro do sistema quando a CLI não pôde ser executada (`ENOENT`). */
  codigoSistema: Schema.optional(Schema.String),
  /** Últimas linhas do stderr, com os e-mails mascarados. */
  ultimasLinhas: Schema.optional(Schema.Array(Schema.String)),
  /** Arquivo com a saída completa da CLI, quando foi gravado. */
  log: Schema.optional(Schema.String),
  cause: Schema.Defect(),
}) {
  override get message(): string {
    switch (this.categoria) {
      case "nao-iniciou":
        return (
          "Falha ao publicar relatório no Surge: o comando da CLI não pôde ser executado" +
          (this.codigoSistema ? ` (${this.codigoSistema}).` : ".")
        );
      case "falhou":
        return `Falha ao publicar relatório no Surge: a CLI terminou com o código ${this.codigo}.` + this.detalhes();
      case "pediu-login":
        return (
          "Falha ao publicar relatório no Surge: a CLI solicitou autenticação interativa. " +
          "Execute `npx surge login` ou configure credenciais de automação do Surge no ambiente."
        );
      case "sem-confirmacao":
        return "Surge não retornou confirmação de publicação reconhecível." + this.detalhes();
    }
  }

  private detalhes(): string {
    const linhas = this.ultimasLinhas?.length
      ? `\nÚltimas linhas do stderr:\n${this.ultimasLinhas.map((linha) => `  ${linha}`).join("\n")}`
      : "";
    return linhas + (this.log ? `\nSaída completa em ${this.log}.` : "");
  }
}

/** E-mail na saída da CLI (a conta do Surge), trocado por um marcador na mensagem. */
const RE_EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

/** Últimas `quantas` linhas não vazias de `texto`, com os e-mails mascarados. */
export function ultimasLinhasMascaradas(texto: string, quantas = 3): string[] {
  return texto
    .split("\n")
    .map((linha) => aparar(linha))
    .filter(Boolean)
    .slice(-quantas)
    .map((linha) => linha.replace(RE_EMAIL, "[e-mail omitido]"));
}

/** Código do erro do sistema (`ENOENT`, `EACCES`) na causa de uma falha ao iniciar o processo. */
function codigoDoSistema(causa: unknown): string | undefined {
  return Predicate.hasProperty(causa, "code") && typeof causa.code === "string" ? causa.code : undefined;
}

export const ehErroPublicacaoSurge = Schema.is(ErroPublicacaoSurge);

function slug(valor: string, limite = 48): string {
  const ascii = asciiNfkd(valor).toLowerCase();
  const completo = apararCaracteres(ascii.replace(/[^a-z0-9]+/g, "-"), "-");
  let resultado = apararCaracteres((completo || "relatorio").slice(0, limite), "-");
  if (completo.length > limite && resultado.includes("-")) {
    const corte = resultado.lastIndexOf("-");
    if (resultado.length - corte - 1 < 3) resultado = resultado.slice(0, corte);
  }
  return resultado || "relatorio";
}

/** Domínio padrão: `revisar-ppc-<slug do nome da pasta da rodada>.surge.sh`. */
export function dominioSurgePadrao(rodadaDir: string): string {
  const nome =
    rodadaDir
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .at(-1) ?? "";
  return `revisar-ppc-${slug(nome)}.surge.sh`;
}

/** Monta a pasta publicada: `index.html` (cópia do relatório) e `assets/`, recriada do zero. */
export const prepararSiteSurge = Effect.fn("publicar_surge.prepararSiteSurge")(function* (
  relatorioHtml: string,
  destinoDir: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.remove(destinoDir, { recursive: true, force: true });
  yield* fs.makeDirectory(destinoDir, { recursive: true });
  yield* fs.copyFile(relatorioHtml, path.join(destinoDir, "index.html"));
  const assetsOrigem = path.join(path.dirname(relatorioHtml), "assets");
  if (yield* fs.exists(assetsOrigem)) yield* fs.copy(assetsOrigem, path.join(destinoDir, "assets"));
  return destinoDir;
});

const COMANDO_SURGE = ["npx", "--yes", "surge"] as const;

function normalizarUrl(dominio: string): string {
  let valor = aparar(dominio);
  while (valor.endsWith("/")) valor = valor.slice(0, -1);
  return /^https?:\/\//i.test(valor) ? valor : `https://${valor}`;
}

export type PublicacaoSurge = {
  servico: string;
  site_dir: string;
  domain: string;
  public_url: string;
  stdout: string;
  stderr: string;
  relatorio_html_original?: string;
};

/** Saída do processo em texto, com quebras de linha universais e sem os brancos das pontas. */
const textoDoProcesso = <E>(fluxo: Stream.Stream<Uint8Array, E>) =>
  fluxo.pipe(
    Stream.decodeText,
    Stream.mkString,
    Effect.map((texto) => aparar(texto.replace(/\r\n?/g, "\n"))),
  );

/**
 * Publica `siteDir` no Surge em `dominio`, com `comando` (padrão `npx --yes surge`); falha com
 * `ErroPublicacaoSurge` se a CLI não rodar, pedir login, falhar ou não confirmar. Nos dois últimos
 * casos, a saída completa vai para `logErro` (padrão: `surge-erro.log` ao lado de `siteDir`, que é
 * `arquivos-suporte/` na rodada).
 */
export const publicarSiteSurge = Effect.fn("publicar_surge.publicarSiteSurge")(function* (
  siteDir: string,
  dominio: string,
  comando: ReadonlyArray<string> = COMANDO_SURGE,
  logErro?: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const site = yield* fs.realPath(path.resolve(siteDir));
  const [executavel, ...argumentos] = comando.length ? comando : COMANDO_SURGE;
  const { codigo, stdout, stderr } = yield* Effect.scoped(
    Effect.gen(function* () {
      const processo = yield* spawner.spawn(
        ChildProcess.make(executavel!, [...argumentos, site, dominio], { stdin: "ignore" }),
      );
      const [saiu, saida, erros] = yield* Effect.all(
        [processo.exitCode, textoDoProcesso(processo.stdout), textoDoProcesso(processo.stderr)],
        { concurrency: 3 },
      );
      return { codigo: Number(saiu), stdout: saida, stderr: erros };
    }),
  ).pipe(
    Effect.mapError(
      (cause) =>
        new ErroPublicacaoSurge({ categoria: "nao-iniciou", codigoSistema: codigoDoSistema(cause.cause), cause }),
    ),
  );

  const saida = [stdout, stderr].filter(Boolean).join("\n");
  // O pedido de login vem antes do código: a CLI sem login também termina com código diferente de 0.
  if (search("\\bLogin or create surge account\\b|\\bemail:\\s*$", saida, { ignoreCase: true })) {
    return yield* new ErroPublicacaoSurge({ categoria: "pediu-login", codigo, cause: { stdout, stderr } });
  }
  const falha = Effect.fnUntraced(function* (categoria: "falhou" | "sem-confirmacao") {
    const arquivo = logErro ?? path.join(path.dirname(site), "surge-erro.log");
    const conteudo = `$ ${[executavel, ...argumentos, site, dominio].join(" ")}\ncódigo de saída: ${codigo}\n\n--- stdout\n${stdout}\n\n--- stderr\n${stderr}\n`;
    // Sem o log, o erro ainda sai, só sem o caminho.
    const log = yield* fs.writeFileString(arquivo, conteudo).pipe(
      Effect.as(arquivo),
      Effect.orElseSucceed(() => undefined),
    );
    return yield* new ErroPublicacaoSurge({
      categoria,
      codigo,
      ultimasLinhas: ultimasLinhasMascaradas(stderr),
      log,
      cause: { stdout, stderr },
    });
  });
  if (codigo !== 0) return yield* falha("falhou");
  if (!casefold(saida).includes("success")) return yield* falha("sem-confirmacao");
  const publicacao: PublicacaoSurge = {
    servico: "surge",
    site_dir: site,
    domain: dominio,
    public_url: normalizarUrl(dominio),
    stdout,
    stderr,
  };
  return publicacao;
});
