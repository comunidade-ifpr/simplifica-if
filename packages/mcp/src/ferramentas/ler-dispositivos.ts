/**
 * Ferramenta 2, `ler_dispositivos`: dispositivos pelo ID, em lote, com caput herdado, notas de
 * redação e, se pedido, os subordinados (`Normas.dispositivo` e `Normas.trecho`).
 */
import * as Schema from "effect/Schema";
import { DispositivoTexto } from "../contratos.ts";
import { comPadrao } from "../esquema.ts";
import { blocoItem, linhaFonte } from "../texto.ts";
import { definirFerramenta } from "./ferramenta.ts";
import {
  type BlocoComLiteral,
  corpoNoTeto,
  esquemaIdDispositivo,
  literalDoDispositivo,
  tetoDoCorpo,
} from "./normas-comum.ts";

/** Teto do texto para a IA: o mesmo de `ler_secao` (a especificação não fixa um para esta ferramenta). */
export const TETO_LER_DISPOSITIVOS = 20_000;

export const Entrada = Schema.Struct({
  ids: Schema.Array(esquemaIdDispositivo)
    .check(Schema.isMinLength(1), Schema.isMaxLength(20))
    .annotate({ description: '1 a 20 IDs "norma#dispositivo", como "br/cne-cp/res/2026/2#art28-vii"' }),
  filhos: comPadrao(Schema.Boolean, false, "inclui incisos, alíneas e parágrafos de cada dispositivo"),
});

export const Dispositivo = Schema.Struct({
  ...DispositivoTexto.fields,
  /** Título da norma, para citar. */
  norma: Schema.String,
  /** Notas de redação, inclusão, revogação ou veto, literais. */
  notas: Schema.Array(Schema.String),
  /** Dispositivo pai (ID do ato), `null` no artigo. */
  pai: Schema.NullOr(Schema.String),
  /** Título, capítulo e seção em que o dispositivo está. */
  estrutura: Schema.Array(Schema.String),
});
export type Dispositivo = typeof Dispositivo.Type;

export const Dados = Schema.Struct({
  dispositivos: Schema.Array(Dispositivo),
  nao_encontrados: Schema.Array(Schema.String),
});

export const lerDispositivos = definirFerramenta({
  nome: "ler_dispositivos",
  titulo: "Ler dispositivos",
  descricao:
    "Lê dispositivos pelo ID (até 20 por chamada), com o caput herdado, as notas de redação e, se pedido, os incisos, alíneas e parágrafos. Use quando já tiver o ID, vindo de `buscar_norma`, de `resolver_citacoes` ou de uma ficha.",
  entrada: Entrada,
  dados: Dados,
  texto(resposta) {
    const blocos = resposta.dados.dispositivos.map((d): BlocoComLiteral => {
      const situacao = [d.revogado ? "revogado" : "", d.vetado ? "vetado" : ""].filter(Boolean).join(", ");
      const rodape = [
        ...d.notas.map((n) => `nota: ${n}`),
        d.estrutura.length ? `estrutura: ${d.estrutura.join(" › ")}` : "",
        linhaFonte(d.fonte),
      ].filter(Boolean);
      return {
        cabecalho: blocoItem({
          titulo: `${d.norma}, ${d.rotulo}`,
          link: d.link,
          detalhe: `\`${d.id}\`${situacao ? `; ${situacao}` : ""}`,
        }),
        literal: literalDoDispositivo(d),
        rodape: rodape.join("\n"),
        seCortado: "Texto cortado para caber na resposta: peça menos IDs por chamada.",
      };
    });
    return corpoNoTeto(blocos, tetoDoCorpo(resposta, TETO_LER_DISPOSITIVOS));
  },
});
