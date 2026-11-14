/**
 * Ferramenta 4, `correspondencia`: o dispositivo correspondente na norma sucessora, pela tabela de
 * correspondência (`Normas.correspondencia`, o `kb correspondencia`). Sem dispositivo, todos os
 * artigos da norma, de 10 em 10.
 */
import * as Schema from "effect/Schema";
import { DispositivoTexto } from "../contratos.ts";
import { opcional, texto } from "../esquema.ts";
import { blocoItem, linhaFonte } from "../texto.ts";
import { definirFerramenta } from "./ferramenta.ts";
import {
  type BlocoComLiteral,
  corpoNoTeto,
  esquemaIdNorma,
  limitarTexto,
  literalDoDispositivo,
  tetoDoCorpo,
} from "./normas-comum.ts";

/** Artigos por página quando a consulta é a norma inteira (especificação: 10). */
export const PAGINA_CORRESPONDENCIA = 10;
/** Teto do texto para a IA (a especificação não fixa um para esta ferramenta). */
export const TETO_CORRESPONDENCIA = 16_000;

export const Entrada = Schema.Struct({
  id: esquemaIdNorma(
    'norma de origem com o dispositivo ("br/cne-cp/res/2021/1#art20"); sem o dispositivo, todos os artigos',
  ),
  cursor: opcional(texto({}, "cursor da página seguinte, devolvido pela chamada anterior")),
});

export const Item = Schema.Struct({
  origem: DispositivoTexto,
  tipo: Schema.String,
  destino: Schema.Array(DispositivoTexto),
  nota: Schema.NullOr(Schema.String),
  /** Dispositivo da tabela de que o item foi herdado, quando o pedido não tem linha própria. */
  herdado_de: Schema.NullOr(Schema.String),
  detalhes: Schema.Array(
    Schema.Struct({
      origem: Schema.String,
      tipo: Schema.String,
      destino: Schema.Array(Schema.String),
      nota: Schema.NullOr(Schema.String),
    }),
  ),
});
export type Item = typeof Item.Type;

export const Dados = Schema.Struct({
  /** Tabela de correspondência com origem na norma; `null` se não há. */
  tabela: Schema.NullOr(
    Schema.Struct({
      arquivo: Schema.String,
      origem: Schema.String,
      destino: Schema.String,
      status: Schema.String,
      elaborado_em: Schema.NullOr(Schema.String),
      revisado_por: Schema.NullOr(Schema.String),
    }),
  ),
  itens: Schema.Array(Item),
});

export const correspondencia = definirFerramenta({
  nome: "correspondencia",
  titulo: "Correspondência entre normas",
  descricao:
    "Dispositivo correspondente na norma sucessora, por exemplo do art. 20 da Res. CNE/CP 1/2021 para a Res. CNE/CP 2/2026. Use quando um PPC ou documento citar dispositivo de norma revogada. A tabela é rascunho, sem revisão jurídica: trate-a como indicação, nunca como fundamento.",
  entrada: Entrada,
  dados: Dados,
  texto(resposta) {
    const blocos: BlocoComLiteral[] = [];
    for (const item of resposta.dados.itens) {
      const o = item.origem;
      const herdado = item.herdado_de ? `; herdado de \`${item.herdado_de}\`` : "";
      blocos.push({
        cabecalho: blocoItem({ titulo: o.rotulo, link: o.link, detalhe: `\`${o.id}\` → ${item.tipo}${herdado}` }),
        literal: literalDoDispositivo(o),
        rodape: [
          linhaFonte(o.fonte),
          ...(item.nota ? [`nota da tabela: ${item.nota}`] : []),
          ...item.detalhes.map(
            (d) =>
              `- detalhe: \`${d.origem}\` → ${d.destino.map((x) => `\`${x}\``).join(", ") || "—"} (${d.tipo})${d.nota ? `; ${d.nota}` : ""}`,
          ),
        ].join("\n"),
        seCortado: `Texto cortado: leia inteiro com \`ler_dispositivos\` (\`${o.id}\`).`,
      });
      for (const d of item.destino) {
        blocos.push({
          cabecalho: `  ↳ ${blocoItem({ titulo: d.rotulo, link: d.link, detalhe: `\`${d.id}\`, correspondente de \`${o.id}\`` })}`,
          literal: literalDoDispositivo(d),
          rodape: linhaFonte(d.fonte),
          seCortado: `Texto cortado: leia inteiro com \`ler_dispositivos\` (\`${d.id}\`).`,
        });
      }
    }
    const tabela = resposta.dados.tabela;
    const cabecalho = tabela
      ? `Tabela \`${tabela.arquivo}\` (${tabela.origem} → ${tabela.destino}): ${tabela.status}${tabela.revisado_por ? `, revisada por ${tabela.revisado_por}` : ", sem revisão"}${tabela.elaborado_em ? `, elaborada em ${tabela.elaborado_em}` : ""}.`
      : "";
    const teto = tetoDoCorpo(resposta, TETO_CORRESPONDENCIA) - cabecalho.length - 2;
    const corpo = [cabecalho, corpoNoTeto(blocos, teto)].filter(Boolean).join("\n\n");
    return limitarTexto(
      corpo,
      teto + cabecalho.length + 2,
      "Resposta cortada no teto de caracteres: leia os dispositivos com `ler_dispositivos`.",
    );
  },
});
