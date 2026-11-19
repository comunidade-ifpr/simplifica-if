/** A pasta de trabalho da conversa: criar, anexar, ver e desfazer. */
import { SessaoDesconhecida, TurnoEmAndamento } from "@simplifica-if/motor/erros";
import * as Schema from "effect/Schema";
import { Rpc, RpcGroup } from "effect/rpc";

const EntradaSessao = Schema.Struct({ sessao: Schema.String });

/**
 * Uma recusa da pasta de trabalho (criar, anexar, ver, desfazer), com a frase para a pessoa em
 * `motivo`. A falha de arquivo embaixo dela fica em `cause`, que o servidor registra e não manda à
 * interface (pode ter caminho e pilha).
 */
export class FalhaPasta extends Schema.TaggedError<FalhaPasta>()("FalhaPasta", {
  motivo: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.motivo;
  }
}
export const ehFalhaPasta = Schema.is(FalhaPasta);

/** Um arquivo da pasta de trabalho da conversa. */
export const ArquivoPasta = Schema.Struct({
  /** O caminho relativo à pasta, com `/`. */
  nome: Schema.String,
  /** O caminho absoluto (para "Abrir" e "Mostrar na pasta" no desktop). */
  caminho: Schema.String,
  tamanho: Schema.Number,
  /** ISO 8601. */
  alteradoEm: Schema.String,
  /** `anexado`: entrou pelo app ("Anexar"); `pasta`: criado ou alterado na pasta (pela IA ou pela pessoa). */
  origem: Schema.Literals(["anexado", "pasta"]),
});
export type ArquivoPasta = typeof ArquivoPasta.Type;

/**
 * Um arquivo recém-anexado. Para o formato que a IA não lê sozinha (`.docx`), o servidor grava uma
 * versão em texto na pasta oculta `.simplifica/textos/`: `texto` é o caminho dela, relativo à pasta
 * e com `/`; quando a conversão não deu certo, `semTexto` diz por quê, numa frase para a pessoa. Sem
 * os dois, o formato não se converte (a IA já o lê).
 */
export const ArquivoAnexado = Schema.Struct({
  ...ArquivoPasta.fields,
  texto: Schema.optionalKey(Schema.String),
  semTexto: Schema.optionalKey(Schema.String),
});
export type ArquivoAnexado = typeof ArquivoAnexado.Type;

/**
 * O que "Desfazer o que a IA fez nesta pasta" faria agora: só o que mudou **dentro** do turno mais
 * recente que mudou a pasta (o retrato de antes e o de depois do turno), não as mudanças feitas fora da
 * conversa depois dele.
 */
export const PrevisaoDesfazer = Schema.Struct({
  /** Há uma cópia diferente do estado atual para restaurar. */
  disponivel: Schema.Boolean,
  /** O turno cuja cópia (o estado de antes dele) seria restaurada. */
  turno: Schema.optionalKey(Schema.Number),
  /** Quando a cópia foi feita (ISO 8601). */
  copiaEm: Schema.optionalKey(Schema.String),
  /** Arquivos que sairiam (criados depois da cópia). */
  criados: Schema.Array(Schema.String),
  /** Arquivos que voltariam ao conteúdo da cópia. */
  alterados: Schema.Array(Schema.String),
  /** Arquivos que voltariam (apagados depois da cópia). */
  apagados: Schema.Array(Schema.String),
  /**
   * Dos arquivos acima, os que também mudaram fora da conversa depois do turno (a pessoa os editou no
   * Word, por exemplo). Sem `incluirForaDaConversa`, o Desfazer os deixa como estão.
   */
  foraDaConversa: Schema.Array(Schema.String),
  /** Por que não há cópia de algum turno (pasta grande demais), em linguagem simples. */
  aviso: Schema.optionalKey(Schema.String),
});
export type PrevisaoDesfazer = typeof PrevisaoDesfazer.Type;

/** A pasta de trabalho de uma conversa. */
export const PastaConversa = Schema.Struct({
  pasta: Schema.String,
  /** A pasta foi criada pelo app em `Documentos/Simplifica IF` (só essas têm arquivos listados e "Desfazer"). */
  gerida: Schema.Boolean,
  arquivos: Schema.Array(ArquivoPasta),
  desfazer: PrevisaoDesfazer,
});
export type PastaConversa = typeof PastaConversa.Type;

export class GrupoPasta extends RpcGroup.make(
  /**
   * Cria a pasta de uma tarefa em `Documentos/Simplifica IF/<titulo>` (nome seguro, sem colisão:
   * ` (2)`, ` (3)`…) e devolve o caminho, para anexar e depois `conversa.iniciar`.
   */
  Rpc.make("pasta.criar", {
    payload: Schema.Struct({ titulo: Schema.String }),
    success: Schema.Struct({ pasta: Schema.String }),
    error: FalhaPasta,
  }),
  /**
   * Copia para a pasta (criada por `pasta.criar`) um arquivo escolhido no diálogo do desktop, que o
   * processo principal liberou (`CAMINHO_LIBERAR_ARQUIVO`); nome repetido ganha ` (2)`. O `.docx`
   * ganha a versão em texto para a IA (`ArquivoAnexado`).
   */
  Rpc.make("pasta.anexar", {
    payload: Schema.Struct({ pasta: Schema.String, arquivo: Schema.String }),
    success: ArquivoAnexado,
    error: FalhaPasta,
  }),
  /** Os arquivos da pasta da conversa e o que "Desfazer" faria. */
  Rpc.make("pasta.ver", {
    payload: EntradaSessao,
    success: PastaConversa,
    error: Schema.Union([FalhaPasta, SessaoDesconhecida]),
  }),
  /**
   * Restaura a cópia da pasta do turno mais recente que a IA mudou (a de antes do turno) e devolve a
   * pasta depois. Recusa com turno em andamento.
   */
  Rpc.make("pasta.desfazer", {
    payload: Schema.Struct({
      sessao: Schema.String,
      /** Desfazer também os arquivos de `foraDaConversa` (perde a mudança feita fora da conversa). */
      incluirForaDaConversa: Schema.optionalKey(Schema.Boolean),
    }),
    success: PastaConversa,
    error: Schema.Union([FalhaPasta, SessaoDesconhecida, TurnoEmAndamento]),
  }),
) {}
