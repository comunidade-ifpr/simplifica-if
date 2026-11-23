/**
 * Contratos de leitura da base do IFPR, em Effect Schema: o envelope comum das respostas
 * (especificação M0.1, "Envelope"), os tipos comuns às ferramentas ("Tipos comuns": `NormaResumo`,
 * `Relacao`, `DispositivoTexto`, transição e fatos de PPC) e os erros de leitura. São os mesmos
 * schemas das ferramentas MCP e do grupo RPC (`./rpc`).
 */
import { CANAIS } from "@simplifica-if/kb/canal";
import * as Schema from "effect/Schema";

export type { Link } from "./links.ts";

/* ================================================================== envelope */

const TIPOS_AVISO = [
  "vigencia-a-confirmar",
  "correspondencia-rascunho",
  "fato-extraido",
  "citacao-baixa-confianca",
  "stub-sem-texto",
  "resultado-resumido",
  "nao-encontrado",
] as const;

/**
 * Link `ifpr://` (contrato com a interface do app; ver `links.ts`). No schema, o tipo é `string`:
 * um refinamento para o tipo `Link` tiraria o `pattern` do JSON Schema.
 */
export const EsquemaLink = Schema.String.check(Schema.isPattern(/^ifpr:\/\/[\s\S]{1,}$/u));

export const Base = Schema.Struct({
  /** `AAAA.MM.DD` quando o pacote for publicado (T0); `dev-<8 hex de fontes_sha256>` antes disso. */
  versao: Schema.String,
  /** Commit de origem do pacote; `null` enquanto o banco não o registra (T0). */
  commit: Schema.NullOr(Schema.String),
  data_referencia: Schema.String,
  canal: Schema.Literals(CANAIS),
});
export type Base = typeof Base.Type;

export const Aviso = Schema.Struct({
  tipo: Schema.Literals(TIPOS_AVISO),
  mensagem: Schema.String,
  ref: Schema.optionalKey(Schema.String),
});
export type Aviso = typeof Aviso.Type;

/** Proveniência: caminho no repositório de origem e linhas, desde 1. */
export const Fonte = Schema.Struct({
  path: Schema.String,
  linha_inicio: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  linha_fim: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
});
export type Fonte = typeof Fonte.Type;

export const Pagina = Schema.Struct({
  total: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  devolvidos: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  /** Cursor opaco da próxima página; ausente na última. */
  cursor: Schema.optionalKey(Schema.String),
});
export type Pagina = typeof Pagina.Type;

/** A resposta inteira (envelope + dados): o `outputSchema` de cada ferramenta. */
export const Resposta = <D extends Schema.Top>(dados: D) =>
  Schema.Struct({
    base: Base,
    dados,
    avisos: Schema.Array(Aviso),
    pagina: Schema.optionalKey(Pagina),
  });

export interface Resposta<T> {
  readonly base: Base;
  readonly dados: T;
  readonly avisos: ReadonlyArray<Aviso>;
  readonly pagina?: Pagina;
}

/* ================================================================== erros */

/**
 * Erro causado pela entrada (ID desconhecido, filtro, cursor): a mensagem vai para a IA, que pode
 * corrigir a chamada. A mensagem é o próprio contrato com a IA, por isso fica inteira no atributo.
 */
export class EntradaInvalida extends Schema.TaggedError<EntradaInvalida>()("EntradaInvalida", {
  mensagem: Schema.String,
}) {
  override get message(): string {
    return this.mensagem;
  }
}

export const ehEntradaInvalida = Schema.is(EntradaInvalida);

