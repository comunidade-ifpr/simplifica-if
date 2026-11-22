/**
 * O nome de uma página do Explorar pelo link `ifpr://`, para o pedido "Perguntar à IA sobre isto" e o
 * título da janela: o nome do índice quando há (curso, PPC, campus, CNCT), senão o nome curto do link
 * (normas, dispositivos e critérios da revisão, como nos chips da conversa).
 */
import type { DadosIndice } from "@simplifica-if/contratos-app";
import { nomeCurtoLink } from "../tarefas/textos.ts";

export function nomeDaPagina(link: string, indice: DadosIndice | undefined): string {
  const m = /^ifpr:\/\/([a-z]+)\/([^#]+)(?:#(.+))?$/i.exec(link);
  if (m === null || indice === undefined) return nomeCurtoLink(link);
  const [, tipo, caminho, fragmento] = m as unknown as [string, string, string, string | undefined];
  switch (tipo) {
    case "curso": {
      const c = indice.cursos.find((x) => x.id === caminho);
      return c ? `o curso ${c.nome}, Campus ${c.campus_nome}` : nomeCurtoLink(link);
    }
    case "ppc": {
      const p = indice.ppcs.find((x) => x.chave === caminho);
      if (!p) return nomeCurtoLink(link);
      return fragmento
        ? `${nomeCurtoLink(link).split(", ").slice(1).join(", ")} do PPC de ${p.nome}, Campus ${p.campus_nome}`
        : `o PPC de ${p.nome}, Campus ${p.campus_nome}`;
    }
    case "campus": {
      const c = indice.campi.find((x) => x.id === caminho);
      return c ? `o Campus ${c.nome}` : nomeCurtoLink(link);
    }
    case "cnct": {
      const c = indice.cnct.find((x) => x.slug === caminho);
      return c ? `${c.denominacao} no Catálogo Nacional de Cursos Técnicos` : nomeCurtoLink(link);
    }
    default:
      return nomeCurtoLink(link);
  }
}
