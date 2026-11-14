/**
 * Contratos (Effect Schema) dos arquivos de `avaliacao/`: perguntas, configuração do harness,
 * gabaritos de conjunto, universos de itens reconhecíveis numa resposta e PPCs-ouro.
 *
 * Os objetos são estritos: decodifique com `ESTRITO` (`scripts/esquema.ts`), como faz
 * `carregar.ts`. Os textos obrigatórios chegam sem espaços nas pontas (`Schema.Trim`).
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { compilarPadrao } from "./normalizar.ts";

/** Texto com as pontas aparadas e pelo menos um caractere. */
const textoNaoVazio = Schema.Trim.check(Schema.isMinLength(1));

/** Número finito, como o `z.number()` (recusa `.inf` e `.nan` do YAML). */
const numero = Schema.Finite;

/** Lista que fica vazia quando o campo falta. */
const listaOuVazia = <S extends Schema.Top>(item: S) =>
  Schema.Array(item).pipe(Schema.withDecodingDefault(Effect.succeed([])));

/** Fonte de regex aplicada ao texto normalizado (sem acentos, minúsculo); precisa compilar. */
export const esquemaPadrao = textoNaoVazio.check(
  Schema.makeFilter((fonte: string) => {
    try {
      compilarPadrao(fonte);
      return true;
    } catch (erro) {
      return `regex inválida: ${(erro as Error).message}`;
    }
  }),
);

/**
 * Âncora provisória no formato de ID canônico do plano (fase 2): `br/cne-cp/res/2026/2#art71`,
 * `cnct:tecnico-em-enfermagem`, `curso:curitiba/tecnico-em-enfermagem`, `ficha:CT-CURR-20`.
 */
export const esquemaAncora = Schema.String.check(
  Schema.isPattern(
    /^(?:(?:br|ifpr)\/[a-z0-9-]+\/(?:[a-z]+\/)?\d{4}\/[0-9a-z-]+(?:#[a-zA-Z0-9-]+)?|(?:cnct|curso|campus|ppc|ficha|externo):[^\s]+)$/u,
    { message: "âncora fora do formato de ID do plano" },
  ),
);

export const esquemaCriterio = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/u, { message: "id em kebab-case" })),
  descricao: textoNaoVazio,
  /** ID provisório no formato da fase 2; mapeado para o ID canônico quando ele existir. */
  ancora: Schema.optional(esquemaAncora),
  /** Caminho, a partir da raiz do repositório, do arquivo onde o `trecho` aparece literalmente. */
  arquivo: Schema.optional(textoNaoVazio),
  /** Trecho literal curto da fonte; o teste confere que ele existe em `arquivo`. */
  trecho: Schema.optional(textoNaoVazio),
  /** Basta um padrão casar para o critério contar como presente. */
  padroes: Schema.Array(esquemaPadrao).check(Schema.isMinLength(1)),
});
export type Criterio = typeof esquemaCriterio.Type;

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

export const esquemaGabarito = Schema.Struct({
  /** `curado`: verificado na base local. `provisorio`: depende de curadoria humana ou de fase futura. */
  status: Schema.Literals(["curado", "provisorio"]),
  resposta_esperada: textoNaoVazio,
  deve_conter: listaOuVazia(esquemaCriterio),
  nao_deve_conter: listaOuVazia(esquemaCriterio),
  /** Gabarito de conjunto gerado por `scripts/avaliacao/gabaritos/gerar.ts`. */
  conjunto: Schema.optional(Schema.Struct({ arquivo: textoNaoVazio })),
  observacoes: Schema.optional(Schema.String),
}).check(
  Schema.makeFilter((gabarito) =>
    gabarito.deve_conter.length === 0 && !gabarito.conjunto ? "gabarito sem deve_conter nem conjunto" : true,
  ),
);
export type Gabarito = typeof esquemaGabarito.Type;

