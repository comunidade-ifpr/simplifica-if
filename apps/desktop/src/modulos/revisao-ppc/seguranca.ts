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
 * mesma pasta, `<nome> - revisão prévia (Simplifica IF).docx` ou, se ela estava travada ou foi editada
 * pela pessoa, com ` (2)` a ` (99)` (o servidor usa até ` (20)`). Só esses arquivos "Abrir o documento
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
    if (resto === "" || /^ \(([2-9]|[1-9]\d)\)$/.test(resto)) return caminho;
  }
  return undefined;
}
