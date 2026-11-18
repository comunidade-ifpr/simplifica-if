// @effect-diagnostics nodeBuiltinImport:off -- leitura síncrona de dois índices da base, no ponto de entrada da skill
/**
 * Leitura das referências da identificação do curso: os campi do IFPR
 * (`institucional/ifpr/campi/index.json`) e os eixos tecnológicos do CNCT
 * (`catalogos/cnct/index.json`). A extração (`identificacao.ts`) é pura e as
 * recebe já lidas; um índice ausente ou fora do formato é erro, não lista vazia.
 */
import * as NodePath from "node:path";
import { lerTexto } from "@simplifica-if/kb/texto";
import * as Schema from "effect/Schema";
import type { CaminhosAnalise } from "./caminhos.ts";
import { referenciasIdentificacao, type ReferenciasIdentificacao } from "./identificacao.ts";

const IndiceCampi = Schema.fromJsonString(
  Schema.Struct({ items: Schema.Array(Schema.Struct({ nome: Schema.String })) }),
);

const IndiceCnct = Schema.fromJsonString(
  Schema.Struct({ items: Schema.Array(Schema.Struct({ eixo_tecnologico: Schema.String })) }),
);

const decodificarCampi = Schema.decodeUnknownSync(IndiceCampi);
const decodificarCnct = Schema.decodeUnknownSync(IndiceCnct);

/** Lê os campi e os eixos da base em `caminhos.baseConhecimentoDir`. */
export function lerReferenciasIdentificacao(caminhos: CaminhosAnalise): ReferenciasIdentificacao {
  const base = caminhos.baseConhecimentoDir;
  const campi = decodificarCampi(lerTexto(NodePath.join(base, "institucional", "ifpr", "campi", "index.json")));
  const cnct = decodificarCnct(lerTexto(NodePath.join(base, "catalogos", "cnct", "index.json")));
  return referenciasIdentificacao({
    campi: campi.items.map((item) => item.nome),
    eixos: cnct.items.map((item) => item.eixo_tecnologico),
  });
}
