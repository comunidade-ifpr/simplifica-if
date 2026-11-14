/**
 * Ferramenta 13, `fatos_ppc`: fatos extraídos dos PPCs (carga horária, estágio, ano), com o trecho de
 * origem, cruzados com as matrizes do SUAP (`fatosDosPpcs` e `divergenciasPpcSuap`, a regra de
 * `kb ppc-fatos`). Os fatos têm status `extraido`: o aviso `fato-extraido` vai sempre.
 */
import { divergenciasPpcSuap, fatosDosPpcs } from "@simplifica-if/kb/db/modo-banco";
import { z } from "zod";
import { type Aviso, responder } from "../envelope.ts";
import { paginarNoTeto, RESERVA_TEXTO } from "../orcamento.ts";
import {
  AVISO_FATO_EXTRAIDO,
  chavePpc,
  esquemaFatosPpc,
  paraFatosPpc,
  filtroTexto,
  textoFatosPpc,
} from "./comum-ppcs.ts";
import { definirFerramenta } from "./ferramenta.ts";

export const TETO_FATOS = 12000;

const entrada = z.strictObject({
  ppc: filtroTexto('um PPC ("campus/curso")').optional(),
  divergencias: z
    .boolean()
    .default(false)
    .describe("só os PPCs com divergência PPC × SUAP (e só as linhas divergentes), com os totais por aspecto"),
  nivel: filtroTexto('nível do PPC ("médio", "superior")').optional(),
  campus: filtroTexto('campus, pelo ID ("curitiba")').optional(),
  limite: z.number().int().min(1).max(50).default(20).describe("PPCs por página (1 a 50); padrão 20"),
  cursor: z.string().min(1).optional().describe("cursor da página seguinte, devolvido pela chamada anterior"),
});

const dados = z.strictObject({
  ppcs: z.array(esquemaFatosPpc),
  /** Com `divergencias`: PPCs por aspecto e resultado do cruzamento, no recorte dos filtros. */
  totais: z.record(z.string(), z.record(z.string(), z.number().int().min(0))).optional(),
});

export const fatosPpc = definirFerramenta({
  nome: "fatos_ppc",
  titulo: "Fatos do PPC × SUAP",
  descricao:
    "Fatos extraídos de PPCs (carga horária, estágio, ano), com o trecho de origem, cruzados com as matrizes do SUAP publicadas na base. Os fatos são extraídos por regra, sem revisão humana: confira o trecho antes de afirmar uma divergência.",
  entrada,
  dados,
  executar(e, { db, base }) {
    const filtros = {
      ppc: e.ppc === undefined ? undefined : chavePpc(e.ppc),
      nivel: e.nivel,
      campus: e.campus,
    };
    const resultado = e.divergencias ? divergenciasPpcSuap(db, filtros) : { ppcs: fatosDosPpcs(db, filtros) };
    const ppcs = resultado.ppcs.map(paraFatosPpc);
    const { itens, pagina } = paginarNoTeto(ppcs, {
      limite: e.limite,
      cursor: e.cursor,
      consulta: { ferramenta: "fatos_ppc", base: base.versao, divergencias: e.divergencias, ...filtros },
      orcamento: TETO_FATOS - RESERVA_TEXTO - 600,
      medir: (p) => textoFatosPpc(p).length + 2,
    });
    const avisos: Aviso[] = [AVISO_FATO_EXTRAIDO];
    if (ppcs.length === 0) {
      avisos.push({
        tipo: "nao-encontrado",
        mensagem: filtros.ppc
          ? `PPC não encontrado na base${e.divergencias ? ", ou sem divergência PPC × SUAP" : ""}: ${filtros.ppc}`
          : `nenhum PPC${e.divergencias ? " com divergência PPC × SUAP" : ""} com esses filtros`,
      });
    }
    return responder(
      base,
      { ppcs: itens, ...("totais" in resultado ? { totais: resultado.totais } : {}) },
      { avisos, pagina },
    );
  },
  texto({ dados: d }) {
    const partes: string[] = [];
    if (d.totais) {
      partes.push(
        [
          "Cruzamento PPC × SUAP, PPCs por resultado:",
          ...Object.entries(d.totais).map(
            ([aspecto, r]) =>
              `- ${aspecto}: ${Object.entries(r)
                .map(([resultado, n]) => `${resultado} ${n}`)
                .join(", ")}`,
          ),
        ].join("\n"),
      );
    }
    partes.push(...d.ppcs.map((p) => textoFatosPpc(p)));
    return partes.join("\n\n");
  },
});
