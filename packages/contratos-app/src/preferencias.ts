/**
 * O primeiro uso (M1.8): o perfil da pessoa (campus, função e cursos), o aviso de uso aceito, as
 * boas-vindas concluídas e as IAs que ela deixou de usar no app. Tudo fica só neste computador, no
 * banco do servidor local (`conversas.sqlite`); nada disso vai à IA nem a outro lugar.
 *
 * A função do perfil se traduz nos públicos do manifesto de skill (`@simplifica-if/mcp/publicos`): o
 * Início põe primeiro as tarefas que servem a ela.
 */
import { PUBLICOS, type Publico } from "@simplifica-if/mcp/publicos";
import { Provider } from "@simplifica-if/motor/eventos";
import * as Schema from "effect/Schema";
import { Rpc, RpcGroup } from "effect/rpc";

export { PUBLICOS, type Publico };

/** As funções que o perfil oferece. `proens-dens` junta a Pró-Reitoria e a diretoria dela. */
export const FUNCOES = ["coordenacao-curso", "pedagogia", "docente", "direcao-ensino", "proens-dens", "outra"] as const;

export const FuncaoPerfil = Schema.Literals(FUNCOES);
export type FuncaoPerfil = typeof FuncaoPerfil.Type;

export interface DescricaoFuncao {
  /** Como a pessoa se apresenta: "Coordenação de Curso". */
  readonly rotulo: string;
  /** Os públicos de manifesto que servem a ela; vazio em `outra` (nada se filtra). */
  readonly publicos: ReadonlyArray<Publico>;
}

export const DESCRICOES_FUNCAO: Readonly<Record<FuncaoPerfil, DescricaoFuncao>> = {
  "coordenacao-curso": { rotulo: "Coordenação de Curso", publicos: ["coordenacao-curso"] },
  pedagogia: { rotulo: "Pedagogia", publicos: ["pedagogia"] },
  docente: { rotulo: "Docente", publicos: ["docente"] },
  "direcao-ensino": { rotulo: "Direção de Ensino", publicos: ["direcao-ensino"] },
  "proens-dens": { rotulo: "PROENS/DENS", publicos: ["proens", "dens"] },
  outra: { rotulo: "Outra função", publicos: [] },
};

const Texto = (maximo: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(maximo));

/** Um campus ou um curso da base: o ID (o de `sobreABase` ou de `listarCursos`) e o nome mostrado. */
export const ItemPerfil = Schema.Struct({ id: Texto(200), nome: Texto(300) });
export type ItemPerfil = typeof ItemPerfil.Type;

/** Quantos cursos o perfil guarda. */
export const MAXIMO_CURSOS_PERFIL = 30;

export const Perfil = Schema.Struct({
  campus: Schema.optionalKey(ItemPerfil),
  funcao: Schema.optionalKey(FuncaoPerfil),
  cursos: Schema.Array(ItemPerfil).check(Schema.isMaxLength(MAXIMO_CURSOS_PERFIL)),
});
export type Perfil = typeof Perfil.Type;

/** O que o servidor local guarda do primeiro uso. As datas são ISO 8601. */
export const Preferencias = Schema.Struct({
  perfil: Schema.optionalKey(Perfil),
  /** Quando a pessoa clicou "Entendi" no aviso de uso. */
  avisoAceitoEm: Schema.optionalKey(Schema.String),
  /** Quando as boas-vindas terminaram (concluídas ou puladas). */
  boasVindasEm: Schema.optionalKey(Schema.String),
  /** As IAs que a pessoa deixou de usar no app (Configurações › Sua IA › "Não usar no app"). */
  iasDesligadas: Schema.Array(Provider),
});
export type Preferencias = typeof Preferencias.Type;

/**
 * A pessoa ainda não aceitou o aviso de uso (`preferencias.aceitarAviso`): o servidor não manda nada à
 * IA antes disso (conversa, revisão com IA, ações com IA da lista de pendências).
 */
export class AvisoNaoAceito extends Schema.TaggedError<AvisoNaoAceito>()("AvisoNaoAceito", {}) {
  override get message(): string {
    return 'Antes de usar a IA, leia o aviso de uso e clique em "Entendi" (Início ou Configurações › Sua IA).';
  }
}

export const ehAvisoNaoAceito = Schema.is(AvisoNaoAceito);

const Vazio = Schema.Struct({});

export class GrupoPreferencias extends RpcGroup.make(
  Rpc.make("preferencias.ler", { payload: Vazio, success: Preferencias }),
  Rpc.make("preferencias.gravarPerfil", { payload: Schema.Struct({ perfil: Perfil }), success: Preferencias }),
  Rpc.make("preferencias.apagarPerfil", { payload: Vazio, success: Preferencias }),
  Rpc.make("preferencias.aceitarAviso", { payload: Vazio, success: Preferencias }),
  Rpc.make("preferencias.concluirBoasVindas", { payload: Vazio, success: Preferencias }),
  /** Volta a usar (`usar: true`) ou deixa de usar no app uma IA, sem sair da conta dela. */
  Rpc.make("preferencias.usarIa", {
    payload: Schema.Struct({ provider: Provider, usar: Schema.Boolean }),
    success: Preferencias,
  }),
) {}

/** "Coordenação de Curso · Campus Curitiba", ou `undefined` sem função nem campus. */
export function linhaDoPerfil(perfil: Perfil | undefined): string | undefined {
  const campus = perfil?.campus?.nome;
  const partes = [
    perfil?.funcao === undefined || perfil.funcao === "outra" ? undefined : DESCRICOES_FUNCAO[perfil.funcao].rotulo,
    campus === undefined ? undefined : /^(campus|reitoria)\b/i.test(campus) ? campus : `Campus ${campus}`,
  ].filter((parte): parte is string => parte !== undefined);
  return partes.length === 0 ? undefined : partes.join(" · ");
}
