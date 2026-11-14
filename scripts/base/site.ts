// @effect-diagnostics nodeBuiltinImport:off -- copia base-conhecimento/ para site/ com node:fs síncrono, num script de execução única (gerar_site)
/** Saída publicável em site/: cópia de base-conhecimento/ sem arquivos locais. */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { compararTexto } from "@simplifica-if/kb/texto";

const NOMES_IGNORADOS = new Set([".DS_Store", "__pycache__", ".pytest_cache"]);
/** Nomes ignorados por `filecmp.dircmp` na comparação (DEFAULT_IGNORES do Python). */
const NOMES_IGNORADOS_COMPARACAO = new Set(["RCS", "CVS", "tags", ".git", ".hg", ".bzr", "_darcs", "__pycache__"]);

export function ignorarNaCopia(nome: string): boolean {
  return NOMES_IGNORADOS.has(nome) || nome.endsWith(".pyc");
}

function caminhoReal(caminho: string): string {
  try {
    return NodeFS.realpathSync(caminho);
  } catch {
    return NodePath.resolve(caminho);
  }
}

/** Copia a árvore seguindo links simbólicos e preservando datas de modificação (como `shutil.copytree`). */
function copiarArvore(origem: string, destino: string): void {
  NodeFS.mkdirSync(destino, { recursive: true });
  for (const nome of NodeFS.readdirSync(origem)) {
    if (ignorarNaCopia(nome)) continue;
    const de = NodePath.join(origem, nome);
    const para = NodePath.join(destino, nome);
    const info = NodeFS.statSync(de);
    if (info.isDirectory()) {
      copiarArvore(de, para);
    } else {
      NodeFS.copyFileSync(de, para);
      NodeFS.utimesSync(para, info.atime, info.mtime);
    }
  }
  const info = NodeFS.statSync(origem);
  NodeFS.utimesSync(destino, info.atime, info.mtime);
}

export function renderizarSite(raizBase: string, destino: string): void {
  if (!NodeFS.existsSync(raizBase)) throw new Error(`Diretório da base não encontrado: ${raizBase}`);
  if (caminhoReal(destino) === caminhoReal(raizBase)) {
    throw new Error("Destino do site não pode ser o mesmo diretório da base");
  }
  if (NodeFS.existsSync(destino)) NodeFS.rmSync(destino, { recursive: true, force: true });
  copiarArvore(raizBase, destino);
}

function listar(diretorio: string): string[] {
  return NodeFS.readdirSync(diretorio)
    .filter((nome) => !NOMES_IGNORADOS_COMPARACAO.has(nome))
    .sort(compararTexto);
}

function tipoEntrada(caminho: string): "dir" | "arquivo" | "outro" {
  try {
    const info = NodeFS.statSync(caminho);
    if (info.isDirectory()) return "dir";
    return info.isFile() ? "arquivo" : "outro";
  } catch {
    return "outro";
  }
}

function conteudoIgual(a: string, b: string): boolean {
  if (NodeFS.statSync(a).size !== NodeFS.statSync(b).size) return false;
  return NodeFS.readFileSync(a).equals(NodeFS.readFileSync(b));
}

/**
 * Compara o site esperado com o atual, com as mesmas mensagens de `filecmp.dircmp`
 * usadas pelo script Python. Diferente do Python, compara sempre o conteúdo
 * (não confia em tamanho + mtime) e acusa entrada que é diretório num lado e
 * arquivo no outro.
 */
export function compararDiretorios(esperado: string, atual: string): string[] {
  const erros: string[] = [];
  const nomesEsperados = listar(esperado);
  const nomesAtuais = listar(atual);
  const atuais = new Set(nomesAtuais);
  const esperados = new Set(nomesEsperados);
  for (const nome of nomesEsperados) if (!atuais.has(nome)) erros.push(`ausente em site/: ${nome}`);
  for (const nome of nomesAtuais) if (!esperados.has(nome)) erros.push(`extra em site/: ${nome}`);

  const comuns = nomesEsperados.filter((nome) => atuais.has(nome));
  const subdiretorios: string[] = [];
  for (const nome of comuns) {
    const tipoA = tipoEntrada(NodePath.join(esperado, nome));
    const tipoB = tipoEntrada(NodePath.join(atual, nome));
    if (tipoA === "dir" && tipoB === "dir") subdiretorios.push(nome);
    else if (tipoA !== tipoB) erros.push(`conteúdo divergente: ${nome}`);
    else if (tipoA === "arquivo" && !conteudoIgual(NodePath.join(esperado, nome), NodePath.join(atual, nome))) {
      erros.push(`conteúdo divergente: ${nome}`);
    }
  }
  for (const nome of subdiretorios) {
    for (const erro of compararDiretorios(NodePath.join(esperado, nome), NodePath.join(atual, nome))) {
      erros.push(`${nome}/${erro}`);
    }
  }
  return erros;
}
