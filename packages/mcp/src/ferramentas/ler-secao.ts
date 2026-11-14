/**
 * Ferramenta 10, `ler_secao`: uma seção inteira de PPC pelo ID (`lerSecao`), com as vizinhas. Acima
 * do teto, o texto pagina por linhas: cada página termina numa linha inteira, e a `fonte` traz as
 * linhas da página.
 */
import { lerSecao as lerSecaoBanco } from "@simplifica-if/kb/db/modo-banco";
import { z } from "zod";
import { ErroEntrada, esquemaFonte, esquemaLink, type Fonte, type Pagina, responder } from "../envelope.ts";
import { lerLink, linkPpc } from "../links.ts";
import { cortar, paginarNoTeto, RESERVA_TEXTO } from "../orcamento.ts";
import { blocoItem, comLink } from "../texto.ts";
import { definirFerramenta } from "./ferramenta.ts";

export const TETO_LER_SECAO = 20000;

const entrada = z.strictObject({
  id: z
    .string()
    .trim()
    .min(3)
    .max(300)
    .describe(
      'ID da seção ("curitiba/tecnico-em-enfermagem#estagio_praticas-1"), vindo de buscar_secoes, ou o link ifpr://ppc/…#secao',
    ),
  cursor: z
    .string()
    .min(1)
    .optional()
    .describe("cursor do trecho seguinte de uma seção longa, devolvido pela chamada anterior"),
});

const dados = z.strictObject({
  secao: z.strictObject({
    id: z.string(),
    ppc: z.string(),
    curso: z.string(),
    tipo: z.string(),
    titulo: z.string(),
    /** O texto literal (numa seção longa, o trecho desta página). */
    texto: z.string(),
    fonte: esquemaFonte,
    link: esquemaLink,
  }),
  /** IDs das seções vizinhas no documento. */
  anterior: z.string().nullable(),
  proxima: z.string().nullable(),
});

function idDaSecao(valor: string): string {
  if (valor.startsWith("ifpr://")) {
    const link = lerLink(valor);
    if (!link || link.tipo !== "ppc" || link.fragmento === null) {
      throw new ErroEntrada(`id: esperava um link ifpr://ppc/campus/curso#secao, veio "${valor}"`);
    }
    return `${link.caminho}#${link.fragmento}`;
  }
  const id = valor.replace(/^ppc:/, "");
  if (!/^[A-Za-z0-9._~-]+\/[A-Za-z0-9._~-]+#[A-Za-z0-9._~-]+$/.test(id)) {
    throw new ErroEntrada(
      `id: esperava "campus/curso#secao" (como "curitiba/tecnico-em-enfermagem#estagio_praticas-1"), veio "${valor}"`,
    );
  }
  return id;
}

export const lerSecao = definirFerramenta({
  nome: "ler_secao",
  titulo: "Ler seção de PPC",
  descricao: "Lê uma seção inteira de PPC pelo ID, vindo de `buscar_secoes` ou de um link `ifpr://ppc/…#secao`.",
  entrada,
  dados,
  executar(e, { db, base }) {
    const id = idDaSecao(e.id);
    const secao = lerSecaoBanco(db, id);
    if (!secao) {
      throw new ErroEntrada(
        `seção não encontrada: "${id}". Use um ID devolvido por buscar_secoes ou pela ficha_curso (ppc.secoes)`,
      );
    }
    const linhas = secao.texto.split("\n");
    const orcamento = TETO_LER_SECAO - RESERVA_TEXTO;
    const longa = secao.texto.length > orcamento;
    let texto = secao.texto;
    let fonte: Fonte = { path: secao.path, linha_inicio: secao.linha_inicio, linha_fim: secao.linha_fim };
    let pagina: Pagina | undefined;
    if (longa || e.cursor !== undefined) {
      const recorte = paginarNoTeto(linhas, {
        limite: linhas.length,
        cursor: e.cursor,
        consulta: { ferramenta: "ler_secao", base: base.versao, id },
        orcamento,
        medir: (linha) => linha.length + 1,
      });
      pagina = recorte.pagina;
      texto = recorte.itens.join("\n");
      const primeira = secao.linha_texto + recorte.inicio;
      fonte = { path: secao.path, linha_inicio: primeira, linha_fim: primeira + recorte.itens.length - 1 };
    }
    return responder(
      base,
      {
        secao: {
          id: secao.id,
          ppc: secao.ppc,
          curso: secao.curso,
          tipo: secao.tipo,
          titulo: secao.titulo,
          texto,
          fonte,
          link: linkPpc(secao.id),
        },
        anterior: secao.anterior,
        proxima: secao.proxima,
      },
      pagina ? { pagina } : {},
    );
  },
  texto({ dados: d }) {
    const vizinhas = [
      d.anterior ? `anterior \`${d.anterior}\`` : null,
      d.proxima ? `próxima \`${d.proxima}\`` : null,
    ].filter(Boolean);
    return [
      blocoItem({
        titulo: `${d.secao.titulo} — ${d.secao.curso}`,
        link: d.secao.link,
        detalhe: `\`${d.secao.tipo}\`, ${comLink(d.secao.ppc, linkPpc(d.secao.ppc))} (PPC: exemplo institucional, não norma)`,
        literal: cortar(d.secao.texto, TETO_LER_SECAO - RESERVA_TEXTO),
        fonte: d.secao.fonte,
      }),
      vizinhas.length ? `Seções vizinhas: ${vizinhas.join(", ")}.` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  },
});
