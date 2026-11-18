/** A atualização da base e das skills (M1.10), como a seção "Configurações › Atualizações" a mostra. */
import { CANAIS_DISTRIBUICAO } from "@simplifica-if/kb/canal";
import * as Schema from "effect/Schema";
import { Rpc, RpcGroup } from "effect/rpc";

/** Canal de atualização da base e das skills (o do app segue o mesmo). */
export const CanalAtualizacao = Schema.Literals(CANAIS_DISTRIBUICAO);
export type CanalAtualizacao = typeof CanalAtualizacao.Type;

/** Uma entrada de `base-conhecimento/novidades.yaml`, como chega ao aviso "Base atualizada". */
export const NovidadeBase = Schema.Struct({
  tipo: Schema.String,
  titulo: Schema.String,
  detalhe: Schema.optionalKey(Schema.String),
  afeta: Schema.optionalKey(Schema.Array(Schema.String)),
});
export type NovidadeBase = typeof NovidadeBase.Type;

/** Uma versão da base: a do manifesto (`2026.11.13`), a data de referência e o commit das fontes. */
export const VersaoBaseApp = Schema.Struct({
  versao: Schema.String,
  dataReferencia: Schema.NullOr(Schema.String),
  commit: Schema.NullOr(Schema.String),
  /** `empacotada`: a que veio no instalador; `baixada`: a da pasta do app. */
  origem: Schema.Literals(["empacotada", "baixada", "externa"]),
});
export type VersaoBaseApp = typeof VersaoBaseApp.Type;

export const SituacaoAtualizacao = Schema.Literals(["parada", "conferindo", "baixando", "pronta", "erro"]);
export type SituacaoAtualizacao = typeof SituacaoAtualizacao.Type;

/** O que a seção "Configurações › Atualizações" mostra. */
export const EstadoAtualizacao = Schema.Struct({
  /** `null`: a atualização da base está ligada; senão, o motivo (sem feed na política, sem chave, `SIMPLIFICA_KB`). */
  desligada: Schema.NullOr(Schema.String),
  canal: CanalAtualizacao,
  situacao: SituacaoAtualizacao,
  /** A última falha (rede, assinatura, hash, banco inválido), em português. */
  erro: Schema.NullOr(Schema.String),
  /** Aviso que pede ação (o manifesto exige um app mais novo). */
  aviso: Schema.NullOr(Schema.String),
  versaoApp: Schema.String,
  base: VersaoBaseApp,
  /** Para onde "Voltar para a versão anterior da base" leva; `null` sem anterior ou se ela é a recusada. */
  anterior: Schema.NullOr(Schema.String),
  /** A versão baixada e conferida que entra quando o servidor reiniciar. */
  pendente: Schema.NullOr(Schema.String),
  /** Versão do conjunto de skills em uso (a do manifesto, ou `empacotadas`). */
  skills: Schema.String,
  skillsPendentes: Schema.NullOr(Schema.String),
  /** ISO 8601 da última conferência do manifesto que respondeu. */
  ultimaConferencia: Schema.NullOr(Schema.String),
  /** O `gerado_em` do último manifesto conferido: mais de 14 dias, e a tela avisa que não confirmou a base. */
  manifestoGeradoEm: Schema.NullOr(Schema.String),
  /** As novidades da base aplicada que a pessoa ainda não viu (o aviso "Base atualizada"). */
  novidades: Schema.NullOr(Schema.Struct({ versao: Schema.String, itens: Schema.Array(NovidadeBase) })),
});
export type EstadoAtualizacao = typeof EstadoAtualizacao.Type;

/**
 * Resultado de "aplicar agora" e de "voltar": a troca do arquivo só acontece com o servidor parado
 * (na abertura). `reiniciar`: nada rodando, a interface pede ao desktop para reiniciar o servidor;
 * `adiada`: uma revisão de PPC (prévia ou com IA) está rodando, e a troca fica para a próxima abertura; `nada`: não
 * há o que trocar.
 */
export const ResultadoTroca = Schema.Struct({
  resultado: Schema.Literals(["reiniciar", "adiada", "nada"]),
  mensagem: Schema.String,
});
export type ResultadoTroca = typeof ResultadoTroca.Type;

export class GrupoAtualizacao extends RpcGroup.make(
  Rpc.make("atualizacao.estado", { payload: Schema.Struct({}), success: EstadoAtualizacao }),
  /** "Procurar agora": confere o manifesto e baixa em segundo plano; devolve o estado ao fim. */
  Rpc.make("atualizacao.procurar", { payload: Schema.Struct({}), success: EstadoAtualizacao }),
  Rpc.make("atualizacao.trocarCanal", {
    payload: Schema.Struct({ canal: CanalAtualizacao }),
    success: EstadoAtualizacao,
  }),
  Rpc.make("atualizacao.aplicar", { payload: Schema.Struct({}), success: ResultadoTroca }),
  Rpc.make("atualizacao.voltar", { payload: Schema.Struct({}), success: ResultadoTroca }),
  Rpc.make("atualizacao.novidadesVistas", { payload: Schema.Struct({}), success: EstadoAtualizacao }),
) {}
