/**
 * Ferramenta 5, `resolver_citacoes`: citações normativas em texto livre, em lote, para o ID
 * canônico (`resolverBanco`, o `kb resolver`, com o registro montado da tabela `normas`).
 */
import { resolverBanco } from "@simplifica-if/kb/db/modo-banco";
import { z } from "zod";
import { type Aviso, esquemaLink, responder } from "../envelope.ts";
import { linkDe } from "../links.ts";
import { comLink } from "../texto.ts";
import { definirFerramenta } from "./ferramenta.ts";
import { limitarTexto, tetoDoCorpo } from "./normas-comum.ts";

/** Abaixo disto, a citação pede conferência no trecho original (descrição da ferramenta). */
export const CONFIANCA_CONFERIR = 0.9;
/** Teto do texto para a IA (a especificação não fixa um para esta ferramenta). */
export const TETO_RESOLVER_CITACOES = 12_000;

/** `nao-registrada`: o ID foi reconhecido, mas a norma não está no registro da base. */
export const SITUACOES_CITACAO = ["base", "stub", "externo", "nao-registrada", "nao-resolvida"] as const;

const entrada = z.strictObject({
  citacoes: z
    .array(z.string().trim().min(1).max(500))
    .min(1)
    .max(50)
    .describe('1 a 50 citações em texto livre, como "Resolução CNE/CP nº 1/2021, art. 20"'),
});

const dados = z.strictObject({
  itens: z.array(
    z.strictObject({
      texto: z.string(),
      id: z.string().nullable(),
      /** IDs completos dos dispositivos citados (`br/cne-cp/res/2021/1#art20`). */
      dispositivos: z.array(z.string()),
      regra: z.string(),
      confianca: z.number(),
      situacao: z.enum(SITUACOES_CITACAO),
      titulo: z.string().nullable(),
      link: esquemaLink.nullable(),
    }),
  ),
});

export const resolverCitacoes = definirFerramenta({
  nome: "resolver_citacoes",
  titulo: "Identificar citações",
  descricao:
    "Identifica citações normativas escritas em texto livre (até 50 por chamada) e devolve o ID canônico, o dispositivo, a regra usada e a confiança. Use para conferir a fundamentação de um documento. Confiança abaixo de 0,9 pede conferência no trecho original.",
  entrada,
  dados,
  executar({ citacoes }, { db, base }) {
    const itens = citacoes.map((texto) => {
      const r = resolverBanco(db, texto);
      const sufixos = r.dispositivos ?? (r.dispositivoId ? [r.dispositivoId] : []);
      return {
        texto,
        id: r.id,
        dispositivos: r.id ? sufixos.map((d) => `${r.id}${d}`) : [],
        regra: r.regra,
        confianca: r.confianca,
        situacao: r.situacao,
        titulo: r.titulo ?? null,
        // `cnct:` é o catálogo (ou um curso dele), que tem link próprio; o resto é norma
        link: r.id ? linkDe(r.id) : null,
      };
    });
    const avisos: Aviso[] = [];
    const baixas = itens.filter((i) => i.id !== null && i.confianca < CONFIANCA_CONFERIR).length;
    if (baixas > 0) {
      avisos.push({
        tipo: "citacao-baixa-confianca",
        mensagem: `${baixas} ${baixas === 1 ? "citação resolvida" : "citações resolvidas"} com confiança abaixo de 0,9: confira no trecho original antes de afirmar`,
      });
    }
    const naoResolvidas = itens.filter((i) => i.id === null).length;
    if (naoResolvidas > 0) {
      avisos.push({
        tipo: "nao-encontrado",
        mensagem: `${naoResolvidas} ${naoResolvidas === 1 ? "citação não identificada" : "citações não identificadas"}: tente buscar_norma com os termos, e não preencha com memória`,
      });
    }
    // o CNCT (`cnct:`) está na base, nos catálogos: não é "sem texto"
    const semTexto = [
      ...new Set(
        itens
          .filter((i) => (i.situacao === "stub" || i.situacao === "externo") && !i.id!.startsWith("cnct:"))
          .map((i) => i.id!),
      ),
    ];
    for (const id of semTexto) {
      avisos.push({
        tipo: "stub-sem-texto",
        mensagem: "norma citada sem texto na base: não afirme o conteúdo dela",
        ref: id,
      });
    }
    return responder(base, { itens }, { avisos });
  },
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
