// @effect-diagnostics nodeBuiltinImport:off -- processo principal do Electron, sem runtime Effect (ver README)
/**
 * As regras de segurança da ponte do desktop no módulo `revisao-ppc`, sem o Electron (os testes as
 * conferem com o Node): o `.docx` que a pessoa escolheu (nesta execução ou numa revisão ativa no banco)
 * e a cópia comentada que o servidor gravou ao lado dele. A ponte fica estreita, por caso de uso: só abre
 * a cópia comentada de um original autorizado (`SUFIXO_REVISAO_PREVIA`) ou o documento acompanhado de uma
 * revisão ativa.
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
 * A cópia comentada que o servidor gravou para um dos `.docx` originais autorizados: na mesma pasta,
 * `<nome> - revisão prévia (Simplifica IF) <data e hora>.docx` (cada revisão tem a sua) ou, com o nome
 * ocupado, com ` (2)` a ` (99)` (o servidor usa até ` (20)`). Só esses arquivos "Mostrar na pasta" aceita:
 * a interface não abre outro arquivo do computador por esse caminho. Quem chama confere ainda que é
 * arquivo comum (não link).
 */
export function copiaComentadaPermitida(caminho: unknown, originais: ReadonlySet<string>): string | undefined {
  if (typeof caminho !== "string" || !NodePath.isAbsolute(caminho)) return undefined;
  if (NodePath.normalize(caminho) !== caminho) return undefined;
  const pasta = NodePath.dirname(caminho);
  const nome = NodePath.basename(caminho);
  for (const escolhido of originais) {
    if (NodePath.dirname(escolhido) !== pasta) continue;
    const prefixo = NodePath.basename(escolhido, NodePath.extname(escolhido)) + SUFIXO_REVISAO_PREVIA;
    if (!nome.startsWith(prefixo) || !nome.toLowerCase().endsWith(".docx")) continue;
    const resto = nome.slice(prefixo.length, -".docx".length);
    if (/^ \d{4}-\d{2}-\d{2} \d{2}h\d{2}( \(([2-9]|[1-9]\d)\))?$/.test(resto)) return caminho;
  }
  return undefined;
}

/**
 * O que "Abrir no Word" abre: a cópia comentada de um `.docx` original (`copiaComentadaPermitida`), um
 * `.docx` original escolhido/solto, ou o `.docx` acompanhado de uma revisão ativa (`acompanhados`, que
 * não entra como raiz de padrão de cópia comentada).
 */
export function documentoPermitido(
  caminho: unknown,
  originais: ReadonlySet<string>,
  acompanhados: ReadonlySet<string> = new Set(),
): string | undefined {
  const copia = copiaComentadaPermitida(caminho, originais);
  if (copia !== undefined) return copia;
  if (typeof caminho !== "string" || NodePath.normalize(caminho) !== caminho) return undefined;
  return originais.has(caminho) || acompanhados.has(caminho) ? caminho : undefined;
}

/** Os caminhos `.docx` devolvidos por `GET /arquivos/liberados`, separados por papel e validados. */
export interface CaminhosDoServidor {
  readonly originais: ReadonlyArray<string>;
  readonly acompanhados: ReadonlyArray<string>;
}

/**
 * Valida e normaliza a resposta de `GET /arquivos/liberados`: só caminhos absolutos `.docx`, ignorando
 * entradas inválidas, relativas ou de outras extensões.
 */
export function caminhosDoServidor(dados: unknown): CaminhosDoServidor {
  const filtrar = (valor: unknown): ReadonlyArray<string> => {
    if (!Array.isArray(valor)) return [];
    const saida = new Set<string>();
    for (const item of valor) {
      const valido = docxEscolhido(item);
      if (valido !== undefined) saida.add(valido);
    }
    return [...saida];
  };
  if (typeof dados !== "object" || dados === null) return { originais: [], acompanhados: [] };
  const obj = dados as { originais?: unknown; acompanhados?: unknown };
  return { originais: filtrar(obj.originais), acompanhados: filtrar(obj.acompanhados) };
}