export const esquemaPergunta = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^Q\d{2}$/u, { message: "id no formato Q01" })),
  texto: textoNaoVazio,
  categoria: Schema.Literals(CATEGORIAS),
  tipo: Schema.Literals(["pontual", "conjunto"]),
  origem: Schema.Literals(["plano", "uso-real"]),
  gabarito: esquemaGabarito,
}).check(
  Schema.makeFilter((pergunta) => {
    if (pergunta.tipo === "conjunto" && !pergunta.gabarito.conjunto) return "pergunta de conjunto sem gabarito.conjunto";
    if (pergunta.tipo === "pontual" && pergunta.gabarito.conjunto) return "pergunta pontual com gabarito.conjunto";
    return true;
  }),
);
export type Pergunta = typeof esquemaPergunta.Type;

export const esquemaArquivoPerguntas = Schema.Struct({
  versao: Schema.Literal(1),
  perguntas: Schema.Array(esquemaPergunta).check(Schema.isMinLength(1)),
}).check(
  Schema.makeFilter((arquivo) => {
    const problemas: Schema.FilterIssue[] = [];
    const vistos = new Set<string>();
    for (const [indice, pergunta] of arquivo.perguntas.entries()) {
      if (vistos.has(pergunta.id)) {
        problemas.push({ path: ["perguntas", indice, "id"], issue: `id repetido: ${pergunta.id}` });
      }
      vistos.add(pergunta.id);
      const criterios = new Set<string>();
      for (const criterio of [...pergunta.gabarito.deve_conter, ...pergunta.gabarito.nao_deve_conter]) {
        if (criterios.has(criterio.id)) {
          problemas.push({
            path: ["perguntas", indice, "gabarito"],
            issue: `${pergunta.id}: critério repetido: ${criterio.id}`,
          });
        }
        criterios.add(criterio.id);
      }
    }
    return problemas.length === 0 ? true : problemas;
  }),
);
export type ArquivoPerguntas = typeof esquemaArquivoPerguntas.Type;

/* ------------------------------------------------------------- configuração */

/**
 * Bash dá ao agente leitura de qualquer arquivo e do ambiente (`jq -R . .env.local`, `jq -n env`),
 * fora do alcance das regras de Read; o harness não o oferece.
 */
const ferramentaSemBash = textoNaoVazio.check(
  Schema.makeFilter((regra: string) => !/^Bash(?:\(|$)/u.test(regra), {
    message: "Bash não é permitido no harness: contorna as regras de leitura (use Read, Grep e Glob)",
  }),
);

export const esquemaConfig = Schema.Struct({
  /** Alias ou nome completo aceito por `claude --model`. O relatório registra o ID efetivo. */
  modelo: textoNaoVazio,
  execucoes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(20)),
  max_turns: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(200)),
  max_budget_usd_por_execucao: Schema.optional(numero.check(Schema.isGreaterThan(0))),
  timeout_s: Schema.Int.check(Schema.isGreaterThanOrEqualTo(10)).pipe(Schema.withDecodingDefault(Effect.succeed(600))),
  /** Ferramentas embutidas disponíveis ao agente (`--tools`). Só leitura; Bash não (ver executor.ts). */
  ferramentas: Schema.Array(ferramentaSemBash).check(Schema.isMinLength(1)),
  /**
   * Regras pré-aprovadas (`--allowedTools`); o resto é negado (`--permission-mode dontAsk`). As
   * regras de `REGRAS_NEGADAS` (executor.ts) vão sempre em `--disallowedTools` e prevalecem.
   */
  ferramentas_permitidas: Schema.Array(ferramentaSemBash).check(Schema.isMinLength(1)),
  instrucao_sistema: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  /**
   * Fontes de configuração do Claude Code (`--setting-sources`). Sem o campo, valem as do usuário,
   * inclusive plugins e hooks pessoais, que mudam o estilo da resposta.
   */
  fontes_configuracao: Schema.optional(
    Schema.Array(Schema.Literals(["user", "project", "local"])).check(Schema.isMinLength(1)),
  ),
});
export type ConfigAvaliacao = typeof esquemaConfig.Type;

/* ---------------------------------------------------------------- universos */

