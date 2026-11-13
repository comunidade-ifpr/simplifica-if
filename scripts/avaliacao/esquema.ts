/**
 * Contratos (zod) dos arquivos de `avaliacao/`: perguntas, configuração do harness, gabaritos de
 * conjunto, universos de itens reconhecíveis numa resposta e PPCs-ouro.
 */
import { z } from "zod";
import { compilarPadrao } from "./normalizar.ts";

const textoNaoVazio = z.string().trim().min(1);

/** Fonte de regex aplicada ao texto normalizado (sem acentos, minúsculo); precisa compilar. */
export const esquemaPadrao = textoNaoVazio.superRefine((fonte, ctx) => {
  try {
    compilarPadrao(fonte);
  } catch (erro) {
    ctx.addIssue({ code: "custom", message: `regex inválida: ${(erro as Error).message}` });
  }
});

/**
 * Âncora provisória no formato de ID canônico do plano (fase 2): `br/cne-cp/res/2026/2#art71`,
 * `cnct:tecnico-em-enfermagem`, `curso:curitiba/tecnico-em-enfermagem`, `ficha:CT-CURR-20`.
 */
export const esquemaAncora = z
  .string()
  .regex(
    /^(?:(?:br|ifpr)\/[a-z0-9-]+\/(?:[a-z]+\/)?\d{4}\/[0-9a-z-]+(?:#[a-zA-Z0-9-]+)?|(?:cnct|curso|campus|ppc|ficha|externo):[^\s]+)$/u,
    "âncora fora do formato de ID do plano",
  );

export const esquemaCriterio = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/u, "id em kebab-case"),
  descricao: textoNaoVazio,
  /** ID provisório no formato da fase 2; mapeado para o ID canônico quando ele existir. */
  ancora: esquemaAncora.optional(),
  /** Caminho, a partir da raiz do repositório, do arquivo onde o `trecho` aparece literalmente. */
  arquivo: textoNaoVazio.optional(),
  /** Trecho literal curto da fonte; o teste confere que ele existe em `arquivo`. */
  trecho: textoNaoVazio.optional(),
  /** Basta um padrão casar para o critério contar como presente. */
  padroes: z.array(esquemaPadrao).min(1),
});
export type Criterio = z.output<typeof esquemaCriterio>;

export const CATEGORIAS = [
  "carga-horaria",
  "citacao-dispositivo",
  "vigencia",
  "impacto-revogacao",
  "agregacao-institucional",
  "busca-tematica-ppc",
  "cnct",
  "correspondencia",
  "fluxo-processual",
] as const;

export const esquemaGabarito = z
  .strictObject({
    /** `curado`: verificado na base local. `provisorio`: depende de curadoria humana ou de fase futura. */
    status: z.enum(["curado", "provisorio"]),
    resposta_esperada: textoNaoVazio,
    deve_conter: z.array(esquemaCriterio).default([]),
    nao_deve_conter: z.array(esquemaCriterio).default([]),
    /** Gabarito de conjunto gerado por `scripts/avaliacao/gabaritos/gerar.ts`. */
    conjunto: z.strictObject({ arquivo: textoNaoVazio }).optional(),
    observacoes: z.string().optional(),
  })
  .superRefine((gabarito, ctx) => {
    if (gabarito.deve_conter.length === 0 && !gabarito.conjunto) {
      ctx.addIssue({ code: "custom", message: "gabarito sem deve_conter nem conjunto" });
    }
  });
export type Gabarito = z.output<typeof esquemaGabarito>;

export const esquemaPergunta = z
  .strictObject({
    id: z.string().regex(/^Q\d{2}$/u, "id no formato Q01"),
    texto: textoNaoVazio,
    categoria: z.enum(CATEGORIAS),
    tipo: z.enum(["pontual", "conjunto"]),
    origem: z.enum(["plano", "uso-real"]),
    gabarito: esquemaGabarito,
  })
  .superRefine((pergunta, ctx) => {
    if (pergunta.tipo === "conjunto" && !pergunta.gabarito.conjunto) {
      ctx.addIssue({ code: "custom", message: "pergunta de conjunto sem gabarito.conjunto" });
    }
    if (pergunta.tipo === "pontual" && pergunta.gabarito.conjunto) {
      ctx.addIssue({ code: "custom", message: "pergunta pontual com gabarito.conjunto" });
    }
  });
export type Pergunta = z.output<typeof esquemaPergunta>;

export const esquemaArquivoPerguntas = z
  .strictObject({ versao: z.literal(1), perguntas: z.array(esquemaPergunta).min(1) })
  .superRefine((arquivo, ctx) => {
    const vistos = new Set<string>();
    for (const [indice, pergunta] of arquivo.perguntas.entries()) {
      if (vistos.has(pergunta.id)) {
        ctx.addIssue({ code: "custom", path: ["perguntas", indice, "id"], message: `id repetido: ${pergunta.id}` });
      }
      vistos.add(pergunta.id);
      const criterios = new Set<string>();
      for (const criterio of [...pergunta.gabarito.deve_conter, ...pergunta.gabarito.nao_deve_conter]) {
        if (criterios.has(criterio.id)) {
          ctx.addIssue({
            code: "custom",
            path: ["perguntas", indice, "gabarito"],
            message: `${pergunta.id}: critério repetido: ${criterio.id}`,
          });
        }
        criterios.add(criterio.id);
      }
    }
  });
