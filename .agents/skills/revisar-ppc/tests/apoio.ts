// @effect-diagnostics nodeBuiltinImport:off -- apoio dos testes: lê as fixtures e grava os JSONs de entrada direto no disco, fora do serviço sob teste
/**
 * Apoio comum aos testes da revisar-ppc: a camada do serviço `Rodada` sobre o `FileSystem` real
 * (os testes trabalham em pastas temporárias), as referências da identificação lidas de forma
 * independente de `lerReferenciasIdentificacao` e a leitura e a escrita dos JSONs de fixture.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Layer from "effect/Layer";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { carregarJsonTipado, jsonTipadoIndentado } from "@simplifica-if/kb/primitivas/json-tipado";
import { caminhosPadrao } from "../scripts/caminhos.ts";
import { referenciasIdentificacao, type ReferenciasIdentificacao } from "../scripts/identificacao.ts";
import * as Rodada from "../scripts/rodada.ts";

/** `Rodada` e os serviços do Node, que os testes também usam (`FileSystem`, `Path`). */
export const CAMADA_RODADA = Rodada.layer.pipe(Layer.provideMerge(NodeServices.layer));

/** JSON tipado de um arquivo (fracionários preservados). */
export const lerJson = (caminho: string): unknown => carregarJsonTipado(caminho);

/** Grava um JSON indentado como a rodada grava, criando a pasta. */
export function escreverJson(caminho: string, valor: unknown): void {
  NodeFS.mkdirSync(NodePath.dirname(caminho), { recursive: true });
  NodeFS.writeFileSync(caminho, jsonTipadoIndentado(valor), "utf-8");
}

/**
 * Campi e eixos da base, lidos aqui sem o serviço: a referência com que o teste de
 * `lerReferenciasIdentificacao` compara, e as referências dos testes da extração pura.
 */
export function referenciasDaBase(): ReferenciasIdentificacao {
  const base = caminhosPadrao().baseConhecimentoDir;
  const itens = (arquivo: string) =>
    (lerJson(NodePath.join(base, arquivo)) as { items: Record<string, string>[] }).items;
  return referenciasIdentificacao({
    campi: itens("institucional/ifpr/campi/index.json").map((item) => item.nome!),
    eixos: itens("catalogos/cnct/index.json").map((item) => item.eixo_tecnologico!),
  });
}
