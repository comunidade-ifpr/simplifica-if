// @effect-diagnostics nodeBuiltinImport:off -- universo de referências pelos carregadores síncronos do kb
/** Universo de IDs citáveis do checkout, para conferir as referências das fichas e dos marcos. */
import * as NodeFS from "node:fs";
import { carregarUniversoReferencias, type UniversoReferencias } from "@simplifica-if/kb/normas/referencia-estruturada";
import { type CaminhosRevisaoPpc, caminhosRevisaoPpc } from "./caminhos.ts";

/**
 * Universo de IDs citáveis do projeto (normas da base, `normas/stubs.yaml` e CNCT), ou `null` quando
 * a pasta de normas não existe.
 */
export function carregarUniverso(caminhos: CaminhosRevisaoPpc = caminhosRevisaoPpc()): UniversoReferencias | null {
  if (!NodeFS.existsSync(caminhos.normas)) return null;
  return carregarUniversoReferencias(caminhos.raiz);
}
