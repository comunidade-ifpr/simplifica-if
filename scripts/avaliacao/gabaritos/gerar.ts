/**
 * Gera os gabaritos de conjunto e os universos em `avaliacao/gabaritos/`.
 *
 *   node scripts/avaliacao/gabaritos/gerar.ts              # grava os arquivos
 *   node scripts/avaliacao/gabaritos/gerar.ts --verificar  # só confere (sai com 1 se divergir; --check é sinônimo)
 *
 * Rode depois de mudar os registros de institucional/ifpr/, normas, CNCT, PPCs convertidos ou os geradores, e
 * revise o diff: ele é a mudança do gabarito.
 */
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import { executarPrincipal, sairCom } from "../../principal.ts";
import { DIR_AVALIACAO, validar } from "../carregar.ts";
import { esquemaGabaritoConjunto, esquemaUniversos } from "../esquema.ts";
import { serializarJson } from "../normalizar.ts";
import { ARQUIVO_UNIVERSOS, GERADORES, gerarUniversos } from "./conjuntos.ts";
import { carregarFontes, type Fontes } from "./fontes.ts";

export const DIR_GABARITOS = `${DIR_AVALIACAO}/gabaritos`;

/** Conteúdo serializado de cada arquivo gerado, por nome; o gerado passa pelo mesmo schema da leitura. */
export function gerarArquivos(fontes: Fontes): Map<string, string> {
  const arquivos = new Map<string, string>();
  arquivos.set(ARQUIVO_UNIVERSOS, serializarJson(validar(esquemaUniversos, gerarUniversos(fontes), ARQUIVO_UNIVERSOS)));
  for (const [nome, gerador] of Object.entries(GERADORES)) {
    arquivos.set(nome, serializarJson(validar(esquemaGabaritoConjunto, gerador(fontes), nome)));
  }
  return arquivos;
}

/** Nomes dos arquivos ausentes ou diferentes do que os geradores produzem hoje. */
export const divergencias = Effect.fn("Gabaritos.divergencias")(function* (
  arquivos: ReadonlyMap<string, string>,
  dir: string = DIR_GABARITOS,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const diferentes: string[] = [];
  for (const [nome, conteudo] of arquivos) {
    const caminho = path.join(dir, nome);
    const existe = yield* fs.exists(caminho);
    if (!existe || (yield* fs.readFileString(caminho)) !== conteudo) diferentes.push(nome);
  }
  return diferentes;
});

const gerar = Command.make(
  "gerar",
  {
    verificar: Flag.Boolean("verificar").pipe(
      Flag.withAlias("check"),
      Flag.withDescription("só confere: sai com 1 se algum arquivo divergir, sem gravar"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn("Gabaritos.gerar")(function* ({ verificar }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    // Os geradores leem as fontes do checkout de forma síncrona; uma falha ali é defeito (pilha no stderr).
    const arquivos = yield* Effect.sync(() => gerarArquivos(carregarFontes()));
    const diferentes = yield* divergencias(arquivos);
    if (verificar) {
      if (diferentes.length > 0) {
        yield* Console.error(`Gabaritos desatualizados: ${diferentes.join(", ")}`);
        yield* Console.error("Rode node scripts/avaliacao/gabaritos/gerar.ts e revise o diff.");
        return yield* sairCom(1);
      }
      return yield* Console.log(`${arquivos.size} gabaritos conferidos.`);
    }
    yield* fs.makeDirectory(DIR_GABARITOS, { recursive: true });
    for (const [nome, conteudo] of arquivos) yield* fs.writeFileString(path.join(DIR_GABARITOS, nome), conteudo);
    yield* Console.log(`${arquivos.size} arquivos em avaliacao/gabaritos/ (${diferentes.length} alterados).`);
  }),
).pipe(Command.withDescription("Gera (ou confere) os gabaritos de conjunto e os universos em avaliacao/gabaritos/."));

if (import.meta.main) {
  executarPrincipal("gerar", Command.run(gerar, { version: "1" }));
}
