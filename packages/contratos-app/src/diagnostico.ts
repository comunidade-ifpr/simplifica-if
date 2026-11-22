/**
 * "Gerar diagnóstico" (Configurações › Diagnóstico): o pacote `.zip` que a pessoa anexa ao relato de um
 * problema, com os logs e os traces do app e um `sistema.json` com as versões e o ambiente.
 *
 * - **Prévia** (`diagnostico.preparar`): o que vai no pacote, arquivo por arquivo, com o tamanho, e o
 *   `sistema.json` como vai sair, para a pessoa ver antes de gerar.
 * - **Gerar** (`diagnostico.gerar`): grava `diagnostico-AAAA-MM-DD-HHMMSS.zip` em
 *   `Documentos/Simplifica IF/Diagnósticos/`, montado na hora (pode trazer linhas novas desde a prévia).
 *   Nada sai do computador: a pessoa anexa o arquivo, se quiser.
 *
 * Não entram as conversas, os anexos, as pastas de tarefa, o perfil, as senhas e chaves, nem a base. O
 * texto de cada arquivo passa pelo saneamento do servidor (pastas de tarefa, pasta pessoal, nome de
 * usuário nos caminhos, e-mails, segredos e dados pessoais).
 */
import * as Schema from "effect/Schema";
import { Rpc, RpcGroup } from "effect/rpc";

/**
 * Um arquivo do pacote: o nome dentro do `.zip`, o que ele é e o tamanho, já saneado; dos logs, as
 * últimas linhas, saneadas (as de JSON resumidas numa linha), para a pessoa ver o que vai.
 */
export const ItemDiagnostico = Schema.Struct({
  nome: Schema.String,
  descricao: Schema.String,
  bytes: Schema.Number,
  trecho: Schema.optional(Schema.String),
});
export type ItemDiagnostico = typeof ItemDiagnostico.Type;

/** Um arquivo que ficou de fora do pacote, com o motivo em português. */
export const ItemForaDiagnostico = Schema.Struct({ nome: Schema.String, motivo: Schema.String });
export type ItemForaDiagnostico = typeof ItemForaDiagnostico.Type;

export const PreviaDiagnostico = Schema.Struct({
  itens: Schema.Array(ItemDiagnostico),
  /** Os logs que existiam e ficaram de fora, com o motivo (o limite de tamanho, a leitura que falhou). */
  foraDoPacote: Schema.Array(ItemForaDiagnostico),
  /** O `sistema.json` como vai no pacote. */
  sistema: Schema.String,
  /** Há logs do app neste computador (sem a pasta de logs, o pacote leva só o `sistema.json`). */
  temLogs: Schema.Boolean,
  /** Há onde gravar o pacote (`Documentos/Simplifica IF/Diagnósticos/`). */
  podeGerar: Schema.Boolean,
});
export type PreviaDiagnostico = typeof PreviaDiagnostico.Type;

export const DiagnosticoGerado = Schema.Struct({
  /** O caminho do `.zip` gravado. */
  arquivo: Schema.String,
  bytes: Schema.Number,
});
export type DiagnosticoGerado = typeof DiagnosticoGerado.Type;

/**
 * O diagnóstico não saiu, com a frase para a pessoa em `motivo` e a falha de arquivo em `cause` (só no
 * log do servidor: os handlers a tiram antes da interface).
 */
export class FalhaDiagnostico extends Schema.TaggedError<FalhaDiagnostico>()("FalhaDiagnostico", {
  motivo: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.motivo;
  }
}
export const ehFalhaDiagnostico = Schema.is(FalhaDiagnostico);

export class GrupoDiagnostico extends RpcGroup.make(
  Rpc.make("diagnostico.preparar", {
    payload: Schema.Struct({}),
    success: PreviaDiagnostico,
    error: FalhaDiagnostico,
  }),
  Rpc.make("diagnostico.gerar", {
    payload: Schema.Struct({}),
    success: DiagnosticoGerado,
    error: FalhaDiagnostico,
  }),
) {}
