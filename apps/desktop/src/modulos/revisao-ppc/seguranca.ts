// @effect-diagnostics nodeBuiltinImport:off -- processo principal do Electron, sem runtime Effect (ver README)
/**
 * As regras de segurança da ponte do desktop no módulo `revisao-ppc`, sem o Electron (os testes as
 * conferem com o Node): o `.docx` que a pessoa escolheu e a cópia comentada que o servidor gravou ao lado
 * dele. A ponte fica estreita, por caso de uso: só abre o que o servidor gravou, ao lado de um arquivo que
 * a pessoa escolheu nesta execução, com o sufixo do app (`SUFIXO_REVISAO_PREVIA`).
 */
import * as NodePath from "node:path";
import { SUFIXO_REVISAO_PREVIA } from "@simplifica-if/contratos-app/ponte";

/**
 * Um `.docx` escolhido no diálogo do sistema (`escolherDocx`) ou solto na área de soltar (`soltarDocx`);
 * `undefined` para outro arquivo e para o `File` sem caminho (`""`).
 */
export function docxEscolhido(caminho: unknown): string | undefined {
  if (typeof caminho !== "string" || !NodePath.isAbsolute(caminho)) return undefined;
  return NodePath.extname(caminho).toLowerCase() === ".docx" ? NodePath.normalize(caminho) : undefined;
}

/**
 * A cópia comentada que o servidor gravou para um dos `.docx` escolhidos ou soltos nesta execução: na
 * mesma pasta, `<nome> - revisão prévia (Simplifica IF) <data e hora>.docx` (cada revisão tem a sua) ou,
 * com o nome ocupado, com ` (2)` a ` (99)` (o servidor usa até ` (20)`). Só esses arquivos "Abrir o documento
 * comentado" e "Mostrar na pasta" aceitam: a interface não abre outro arquivo do computador por esse
 * caminho. Quem chama confere ainda que é arquivo comum (não link).
 */
export function copiaComentadaPermitida(caminho: unknown, escolhidos: ReadonlySet<string>): string | undefined {
  if (typeof caminho !== "string" || !NodePath.isAbsolute(caminho)) return undefined;
  if (NodePath.normalize(caminho) !== caminho) return undefined;
  const pasta = NodePath.dirname(caminho);
  const nome = NodePath.basename(caminho);
  for (const escolhido of escolhidos) {
    if (NodePath.dirname(escolhido) !== pasta) continue;
    const prefixo = NodePath.basename(escolhido, NodePath.extname(escolhido)) + SUFIXO_REVISAO_PREVIA;
    if (!nome.startsWith(prefixo) || !nome.toLowerCase().endsWith(".docx")) continue;
    const resto = nome.slice(prefixo.length, -".docx".length);
    if (/^ \d{4}-\d{2}-\d{2} \d{2}h\d{2}( \(([2-9]|[1-9]\d)\))?$/.test(resto)) return caminho;
  }
  return undefined;
}

/**
 * O que "Abrir no Word" abre: a cópia comentada de um `.docx` escolhido (`copiaComentadaPermitida`) ou um
 * `.docx` que a pessoa escolheu ou soltou nesta execução, que a revisão acompanha no Word ("Acompanhar no
 * Word" com outro arquivo, ou o acompanhado escolhido de novo depois de fechar o app).
 */
export function documentoPermitido(caminho: unknown, escolhidos: ReadonlySet<string>): string | undefined {
  const copia = copiaComentadaPermitida(caminho, escolhidos);
  if (copia !== undefined) return copia;
  return typeof caminho === "string" && escolhidos.has(caminho) && NodePath.normalize(caminho) === caminho
    ? caminho
    : undefined;
}