export type ArquivoPerguntas = z.output<typeof esquemaArquivoPerguntas>;

/* ------------------------------------------------------------- configuração */

export const esquemaConfig = z.strictObject({
  /** Alias ou nome completo aceito por `claude --model`. O relatório registra o ID efetivo. */
  modelo: textoNaoVazio,
  execucoes: z.number().int().min(1).max(20),
  max_turns: z.number().int().min(1).max(200),
  max_budget_usd_por_execucao: z.number().positive().optional(),
  timeout_s: z.number().int().min(10).default(600),
  /** Ferramentas embutidas disponíveis ao agente (`--tools`). */
  ferramentas: z.array(textoNaoVazio).min(1),
  /** Regras pré-aprovadas (`--allowedTools`); o resto é negado (`--permission-mode dontAsk`). */
  ferramentas_permitidas: z.array(textoNaoVazio).min(1),
  instrucao_sistema: z.string().default(""),
  /**
   * Fontes de configuração do Claude Code (`--setting-sources`). Sem o campo, valem as do usuário,
   * inclusive plugins e hooks pessoais, que mudam o estilo da resposta.
   */
  fontes_configuracao: z
    .array(z.enum(["user", "project", "local"]))
    .min(1)
    .optional(),
});
export type ConfigAvaliacao = z.output<typeof esquemaConfig>;

/* ---------------------------------------------------------------- universos */

export const UNIVERSOS = ["campus", "curso", "norma"] as const;
export type NomeUniverso = (typeof UNIVERSOS)[number];

export const esquemaItemCampus = z.strictObject({
  id: z.string().startsWith("campus:"),
  rotulo: textoNaoVazio,
  padroes: z.array(esquemaPadrao).min(1),
});

export const esquemaItemCurso = z.strictObject({
  id: z.string().startsWith("curso:"),
  rotulo: textoNaoVazio,
  campus: z.string().startsWith("campus:"),
  /** Nome normalizado sem "Técnico em", forma de oferta etc.: "informatica para internet". */
  nucleo: textoNaoVazio,
  /** Termos normalizados que distinguem cursos de mesmo núcleo no mesmo campus. */
  forma: z.array(z.string()),
});

export const esquemaItemNorma = z.strictObject({
  id: textoNaoVazio,
  rotulo: textoNaoVazio,
  path: textoNaoVazio,
  padroes: z.array(esquemaPadrao).min(1),
});

export const esquemaUniversos = z.strictObject({
  gerado_por: textoNaoVazio,
  campus: z.array(esquemaItemCampus),
  curso: z.array(esquemaItemCurso),
  norma: z.array(esquemaItemNorma),
});
export type Universos = z.output<typeof esquemaUniversos>;
export type ItemCampus = z.output<typeof esquemaItemCampus>;
export type ItemCurso = z.output<typeof esquemaItemCurso>;
export type ItemNorma = z.output<typeof esquemaItemNorma>;

export const esquemaGabaritoConjunto = z.strictObject({
  pergunta: z.string().regex(/^Q\d{2}$/u),
  gerado_por: textoNaoVazio,
  criterio: textoNaoVazio,
  universo: z.enum(UNIVERSOS),
  /** Falso quando a resposta correta pode citar itens fora do conjunto sem errar (ex.: normas afetadas). */
  avaliar_precisao: z.boolean(),
  esperado: z.array(textoNaoVazio),
  detalhes: z.record(z.string(), z.unknown()),
});
export type GabaritoConjunto = z.output<typeof esquemaGabaritoConjunto>;

/* -------------------------------------------------------------- PPCs-ouro */

export const ESTADOS_FICHA = ["ATENDE", "NAO_ATENDE", "INCONCLUSIVO", "NAO_APLICAVEL"] as const;

export const esquemaAchadoOuro = z.strictObject({
  ficha: z.string().regex(/^CT-(?:CURR|IDENT|SUP|TRANS)-\d{2}$/u),
  estado_esperado: z.enum(ESTADOS_FICHA),
  justificativa: textoNaoVazio,
  /** Trechos literais do PPC convertido; o teste confere que cada um existe no arquivo. */
  evidencias: z.array(z.strictObject({ trecho: textoNaoVazio, observacao: z.string().optional() })).min(1),
  /** Fontes de comparação fora do PPC (CNCT, normas, dados institucionais), com trecho literal opcional. */
  referencias: z
    .array(z.strictObject({ ancora: esquemaAncora, arquivo: textoNaoVazio, trecho: z.string().optional() }))
    .default([]),
  status: z.enum(["rascunho", "revisado"]),
});

export const esquemaPpcOuro = z.strictObject({
  ppc: z.string().startsWith("curso:"),
  arquivo: textoNaoVazio,
  status: z.enum(["rascunho", "revisado"]),
  revisado_por: z.string().nullable(),
  justificativa_escolha: textoNaoVazio,
  achados: z.array(esquemaAchadoOuro).min(1),
});
export type PpcOuro = z.output<typeof esquemaPpcOuro>;