/** O banco não respondeu como esperado (arquivo corrompido ou de outro esquema). */
export class FalhaNaBase extends Schema.TaggedError<FalhaNaBase>()("FalhaNaBase", {
  /** O que falhou, em texto do código (nunca dado de usuário). */
  operacao: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message(): string {
    return `falha ao ler a base (${this.operacao}); confira o kb.sqlite ou atualize o simplifica-mcp`;
  }
}

export const ehFalhaNaBase = Schema.is(FalhaNaBase);

/** Os erros de uma leitura: o que vai para a IA como resultado de erro. */
export const ErroDeLeitura = Schema.Union([EntradaInvalida, FalhaNaBase]);
export type ErroDeLeitura = EntradaInvalida | FalhaNaBase;

/* ================================================================== tipos comuns: normas */

export const SITUACOES_NORMA = ["base", "stub", "externo"] as const;

export const NormaResumo = Schema.Struct({
  id: Schema.String,
  titulo: Schema.String,
  situacao: Schema.Literals(SITUACOES_NORMA),
  /** Status publicado, calculado na `data_referencia` da base. */
  status_vigencia: Schema.NullOr(Schema.String),
  /** O front matter publicado traz `vigencia_a_confirmar`, ou o status é "a confirmar". */
  vigencia_a_confirmar: Schema.Boolean,
  data_publicacao: Schema.NullOr(Schema.String),
  ementa: Schema.NullOr(Schema.String),
  link: EsquemaLink,
});
export type NormaResumo = typeof NormaResumo.Type;

export const Relacao = Schema.Struct({
  tipo: Schema.String,
  origem: Schema.String,
  /** Dispositivo da origem que opera a relação (`#art74-ii`). */
  operador: Schema.NullOr(Schema.String),
  alvo: Schema.String,
  alvo_dispositivo: Schema.NullOr(Schema.String),
  /** Parte do alvo atingida, quando descrita em texto. */
  alcance: Schema.NullOr(Schema.String),
  /** Quando a relação produz efeito: `vigencia-da-origem` ou uma data AAAA-MM-DD. */
  efeito_de: Schema.String,
  evidencia: Schema.Struct({ em: Schema.String, trecho: Schema.String }),
  confirmado_em: Schema.NullOr(Schema.String),
  nota: Schema.NullOr(Schema.String),
});
export type Relacao = typeof Relacao.Type;

export const DispositivoTexto = Schema.Struct({
  /** ID canônico do ato com o dispositivo (`br/cne-cp/res/2026/2#art28-vii`). */
  id: Schema.String,
  rotulo: Schema.String,
  tipo: Schema.String,
  /** Caput herdado, do mais alto ao mais próximo. */
  caput: Schema.Array(Schema.String),
  /** Divisões em que o dispositivo está (`CAPÍTULO V`, título do capítulo…), da mais alta à mais próxima. */
  estrutura: Schema.Array(Schema.String),
  texto: Schema.String,
  subordinados: Schema.Array(Schema.Struct({ id: Schema.String, rotulo: Schema.String, texto: Schema.String })),
  revogado: Schema.Boolean,
  vetado: Schema.Boolean,
  fonte: Fonte,
  link: EsquemaLink,
});
export type DispositivoTexto = typeof DispositivoTexto.Type;

/* ================================================================== tipos comuns: PPCs e cursos */

export const TransicaoResumo = Schema.Struct({
  id: Schema.String,
  regra: Schema.String,
  /** `a-iniciar`, `em-curso`, `encerrada` ou `a confirmar`, na data de referência. */
  situacao_na_data: Schema.String,
  /** Dispositivo que estabelece a regra. */
  link: EsquemaLink,
});
export type TransicaoResumo = typeof TransicaoResumo.Type;

export const FatosPpc = Schema.Struct({
  ppc: Schema.String,
  curso: Schema.NullOr(Schema.String),
  nome: Schema.String,
  campus: Schema.String,
  nivel: Schema.String,
  forma: Schema.String,
  link: EsquemaLink,
  fatos: Schema.Array(
    Schema.Struct({
      fato: Schema.String,
      valor: Schema.String,
      valor_num: Schema.NullOr(Schema.Finite),
      unidade: Schema.NullOr(Schema.String),
      /** `extraido`: por regra, sem revisão humana. */
      status_curadoria: Schema.String,
      regra: Schema.String,
      trecho_fonte: Schema.String,
      fonte: Fonte,
    }),
  ),
  suap: Schema.NullOr(
    Schema.Struct({
      situacao: Schema.NullOr(Schema.String),
      carga_horaria_comum_h: Schema.NullOr(Schema.Finite),
      matrizes: Schema.Array(
        Schema.Struct({
          matriz_id: Schema.Int,
          ano: Schema.NullOr(Schema.Int),
          ch_exibida_h: Schema.NullOr(Schema.Finite),
          ch_estagio_h: Schema.NullOr(Schema.Finite),
          trecho: Schema.String,
        }),
      ),
    }),
  ),
  cruzamento: Schema.Array(
    Schema.Struct({
      aspecto: Schema.String,
      resultado: Schema.String,
      valor_ppc: Schema.NullOr(Schema.String),
      valor_suap: Schema.NullOr(Schema.String),
      explicacao: Schema.String,
    }),
  ),
});
export type FatosPpc = typeof FatosPpc.Type;
