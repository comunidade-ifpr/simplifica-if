/**
 * Ferramenta 2, `ler_dispositivos`: dispositivos pelo ID, em lote, com caput herdado, notas de
 * redação e, se pedido, os subordinados (`Normas.dispositivo` e `Normas.trecho`, o
 * `kb dispositivo [--filhos]`).
 */
import * as Normas from "@simplifica-if/kb/Normas";
import { z } from "zod";
import { type Aviso, responder } from "../envelope.ts";
import { blocoItem, linhaFonte } from "../texto.ts";
import { definirFerramenta } from "./ferramenta.ts";
import {
  avisosDasNormas,
  type BlocoComLiteral,
  corpoNoTeto,
  dispositivoTexto,
  esquemaDispositivoTexto,
  esquemaIdDispositivo,
  literalDoDispositivo,
  tetoDoCorpo,
} from "./normas-comum.ts";
import { leitorDeNormas, type NormaResumo, resumoDaNorma } from "./tipos-comuns.ts";

/** Teto do texto para a IA: o mesmo de `ler_secao` (a especificação não fixa um para esta ferramenta). */
export const TETO_LER_DISPOSITIVOS = 20_000;

const entrada = z.strictObject({
  ids: z
    .array(esquemaIdDispositivo)
    .min(1)
    .max(20)
    .describe('1 a 20 IDs "norma#dispositivo", como "br/cne-cp/res/2026/2#art28-vii"'),
  filhos: z.boolean().default(false).describe("inclui incisos, alíneas e parágrafos de cada dispositivo"),
});

const dados = z.strictObject({
  dispositivos: z.array(
    esquemaDispositivoTexto.extend({
      /** Título da norma, para citar. */
      norma: z.string(),
      /** Notas de redação, inclusão, revogação ou veto, literais. */
      notas: z.array(z.string()),
      /** Dispositivo pai (ID do ato), `null` no artigo. */
      pai: z.string().nullable(),
      /** Título, capítulo e seção em que o dispositivo está. */
      estrutura: z.array(z.string()),
    }),
  ),
  nao_encontrados: z.array(z.string()),
});

type Dispositivo = z.infer<typeof dados>["dispositivos"][number];

export const lerDispositivos = definirFerramenta({
  nome: "ler_dispositivos",
  titulo: "Ler dispositivos",
  descricao:
    "Lê dispositivos pelo ID (até 20 por chamada), com o caput herdado, as notas de redação e, se pedido, os incisos, alíneas e parágrafos. Use quando já tiver o ID, vindo de `buscar_norma`, de `resolver_citacoes` ou de uma ficha.",
  entrada,
  dados,
  executar({ ids, filhos }, { kb, base }) {
    const norma = leitorDeNormas(kb);
    const dispositivos: Dispositivo[] = [];
    const normas: NormaResumo[] = [];
    const naoEncontrados: string[] = [];
    for (const id of new Set(ids)) {
      const achado = kb(Normas.Normas.use((n) => n.dispositivo(id)));
      const trecho = achado ? kb(Normas.Normas.use((n) => n.trecho(id, { subordinados: filhos }))) : null;
      const registrada = achado ? norma(achado.disp.ato) : null;
      if (!achado || !trecho || !registrada) {
        naoEncontrados.push(id);
        continue;
      }
      const { pai } = achado.disp;
      normas.push(resumoDaNorma(registrada));
      dispositivos.push({
        ...dispositivoTexto(kb, trecho),
        norma: registrada.titulo,
        notas: trecho.notas.map((n) => n.texto),
        pai: pai === null ? null : `${achado.disp.ato}${pai.slice(pai.indexOf("#"))}`,
        estrutura: achado.disp.estrutura,
      });
    }
    const avisos: Aviso[] = naoEncontrados.map((id) => ({
      tipo: "nao-encontrado",
      mensagem: "dispositivo não encontrado no texto da base; confira o ID com buscar_norma ou resolver_citacoes",
      ref: id,
    }));
    avisos.push(...avisosDasNormas(normas));
    return responder(base, { dispositivos, nao_encontrados: naoEncontrados }, { avisos });
  },
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
