/**
 * Ferramenta 5, `resolver_citacoes`: citações normativas em texto livre, em lote, para o ID
 * canônico (`Normas.resolver`, com o registro montado da tabela `normas`).
 */
import * as Schema from "effect/Schema";
import { EsquemaLink } from "../contratos.ts";
import { textoAparado } from "../esquema.ts";
import { comLink } from "../texto.ts";
import { definirFerramenta } from "./ferramenta.ts";
import { limitarTexto, tetoDoCorpo } from "./normas-comum.ts";

/** Abaixo disto, a citação pede conferência no trecho original (descrição da ferramenta). */
export const CONFIANCA_CONFERIR = 0.9;
/** Teto do texto para a IA (a especificação não fixa um para esta ferramenta). */
export const TETO_RESOLVER_CITACOES = 12_000;

/** `nao-registrada`: o ID foi reconhecido, mas a norma não está no registro da base. */
const SITUACOES_CITACAO = ["base", "stub", "externo", "nao-registrada", "nao-resolvida"] as const;

export const Entrada = Schema.Struct({
  citacoes: Schema.Array(textoAparado({ minimo: 1, maximo: 500 }))
    .check(Schema.isMinLength(1), Schema.isMaxLength(50))
    .annotate({ description: '1 a 50 citações em texto livre, como "Resolução CNE/CP nº 1/2021, art. 20"' }),
});

export const Item = Schema.Struct({
  texto: Schema.String,
  id: Schema.NullOr(Schema.String),
  /** IDs completos dos dispositivos citados (`br/cne-cp/res/2021/1#art20`). */
  dispositivos: Schema.Array(Schema.String),
  regra: Schema.String,
  confianca: Schema.Finite,
  situacao: Schema.Literals(SITUACOES_CITACAO),
  titulo: Schema.NullOr(Schema.String),
  link: Schema.NullOr(EsquemaLink),
});
export type Item = typeof Item.Type;

export const Dados = Schema.Struct({ itens: Schema.Array(Item) });

export const resolverCitacoes = definirFerramenta({
  nome: "resolver_citacoes",
  titulo: "Identificar citações",
  descricao:
    "Identifica citações normativas escritas em texto livre (até 50 por chamada) e devolve o ID canônico, o dispositivo, a regra usada e a confiança. Use para conferir a fundamentação de um documento. Confiança abaixo de 0,9 pede conferência no trecho original.",
  entrada: Entrada,
  dados: Dados,
  texto(resposta) {
    const linhas = resposta.dados.itens.map((i, n) => {
      const citado = `${n + 1}. "${i.texto}"`;
      if (i.id === null) return `${citado} → não identificada (regra \`${i.regra}\`)`;
      const alvo = i.titulo && i.link ? comLink(i.titulo, i.link) : `\`${i.id}\``;
      const dispositivos = i.dispositivos.length ? i.dispositivos.map((d) => `\`${d}\``).join(", ") : `\`${i.id}\``;
      const conferir = i.confianca < CONFIANCA_CONFERIR ? "; conferir no trecho" : "";
      return `${citado} → ${alvo}: ${dispositivos} (regra \`${i.regra}\`, confiança ${i.confianca}, ${i.situacao}${conferir})`;
    });
    return limitarTexto(
      linhas.join("\n"),
      tetoDoCorpo(resposta, TETO_RESOLVER_CITACOES),
      "Lista cortada no teto de caracteres; os itens completos estão no JSON da resposta (structuredContent).",
    );
  },
});
