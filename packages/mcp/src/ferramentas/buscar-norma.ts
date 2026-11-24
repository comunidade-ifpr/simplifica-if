/**
 * Ferramenta 1, `buscar_norma`: citação ou ID vão direto ao dispositivo; termos fazem busca textual
 * nos dispositivos e nos metadados das normas (`Normas.buscar`).
 */
import * as Schema from "effect/Schema";
import { DispositivoTexto, Fonte, NormaResumo, SITUACOES_NORMA } from "../contratos.ts";
import { comPadrao, inteiro, opcional, textoAparado } from "../esquema.ts";
import { blocoItem, linhaFonte } from "../texto.ts";
import { definirFerramenta } from "./ferramenta.ts";
import {
  type BlocoComLiteral,
  corpoNoTeto,
  esquemaData,
  literalDoDispositivo,
  situacaoDaNorma,
  tetoDoCorpo,
} from "./normas-comum.ts";

/** Teto do texto para a IA (especificação: 8 mil caracteres). */
export const TETO_BUSCAR_NORMA = 8000;

export const Entrada = Schema.Struct({
  consulta: textoAparado(
    { minimo: 1, maximo: 300 },
    'citação ("Res. CNE/CP 2/2026, art. 28, VII"), ID ("br/lei/1996/9394#art36") ou termos',
  ),
  limite: comPadrao(inteiro({ minimo: 1, maximo: 20 }), 8, "máximo de resultados (padrão 8)"),
  situacao: opcional(Schema.Literals(SITUACOES_NORMA), "só normas da base, stubs ou referências externas"),
  vigentes: opcional(Schema.Boolean, "exclui atos e dispositivos revogados ou ainda não vigentes na data `em`"),
  em: opcional(esquemaData("data da vigência para `vigentes`, AAAA-MM-DD (padrão: hoje)")),
});

export const Resultado = Schema.Struct({
  norma: NormaResumo,
  dispositivo: Schema.optionalKey(DispositivoTexto),
  metadados: Schema.optionalKey(Schema.Struct({ texto: Schema.String, fonte: Fonte })),
  /** Dispositivo pedido que não existe no texto da norma; `dispositivo` é o ancestral mais próximo. */
  citado_fora_do_texto: Schema.optionalKey(Schema.String),
  origem: Schema.String,
  pontuacao: Schema.NullOr(Schema.Finite),
});
export type Resultado = typeof Resultado.Type;

export const Dados = Schema.Struct({ resultados: Schema.Array(Resultado) });

export const buscarNorma = definirFerramenta({
  nome: "buscar_norma",
  titulo: "Buscar norma",
  descricao:
    'Busca na legislação e nas normas da base do IFPR. Uma citação ou um ID ("Res. CNE/CP 2/2026, art. 28, VII", "br/lei/1996/9394#art36") vai direto ao dispositivo; termos fazem busca textual nos dispositivos e nos metadados das normas. Use antes de afirmar qualquer obrigação normativa. Devolve o texto literal, com o caput herdado.',
  entrada: Entrada,
  dados: Dados,
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
