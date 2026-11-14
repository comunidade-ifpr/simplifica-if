/**
 * Texto Markdown compacto que a IA lê no `content` (especificação M0.1, "Texto para a IA"):
 *
 * 1. os avisos, em linhas que começam com "Atenção:";
 * 2. os itens: título com o link `ifpr://`, o texto literal em citação (`>`) e a linha
 *    "fonte: `<path>:<linha_inicio>-<linha_fim>`";
 * 3. a última linha: "Base de 13/11/2026 (commit `dc6b447`)." ou "(versão dev)." sem commit.
 *
 * Cada ferramenta escreve só o corpo; `montarTexto` acrescenta avisos, paginação e rodapé.
 */
import type { Aviso, Base, Fonte, Pagina, Resposta } from "./contratos.ts";

/** `2026-11-13` → `13/11/2026` (por texto, sem fuso horário). */
export function dataBr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

export function rodape(base: Base): string {
  const origem = base.commit ? `commit \`${base.commit.slice(0, 7)}\`` : "versão dev";
  return `Base de ${dataBr(base.data_referencia)} (${origem}).`;
}

export function linhaAviso(aviso: Aviso): string {
  return `Atenção: ${aviso.mensagem}${aviso.ref ? ` (\`${aviso.ref}\`)` : ""}`;
}

/** Texto literal em citação Markdown, linha a linha. */
export function citacao(texto: string): string {
  return texto
    .split("\n")
    .map((linha) => (linha.trim() === "" ? ">" : `> ${linha}`))
    .join("\n");
}

export function linhaFonte(fonte: Fonte): string {
  return `fonte: \`${fonte.path}:${fonte.linha_inicio}-${fonte.linha_fim}\``;
}

/** `[título](ifpr://…)`, com colchetes do título escapados. */
export function comLink(titulo: string, link: string): string {
  return `[${titulo.replace(/[[\]]/g, (c) => `\\${c}`)}](${link})`;
}

export interface ItemTexto {
  titulo: string;
  link?: string;
  /** Linha curta depois do título (situação, vigência, tipo). */
  detalhe?: string;
  literal?: string;
  fonte?: Fonte;
}

export function blocoItem(item: ItemTexto): string {
  const cabecalho = `**${item.link ? comLink(item.titulo, item.link) : item.titulo}**`;
  const linhas = [item.detalhe ? `${cabecalho} — ${item.detalhe}` : cabecalho];
  if (item.literal !== undefined) linhas.push(citacao(item.literal));
  if (item.fonte) linhas.push(linhaFonte(item.fonte));
  return linhas.join("\n");
}

export function linhaPagina(pagina: Pagina): string | null {
  if (!pagina.cursor) return null;
  return `Mostrando ${pagina.devolvidos} de ${pagina.total}. Para continuar, chame de novo com os mesmos filtros e \`cursor: "${pagina.cursor}"\`.`;
}

/** Junta avisos, corpo, paginação e rodapé, separados por linha em branco. */
export function montarTexto(resposta: Resposta<unknown>, corpo: string): string {
  const partes: string[] = [];
  if (resposta.avisos.length > 0) partes.push(resposta.avisos.map(linhaAviso).join("\n"));
  if (corpo.trim() !== "") partes.push(corpo.trim());
  const pagina = resposta.pagina ? linhaPagina(resposta.pagina) : null;
  if (pagina) partes.push(pagina);
  partes.push(rodape(resposta.base));
  return partes.join("\n\n");
}
