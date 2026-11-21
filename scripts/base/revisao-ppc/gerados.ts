/** Os arquivos gerados da base da revisão de PPC: os JSON Schemas da ficha e dos marcos e o mapa. */
import type { ArquivoGerado } from "../gerados.ts";
import { type CaminhosRevisaoPpc, caminhosRevisaoPpc } from "./caminhos.ts";
import { schemasGerados } from "./esquemas.ts";
import { mapaGerado } from "./mapa.ts";

export function geradosRevisaoPpc(caminhos: CaminhosRevisaoPpc = caminhosRevisaoPpc()): ArquivoGerado[] {
  return [...schemasGerados(caminhos.schemas), mapaGerado(caminhos)];
}
