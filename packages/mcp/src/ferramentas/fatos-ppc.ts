/**
 * Ferramenta 13, `fatos_ppc`: fatos extraídos dos PPCs (carga horária, estágio, ano), com o trecho de
 * origem, cruzados com as matrizes do SUAP (`Ppcs.fatos` e `Ppcs.divergencias`). Os
 * fatos têm status `extraido`: o aviso `fato-extraido` vai sempre.
 */
import * as Schema from "effect/Schema";
import { FatosPpc } from "../contratos.ts";
import { comPadrao, inteiro, opcional, texto } from "../esquema.ts";
import { filtroTexto, textoFatosPpc } from "./comum-ppcs.ts";
import { definirFerramenta } from "./ferramenta.ts";

export const TETO_FATOS = 12000;

export const Entrada = Schema.Struct({
  ppc: opcional(filtroTexto('um PPC ("campus/curso")')),
  divergencias: comPadrao(
    Schema.Boolean,
    false,
    "só os PPCs com divergência PPC × SUAP (e só as linhas divergentes), com os totais por aspecto",
  ),
  nivel: opcional(filtroTexto('nível do PPC ("médio", "superior")')),
  campus: opcional(filtroTexto('campus, pelo ID ("curitiba")')),
  limite: comPadrao(inteiro({ minimo: 1, maximo: 50 }), 20, "PPCs por página (1 a 50); padrão 20"),
  cursor: opcional(texto({ minimo: 1 }, "cursor da página seguinte, devolvido pela chamada anterior")),
});

export const Dados = Schema.Struct({
  ppcs: Schema.Array(FatosPpc),
  /** Com `divergencias`: PPCs por aspecto e resultado do cruzamento, no recorte dos filtros. */
  totais: Schema.optionalKey(Schema.Record(Schema.String, Schema.Record(Schema.String, inteiro({ minimo: 0 })))),
});

export const fatosPpc = definirFerramenta({
  nome: "fatos_ppc",
  titulo: "Fatos do PPC × SUAP",
  descricao:
    "Fatos extraídos de PPCs (carga horária, estágio, ano), com o trecho de origem, cruzados com as matrizes do SUAP publicadas na base. Use quando a pergunta cobrir vários PPCs ou só as divergências; para um curso, `ficha_curso` já traz os fatos. Os fatos são extraídos por regra, sem revisão humana: confira o trecho antes de afirmar uma divergência.",
  entrada: Entrada,
  dados: Dados,
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
