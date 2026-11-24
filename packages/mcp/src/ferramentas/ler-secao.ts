/**
 * Ferramenta 10, `ler_secao`: uma seção inteira de PPC pelo ID (`Ppcs.lerSecao`), com as vizinhas. Acima
 * do teto, o texto pagina por linhas: cada página termina numa linha inteira, e a `fonte` traz as
 * linhas da página.
 */
import * as Schema from "effect/Schema";
import { EsquemaLink, Fonte } from "../contratos.ts";
import { opcional, texto, textoAparado } from "../esquema.ts";
import { linkPpc } from "../links.ts";
import { cortar, RESERVA_TEXTO } from "../orcamento.ts";
import { blocoItem, comLink } from "../texto.ts";
import { definirFerramenta } from "./ferramenta.ts";

export const TETO_LER_SECAO = 20000;

export const Entrada = Schema.Struct({
  id: textoAparado(
    { minimo: 3, maximo: 300 },
    'ID da seção ("curitiba/tecnico-em-enfermagem/2023#estagio_praticas-1"), vindo de buscar_secoes, ou o link ifpr://ppc/…#secao',
  ),
  cursor: opcional(
    texto({ minimo: 1 }, "cursor do trecho seguinte de uma seção longa, devolvido pela chamada anterior"),
  ),
});

export const Dados = Schema.Struct({
  secao: Schema.Struct({
    id: Schema.String,
    ppc: Schema.String,
    curso: Schema.String,
    tipo: Schema.String,
    titulo: Schema.String,
    /** O texto literal (numa seção longa, o trecho desta página). */
    texto: Schema.String,
    fonte: Fonte,
    link: EsquemaLink,
  }),
  /** IDs das seções vizinhas no documento. */
  anterior: Schema.NullOr(Schema.String),
  proxima: Schema.NullOr(Schema.String),
});

export const lerSecao = definirFerramenta({
  nome: "ler_secao",
  titulo: "Ler seção de PPC",
  descricao:
    "Lê uma seção inteira de PPC pelo ID, vindo de `buscar_secoes` ou de um link `ifpr://ppc/…#secao`. Use quando o trecho devolvido por `buscar_secoes` não bastar.",
  entrada: Entrada,
  dados: Dados,
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
