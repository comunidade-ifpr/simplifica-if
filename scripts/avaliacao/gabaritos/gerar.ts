/**
 * Gera os gabaritos de conjunto e os universos em `avaliacao/gabaritos/`.
 *
 *   node scripts/avaliacao/gabaritos/gerar.ts              # grava os arquivos
 *   node scripts/avaliacao/gabaritos/gerar.ts --verificar  # só confere (sai com 1 se divergir; --check é sinônimo)
 *
 * Rode depois de mudar dados/institucional/, normas, CNCT, PPCs convertidos ou os geradores, e
 * revise o diff: ele é a mudança do gabarito.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { serializarJson } from "../normalizar.ts";
import { esquemaGabaritoConjunto, esquemaUniversos } from "../esquema.ts";
import { ARQUIVO_UNIVERSOS, GERADORES, gerarUniversos } from "./conjuntos.ts";
import { carregarFontes, RAIZ_REPOSITORIO, type Fontes } from "./fontes.ts";

export const DIR_GABARITOS = NodePath.join(RAIZ_REPOSITORIO, "avaliacao", "gabaritos");

/** Conteúdo serializado de cada arquivo gerado, por nome. */
export function gerarArquivos(fontes: Fontes): Map<string, string> {
  const arquivos = new Map<string, string>();
  arquivos.set(ARQUIVO_UNIVERSOS, serializarJson(esquemaUniversos.parse(gerarUniversos(fontes))));
  for (const [nome, gerador] of Object.entries(GERADORES)) {
    arquivos.set(nome, serializarJson(esquemaGabaritoConjunto.parse(gerador(fontes))));
  }
  return arquivos;
}

/** Nomes dos arquivos ausentes ou diferentes do que os geradores produzem hoje. */
export function divergencias(arquivos: Map<string, string>, dir: string = DIR_GABARITOS): string[] {
  return [...arquivos.entries()]
    .filter(([nome, conteudo]) => {
      const caminho = NodePath.join(dir, nome);
      return !NodeFS.existsSync(caminho) || NodeFS.readFileSync(caminho, "utf-8") !== conteudo;
    })
    .map(([nome]) => nome);
}

if (import.meta.main) {
  const verificar = process.argv.includes("--verificar") || process.argv.includes("--check");
  const arquivos = gerarArquivos(carregarFontes());
  const diferentes = divergencias(arquivos);
  if (verificar) {
    if (diferentes.length > 0) {
      console.error(`Gabaritos desatualizados: ${diferentes.join(", ")}`);
      console.error("Rode node scripts/avaliacao/gabaritos/gerar.ts e revise o diff.");
      process.exit(1);
    }
    console.log(`${arquivos.size} gabaritos conferidos.`);
  } else {
    NodeFS.mkdirSync(DIR_GABARITOS, { recursive: true });
    for (const [nome, conteudo] of arquivos) NodeFS.writeFileSync(NodePath.join(DIR_GABARITOS, nome), conteudo);
    console.log(`${arquivos.size} arquivos em avaliacao/gabaritos/ (${diferentes.length} alterados).`);
  }
}
