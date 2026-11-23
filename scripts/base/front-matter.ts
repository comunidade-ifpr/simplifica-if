/**
 * Front matter das normas e onde cada norma fica. O parser (YAML `failsafe` + Effect Schema) e o
 * contrato (`esquemaNorma`) ficam em `@simplifica-if/kb/normas/front-matter`.
 */
import { type CaminhosBase, listarRecursivo } from "./caminhos.ts";
import {
  analisarFrontMatter,
  ehErroFrontMatter,
  ErroFrontMatter,
  type FrontMatter,
} from "@simplifica-if/kb/normas/front-matter";
import { ordenarCaminhos } from "@simplifica-if/kb/texto";

export { analisarFrontMatter, ehErroFrontMatter, ErroFrontMatter, type FrontMatter };

/** Diretório esperado por `jurisdicao|tipo_documento`. */
export const DIRETORIOS_POR_TIPO: Record<string, string> = {
  "BR|Lei": "normas/br/leis",
  "BR|Decreto-Lei": "normas/br/decretos-lei",
  "BR|Portaria": "normas/br/portarias",
  "BR|Resolução": "normas/br/resolucoes",
  "BR|Parecer": "normas/br/pareceres",
  "IFPR|Resolução": "normas/ifpr/resolucoes",
  "IFPR|Portaria": "normas/ifpr/portarias",
  "IFPR|Nota Técnica": "normas/ifpr/notas-tecnicas",
};

export function arquivosNormas(caminhos: CaminhosBase): string[] {
  return ordenarCaminhos(listarRecursivo(caminhos.normas, ".md"));
}
