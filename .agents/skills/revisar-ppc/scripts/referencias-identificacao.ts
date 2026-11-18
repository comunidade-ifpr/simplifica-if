/**
 * Leitura das referências da identificação do curso: os campi do IFPR
 * (`institucional/ifpr/campi/index.json`) e os eixos tecnológicos do CNCT
 * (`catalogos/cnct/index.json`). A extração (`identificacao.ts`) é pura e as
 * recebe já lidas; um índice ausente ou fora do formato é erro, não lista vazia.
 */
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import type { CaminhosAnalise } from "./caminhos.ts";
import { referenciasIdentificacao } from "./identificacao.ts";
import * as Rodada from "./rodada.ts";

const decodificarCampi = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ items: Schema.Array(Schema.Struct({ nome: Schema.String })) })),
);

const decodificarCnct = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ items: Schema.Array(Schema.Struct({ eixo_tecnologico: Schema.String })) })),
);

/** Lê o índice e o decodifica; fora do formato, `JsonDaRodadaInvalido` com o que se esperava. */
const lerIndice = Effect.fn("referencias_identificacao.lerIndice")(function* <A>(
  arquivo: string,
  decodificar: (texto: string) => Effect.Effect<A, Schema.SchemaError>,
  esperado: string,
) {
  const rodada = yield* Rodada.Rodada;
  const texto = yield* rodada.lerTexto(arquivo);
  return yield* decodificar(texto).pipe(
    Effect.mapError((cause) => new Rodada.JsonDaRodadaInvalido({ arquivo, esperado, cause })),
  );
});

/** Lê os campi e os eixos da base em `caminhos.baseConhecimentoDir`. */
export const lerReferenciasIdentificacao = Effect.fn("referencias_identificacao.lerReferenciasIdentificacao")(
  function* (caminhos: CaminhosAnalise) {
    const path = yield* Path.Path;
    const base = caminhos.baseConhecimentoDir;
    const campi = yield* lerIndice(
      path.join(base, "institucional", "ifpr", "campi", "index.json"),
      decodificarCampi,
      "um índice de campi com `items[].nome`",
    );
    const cnct = yield* lerIndice(
      path.join(base, "catalogos", "cnct", "index.json"),
      decodificarCnct,
      "um índice do CNCT com `items[].eixo_tecnologico`",
    );
    return referenciasIdentificacao({
      campi: campi.items.map((item) => item.nome),
      eixos: cnct.items.map((item) => item.eixo_tecnologico),
    });
  },
);
