/**
 * Ferramenta 7, `impacto_da_norma`: o que uma norma atinge na base, por `impactoBanco` (a regra de
 * `kb impacto`): relações, sucessoras, transições, normas que a citam, fichas da `revisar-ppc`,
 * tópicos e PPCs. Os outros arquivos das skills ficam na CLI (servem à curadoria); a lista completa
 * de PPCs vem de `citacoes_da_norma`.
 */
import { fonteVigenciaBanco, impactoBanco, ppcsQueCitamBanco, vigenciaBanco } from "@simplifica-if/kb/db/modo-banco";
import { z } from "zod";
import { type Aviso, esquemaLink, responder } from "../envelope.ts";
import { linkFicha, linkNorma, linkPpc } from "../links.ts";
import { cortar, linhasNoOrcamento } from "../orcamento.ts";
import { comLink, dataBr } from "../texto.ts";
import {
  avisoVigencia,
  esquemaTransicaoResumo,
  idNorma,
  linhaTransicao,
  normaPedida,
  transicaoResumo,
} from "./comum-ppcs.ts";
import { esquemaNormaResumo, esquemaRelacao, normaResumo, type RelacaoSaida, relacaoSaida } from "./tipos-comuns.ts";
import { definirFerramenta } from "./ferramenta.ts";

export const TETO_IMPACTO = 8000;
/** PPCs na amostra; a lista completa vem de `citacoes_da_norma`. */
export const AMOSTRA_PPCS = 10;

const entrada = z.strictObject({
  id: idNorma('ID canônico da norma, com dispositivo opcional ("br/cne-cp/res/2021/1")'),
});

const dados = z.strictObject({
  norma: esquemaNormaResumo,
  /** Status na data de referência, com "(a confirmar)" quando incerto. */
  status: z.string(),
  data_referencia: z.string(),
  sucessoras: z.array(z.string()),
  transicoes: z.array(esquemaTransicaoResumo),
  relacoes: z.array(esquemaRelacao),
  normas_que_citam: z.array(
    z.strictObject({
      id: z.string(),
      titulo: z.string(),
      /** Dispositivos da norma citante que citam esta (ou `preâmbulo`). */
      dispositivos: z.array(z.string()),
      link: esquemaLink,
    }),
  ),
  ppcs: z.strictObject({
    total: z.number().int().min(0),
    amostra: z.array(z.strictObject({ ppc: z.string(), nome: z.string(), campus: z.string(), link: esquemaLink })),
  }),
  fichas: z.array(
    z.strictObject({
      id: z.string(),
      titulo: z.string(),
      /** Motivos: referencia, referencia-correspondente, citacao, citacao-sucessora, tema. */
      papel: z.string(),
      dispositivos: z.array(z.string()),
      link: esquemaLink,
    }),
  ),
  topicos: z.array(z.string()),
});

const esquemaFicha = z.object({ id: z.string(), titulo: z.string() }).nullable();

