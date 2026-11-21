/**
 * Contratos (Effect Schema) dos arquivos de `avaliacao/`: padrões e âncoras dos casos de skill e
 * PPCs-ouro.
 *
 * Os objetos são estritos: decodifique com `ESTRITO` (`scripts/esquema.ts`), como faz
 * `carregar.ts`. Os textos obrigatórios chegam sem espaços nas pontas (`Schema.Trim`).
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { compilarPadrao } from "./normalizar.ts";

/** Texto com as pontas aparadas e pelo menos um caractere. */
const textoNaoVazio = Schema.Trim.check(Schema.isMinLength(1));

const idCom = (prefixo: string) => Schema.String.check(Schema.isStartingWith(prefixo));

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

export const ESTADOS_FICHA = ["ATENDE", "NAO_ATENDE", "INCONCLUSIVO", "NAO_APLICAVEL"] as const;

export const esquemaAchadoOuro = Schema.Struct({
  ficha: Schema.String.check(Schema.isPattern(/^CT-(?:CURR|IDENT|SUP|TRANS)-\d{2}$/u)),
  estado_esperado: Schema.Literals(ESTADOS_FICHA),
  justificativa: textoNaoVazio,
  /** Trechos literais do PPC convertido; o teste confere que cada um existe no arquivo. */
  evidencias: Schema.Array(Schema.Struct({ trecho: textoNaoVazio, observacao: Schema.optional(Schema.String) })).check(
    Schema.isMinLength(1),
  ),
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
