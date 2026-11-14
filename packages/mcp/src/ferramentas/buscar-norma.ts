/**
 * Ferramenta 1, `buscar_norma`: citação ou ID vão direto ao dispositivo; termos fazem busca textual
 * nos dispositivos e nos metadados das normas (`Normas.buscar`, o `kb buscar-norma`).
 */
import * as Normas from "@simplifica-if/kb/Normas";
import { z } from "zod";
import { type Aviso, esquemaFonte, responder } from "../envelope.ts";
import { blocoItem, linhaFonte } from "../texto.ts";
import { definirFerramenta } from "./ferramenta.ts";
import {
  avisosDasNormas,
  type BlocoComLiteral,
  corpoNoTeto,
  dispositivoTexto,
  esquemaData,
  esquemaDispositivoTexto,
  literalDoDispositivo,
  situacaoDaNorma,
  tetoDoCorpo,
} from "./normas-comum.ts";
import { esquemaNormaResumo, leitorDeNormas, resumoDaNorma, SITUACOES_NORMA } from "./tipos-comuns.ts";

/** Teto do texto para a IA (especificação: 8 mil caracteres). */
export const TETO_BUSCAR_NORMA = 8000;

const entrada = z.strictObject({
  consulta: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .describe('citação ("Res. CNE/CP 2/2026, art. 28, VII"), ID ("br/lei/1996/9394#art36") ou termos'),
  limite: z.number().int().min(1).max(20).default(8).describe("máximo de resultados (padrão 8)"),
  situacao: z.enum(SITUACOES_NORMA).optional().describe("só normas da base, stubs ou referências externas"),
  vigentes: z.boolean().optional().describe("exclui atos e dispositivos revogados ou ainda não vigentes na data `em`"),
  em: esquemaData.optional().describe("data da vigência para `vigentes`, AAAA-MM-DD (padrão: data de referência)"),
});

const dados = z.strictObject({
  resultados: z.array(
    z.strictObject({
      norma: esquemaNormaResumo,
      dispositivo: esquemaDispositivoTexto.optional(),
      metadados: z.strictObject({ texto: z.string(), fonte: esquemaFonte }).optional(),
      /** Dispositivo pedido que não existe no texto da norma; `dispositivo` é o ancestral mais próximo. */
      citado_fora_do_texto: z.string().optional(),
      origem: z.string(),
      pontuacao: z.number().nullable(),
    }),
  ),
});

type Resultado = z.infer<typeof dados>["resultados"][number];

export const buscarNorma = definirFerramenta({
  nome: "buscar_norma",
  titulo: "Buscar norma",
  descricao:
    'Busca na legislação e nas normas da base do IFPR. Uma citação ou um ID ("Res. CNE/CP 2/2026, art. 28, VII", "br/lei/1996/9394#art36") vai direto ao dispositivo; termos fazem busca textual nos dispositivos e nos metadados das normas. Use antes de afirmar qualquer obrigação normativa. Devolve o texto literal, com o caput herdado.',
  entrada,
  dados,
  executar({ consulta, limite, situacao, vigentes, em }, { kb, base }) {
    const norma = leitorDeNormas(kb);
    const achados = kb(
      Normas.Normas.use((n) =>
        n.buscar(consulta, {
          limite,
          ...(situacao ? { situacao } : {}),
          ...(vigentes ? { vigentes } : {}),
          ...(em ? { em } : {}),
        }),
      ),
    ).resultados;
    const resultados = achados.map((r): Resultado => {
      const registrada = norma(r.norma.id);
      if (!registrada) throw new Error(`norma do resultado fora da tabela normas: ${r.norma.id}`);
      const resultado: Resultado = { norma: resumoDaNorma(registrada), origem: r.origem, pontuacao: r.pontuacao };
      if (r.dispositivo) resultado.dispositivo = dispositivoTexto(kb, r.dispositivo);
      if (r.metadados) {
        resultado.metadados = {
          texto: r.metadados.texto,
          fonte: { path: r.metadados.path, linha_inicio: r.metadados.linha, linha_fim: r.metadados.linha },
        };
      }
      if (r.pedido) resultado.citado_fora_do_texto = r.pedido;
      return resultado;
    });
    const avisos: Aviso[] = [];
    if (resultados.length === 0) {
      avisos.push({
        tipo: "nao-encontrado",
        mensagem:
          "nenhuma norma encontrada na base para a consulta; tente outros termos ou resolver_citacoes, e não preencha com memória",
      });
    }
    for (const r of resultados) {
      if (r.citado_fora_do_texto && r.dispositivo) {
        avisos.push({
          tipo: "nao-encontrado",
          mensagem: `o dispositivo citado não está no texto da base; mostrando o mais próximo, ${r.dispositivo.id}`,
          ref: r.citado_fora_do_texto,
        });
      }
    }
    avisos.push(...avisosDasNormas(resultados.map((r) => r.norma)));
    return responder(base, { resultados }, { avisos });
  },
  texto(resposta) {
    const blocos = resposta.dados.resultados.map((r): BlocoComLiteral => {
      const pontuacao = r.pontuacao === null ? "" : `, pontuação ${r.pontuacao}`;
      const d = r.dispositivo;
      if (d) {
        return {
          cabecalho: blocoItem({
            titulo: `${r.norma.titulo}, ${d.rotulo}`,
            link: d.link,
            detalhe: `\`${d.id}\`; ${situacaoDaNorma(r.norma)}${d.revogado ? "; dispositivo revogado" : ""}${d.vetado ? "; vetado" : ""} (${r.origem}${pontuacao})`,
          }),
          literal: literalDoDispositivo(d),
          rodape: linhaFonte(d.fonte),
          seCortado: `Texto cortado: leia inteiro com \`ler_dispositivos\` (\`${d.id}\`${d.subordinados.length ? ", `filhos: true`" : ""}).`,
        };
      }
      return {
        cabecalho: blocoItem({
          titulo: r.norma.titulo,
          link: r.norma.link,
          detalhe: `\`${r.norma.id}\`; ${situacaoDaNorma(r.norma)} (metadados da norma; ${r.origem}${pontuacao})`,
        }),
        ...(r.metadados ? { literal: r.metadados.texto, rodape: linhaFonte(r.metadados.fonte) } : {}),
        seCortado: "Texto cortado.",
      };
    });
    return corpoNoTeto(blocos, tetoDoCorpo(resposta, TETO_BUSCAR_NORMA));
  },
});