export const UNIVERSOS = ["campus", "curso", "norma"] as const;
export type NomeUniverso = (typeof UNIVERSOS)[number];

const idCom = (prefixo: string) => Schema.String.check(Schema.isStartingWith(prefixo));

export const esquemaItemCampus = Schema.Struct({
  id: idCom("campus:"),
  rotulo: textoNaoVazio,
  padroes: Schema.Array(esquemaPadrao).check(Schema.isMinLength(1)),
});

export const esquemaItemCurso = Schema.Struct({
  id: idCom("curso:"),
  rotulo: textoNaoVazio,
  campus: idCom("campus:"),
  /** Nome normalizado sem "Técnico em", forma de oferta etc.: "informatica para internet". */
  nucleo: textoNaoVazio,
  /** Termos normalizados que distinguem cursos de mesmo núcleo no mesmo campus. */
  forma: Schema.Array(Schema.String),
});

export const esquemaItemNorma = Schema.Struct({
  id: textoNaoVazio,
  rotulo: textoNaoVazio,
  path: textoNaoVazio,
  padroes: Schema.Array(esquemaPadrao).check(Schema.isMinLength(1)),
});

export const esquemaUniversos = Schema.Struct({
  gerado_por: textoNaoVazio,
  campus: Schema.Array(esquemaItemCampus),
  curso: Schema.Array(esquemaItemCurso),
  norma: Schema.Array(esquemaItemNorma),
});
export type Universos = typeof esquemaUniversos.Type;
export type ItemCampus = typeof esquemaItemCampus.Type;
export type ItemCurso = typeof esquemaItemCurso.Type;
export type ItemNorma = typeof esquemaItemNorma.Type;

export const esquemaGabaritoConjunto = Schema.Struct({
  pergunta: Schema.String.check(Schema.isPattern(/^Q\d{2}$/u)),
  gerado_por: textoNaoVazio,
  criterio: textoNaoVazio,
  universo: Schema.Literals(UNIVERSOS),
  /** Falso quando a resposta correta pode citar itens fora do conjunto sem errar (ex.: normas afetadas). */
  avaliar_precisao: Schema.Boolean,
  esperado: Schema.Array(textoNaoVazio),
  detalhes: Schema.Record(Schema.String, Schema.Unknown),
});
export type GabaritoConjunto = typeof esquemaGabaritoConjunto.Type;

/* -------------------------------------------------------------- PPCs-ouro */

export const ESTADOS_FICHA = ["ATENDE", "NAO_ATENDE", "INCONCLUSIVO", "NAO_APLICAVEL"] as const;

export const esquemaAchadoOuro = Schema.Struct({
  ficha: Schema.String.check(Schema.isPattern(/^CT-(?:CURR|IDENT|SUP|TRANS)-\d{2}$/u)),
  estado_esperado: Schema.Literals(ESTADOS_FICHA),
  justificativa: textoNaoVazio,
  /** Trechos literais do PPC convertido; o teste confere que cada um existe no arquivo. */
  evidencias: Schema.Array(
    Schema.Struct({ trecho: textoNaoVazio, observacao: Schema.optional(Schema.String) }),
  ).check(Schema.isMinLength(1)),
  /** Fontes de comparação fora do PPC (CNCT, normas, dados institucionais), com trecho literal opcional. */
  referencias: listaOuVazia(
    Schema.Struct({ ancora: esquemaAncora, arquivo: textoNaoVazio, trecho: Schema.optional(Schema.String) }),
  ),
  status: Schema.Literals(["rascunho", "revisado"]),
});

export const esquemaPpcOuro = Schema.Struct({
  ppc: idCom("curso:"),
  arquivo: textoNaoVazio,
  status: Schema.Literals(["rascunho", "revisado"]),
  revisado_por: Schema.NullOr(Schema.String),
  justificativa_escolha: textoNaoVazio,
  achados: Schema.Array(esquemaAchadoOuro).check(Schema.isMinLength(1)),
});
export type PpcOuro = typeof esquemaPpcOuro.Type;