export const impactoDaNorma = definirFerramenta({
  nome: "impacto_da_norma",
  titulo: "Impacto da norma",
  descricao:
    'O que uma norma (revogada, alterada ou nova) atinge na base: os PPCs que a citam, as fichas da `revisar-ppc`, as normas que a citam, as relações, as sucessoras e as transições. Use para responder "o que muda com esta norma".',
  entrada,
  dados,
  executar(e, { db, base }) {
    const norma = normaPedida(db, e.id);
    const impacto = impactoBanco(db, e.id, { incluirPpcs: false });
    const ppcs = ppcsQueCitamBanco(db, e.id);
    const transicoes = new Map(vigenciaBanco(db, norma.id).transicoes.map((t) => [t.id, t]));
    const relacoes = fonteVigenciaBanco(db)
      .relacoes()
      .filter((r) => r.origem === norma.id || r.alvo === norma.id);
    const fichas = impacto.arquivos
      .filter((a) => a.categoria === "ficha")
      .map((a) => {
        const ficha = esquemaFicha.parse(db.query("SELECT id, titulo FROM fichas WHERE path = ?").get(a.arquivo));
        const id = ficha?.id ?? a.arquivo;
        return {
          id,
          titulo: ficha?.titulo ?? a.arquivo,
          papel: a.motivos.join(", "),
          dispositivos: a.dispositivos,
          link: linkFicha(id),
        };
      });
    const avisos: Aviso[] = [...avisoVigencia(norma)];
    if (impacto.status.endsWith("(a confirmar)") && avisos.length === 0) {
      avisos.push({
        tipo: "vigencia-a-confirmar",
        mensagem: `o status de ${norma.titulo} em ${dataBr(impacto.data_referencia)} está a confirmar; diga isso ao usuário`,
        ref: norma.id,
      });
    }
    return responder(
      base,
      {
        norma,
        status: impacto.status,
        data_referencia: impacto.data_referencia,
        sucessoras: impacto.sucessoras,
        transicoes: impacto.transicoes.map((id) => transicaoResumo(transicoes.get(id)!)),
        relacoes: relacoes.map(relacaoSaida),
        normas_que_citam: impacto.normas_que_citam.map((n) => ({
          id: n.id,
          titulo: normaResumo(db, n.id)?.titulo ?? n.id,
          dispositivos: n.dispositivos,
          link: linkNorma(n.id),
        })),
        ppcs: {
          total: ppcs.length,
          amostra: ppcs
            .slice(0, AMOSTRA_PPCS)
            .map((p) => ({ ppc: p.ppc, nome: p.curso, campus: p.campus, link: linkPpc(p.ppc) })),
        },
        fichas,
        topicos: impacto.topicos_atingidos,
      },
      { avisos },
    );
  },
  texto({ dados: d }) {
    const lista = (titulo: string, linhas: string[], orcamento: number, resto: string) =>
      linhas.length === 0
        ? `${titulo}: nenhuma.`
        : [`${titulo}:`, ...linhasNoOrcamento(linhas, orcamento, resto)].join("\n");
    const relacao = (r: RelacaoSaida) =>
      `- ${r.origem}${r.operador ?? ""} **${r.tipo}** ${r.alvo}${r.alvo_dispositivo ?? ""} — evidência em ${r.evidencia.em}: "${cortar(r.evidencia.trecho, 200)}"`;
    return [
      `Impacto de ${comLink(d.norma.titulo, d.norma.link)}: ${d.status} em ${dataBr(d.data_referencia)}.`,
      `Sucessoras: ${d.sucessoras.length ? d.sucessoras.map((s) => comLink(s, linkNorma(s))).join(", ") : "nenhuma"}.`,
      lista("Regras de transição (norma revogada não é inaplicável)", d.transicoes.map(linhaTransicao), 1500, "regras"),
      lista("Relações", d.relacoes.map(relacao), 1500, "relações"),
      lista(
        "Normas que a citam",
        d.normas_que_citam.map((n) => `- ${comLink(n.titulo, n.link)} (${n.dispositivos.join(", ")})`),
        800,
        "normas",
      ),
      `PPCs que a citam: ${d.ppcs.total}${d.ppcs.total > d.ppcs.amostra.length ? ` (amostra de ${d.ppcs.amostra.length}; lista completa em \`citacoes_da_norma\`)` : ""}${d.ppcs.amostra.length ? `: ${d.ppcs.amostra.map((p) => comLink(`${p.nome} (${p.campus})`, p.link)).join("; ")}` : ""}.`,
      lista(
        "Fichas da revisar-ppc atingidas",
        d.fichas.map(
          (f) =>
            `- ${comLink(f.id, f.link)} ${f.titulo} — ${f.papel}${f.dispositivos.length ? ` (${f.dispositivos.join(", ")})` : ""}`,
        ),
        3500,
        "fichas (lista completa no JSON)",
      ),
      `Tópicos atingidos: ${d.topicos.length ? d.topicos.map((t) => `\`${t}\``).join(", ") : "nenhum"}.`,
    ].join("\n\n");
  },
});
