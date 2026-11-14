/**
 * Ferramenta 4, `correspondencia`: o dispositivo correspondente na norma sucessora, pela tabela de
 * correspondência (`Normas.correspondencia`, o `kb correspondencia`). Sem dispositivo, todos os
 * artigos da norma, de 10 em 10.
 */
import * as Normas from "@simplifica-if/kb/Normas";
import { idDoAto } from "@simplifica-if/kb/normas/ids";
import { z } from "zod";
import { type Aviso, ErroEntrada, paginar, responder } from "../envelope.ts";
import { blocoItem, linhaFonte } from "../texto.ts";
import { definirFerramenta, type Kb } from "./ferramenta.ts";
import {
  type BlocoComLiteral,
  corpoNoTeto,
  type DispositivoTexto,
  dispositivoTexto,
  esquemaDispositivoTexto,
  esquemaIdNorma,
  limitarTexto,
  literalDoDispositivo,
  tetoDoCorpo,
} from "./normas-comum.ts";

/** Artigos por página quando a consulta é a norma inteira (especificação: 10). */
export const PAGINA_CORRESPONDENCIA = 10;
/** Teto do texto para a IA (a especificação não fixa um para esta ferramenta). */
export const TETO_CORRESPONDENCIA = 16_000;

const entrada = z.strictObject({
  id: esquemaIdNorma.describe(
    'norma de origem com o dispositivo ("br/cne-cp/res/2021/1#art20"); sem o dispositivo, todos os artigos',
  ),
  cursor: z.string().optional().describe("cursor da página seguinte, devolvido pela chamada anterior"),
});

const dados = z.strictObject({
  /** Tabela de correspondência com origem na norma; `null` se não há. */
  tabela: z
    .strictObject({
      arquivo: z.string(),
      origem: z.string(),
      destino: z.string(),
      status: z.string(),
      elaborado_em: z.string().nullable(),
      revisado_por: z.string().nullable(),
    })
    .nullable(),
  itens: z.array(
    z.strictObject({
      origem: esquemaDispositivoTexto,
      tipo: z.string(),
      destino: z.array(esquemaDispositivoTexto),
      nota: z.string().nullable(),
      /** Dispositivo da tabela de que o item foi herdado, quando o pedido não tem linha própria. */
      herdado_de: z.string().nullable(),
      detalhes: z.array(
        z.strictObject({
          origem: z.string(),
          tipo: z.string(),
          destino: z.array(z.string()),
          nota: z.string().nullable(),
        }),
      ),
    }),
  ),
});

type Item = z.infer<typeof dados>["itens"][number];

function trecho(kb: Kb, id: string): DispositivoTexto | null {
  const t = kb(Normas.Normas.use((n) => n.trecho(id)));
  return t ? dispositivoTexto(kb, t) : null;
}

export const correspondencia = definirFerramenta({
  nome: "correspondencia",
  titulo: "Correspondência entre normas",
  descricao:
    "Dispositivo correspondente na norma sucessora, por exemplo do art. 20 da Res. CNE/CP 1/2021 para a Res. CNE/CP 2/2026. Use quando um PPC ou documento citar dispositivo de norma revogada. A tabela é rascunho, sem revisão jurídica: trate-a como indicação, nunca como fundamento.",
  entrada,
  dados,
  executar({ id, cursor }, { kb, base }) {
    const ato = idDoAto(id.split("#")[0]!);
    const comDispositivo = id.includes("#");
    const tabelas = kb(Normas.Normas.use((n) => n.tabelasDeCorrespondencia(ato)));
    const resultados = kb(Normas.Normas.use((n) => n.correspondencia(id)));
    const avisos: Aviso[] = [];
    if (comDispositivo && cursor !== undefined) {
      throw new ErroEntrada("cursor só vale na consulta da norma inteira (ID sem dispositivo)");
    }
    const { itens: pagina, pagina: dadosPagina } = comDispositivo
      ? { itens: resultados, pagina: undefined }
      : paginar(resultados, { limite: PAGINA_CORRESPONDENCIA, cursor, consulta: { id } });
    const itens = pagina.map((r): Item => {
      const origem = trecho(kb, r.id);
      if (!origem) throw new Error(`dispositivo de origem da correspondência fora do texto: ${r.id}`);
      const destino: DispositivoTexto[] = [];
      for (const d of r.textos_destino) {
        const t = trecho(kb, d.id);
        if (t) destino.push(t);
        else
          avisos.push({ tipo: "nao-encontrado", mensagem: "dispositivo de destino fora do texto da base", ref: d.id });
      }
      return {
        origem,
        tipo: r.item.tipo,
        destino,
        nota: r.item.nota ?? null,
        herdado_de: r.herdado_de === null ? null : `${ato}${r.herdado_de}`,
        detalhes: r.detalhes.map((x) => ({
          origem: `${ato}${x.origem}`,
          tipo: x.tipo,
          destino: x.destino.map((d) => `${r.destino_ato}${d}`),
          nota: x.nota ?? null,
        })),
      };
    });
    const tabela = tabelas[0];
    if (!tabela) {
      avisos.push({
        tipo: "nao-encontrado",
        mensagem: "não há tabela de correspondência com origem nesta norma",
        ref: ato,
      });
    } else if (itens.length === 0) {
      avisos.push({
        tipo: "nao-encontrado",
        mensagem: "o dispositivo não está na tabela de correspondência nem no texto da norma",
        ref: id,
      });
    }
    for (const t of tabelas) {
      if (t.status === "rascunho") {
        avisos.push({
          tipo: "correspondencia-rascunho",
          mensagem: `a tabela de correspondência ${t.origem} → ${t.destino} é rascunho, sem revisão jurídica: use como indicação, nunca como fundamento`,
          ref: t.arquivo,
        });
      }
    }
    return responder(
      base,
      {
        tabela: tabela
          ? {
              arquivo: tabela.arquivo,
              origem: tabela.origem,
              destino: tabela.destino,
              status: tabela.status,
              elaborado_em: tabela.elaborado_em ?? null,
              revisado_por: tabela.revisado_por ?? null,
            }
          : null,
        itens,
      },
      { avisos, pagina: dadosPagina },
    );
  },
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
