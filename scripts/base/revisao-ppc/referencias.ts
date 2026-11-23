// @effect-diagnostics nodeBuiltinImport:off -- universo de referências pelos carregadores síncronos do kb
/**
 * Referências normativas das fichas: a estrutura e a renderização são do núcleo
 * (`@simplifica-if/kb/normas/referencia-estruturada`); aqui ficam a leitura das fichas e o universo
 * de IDs citáveis do checkout.
 */
import * as NodeFS from "node:fs";
import * as Schema from "effect/Schema";
import { Registro } from "@simplifica-if/kb/normas/registro";
import {
  carregarUniversoReferencias,
  esquemaReferenciaNormativa,
  type ReferenciaLegivel,
  type ReferenciaNormativa,
  referenciasLegiveis,
  UniversoReferencias,
} from "@simplifica-if/kb/normas/referencia-estruturada";
import { type CaminhosRevisaoPpc, caminhosRevisaoPpc } from "./caminhos.ts";

/**
 * Universo de IDs citáveis do projeto (normas da base, `normas/stubs.yaml` e CNCT), ou `null` quando
 * a pasta de normas não existe.
 */
export function carregarUniverso(caminhos: CaminhosRevisaoPpc = caminhosRevisaoPpc()): UniversoReferencias | null {
  if (!NodeFS.existsSync(caminhos.normas)) return null;
  return carregarUniversoReferencias(caminhos.raiz);
}

/** Universo do projeto ou, sem normas, um universo vazio (os textos ficam com os IDs). */
export function universoOuVazio(caminhos: CaminhosRevisaoPpc = caminhosRevisaoPpc()): UniversoReferencias {
  return carregarUniverso(caminhos) ?? new UniversoReferencias(new Registro([]));
}

const decodificarReferencias = Schema.decodeUnknownSync(Schema.Array(esquemaReferenciaNormativa), {
  onExcessProperty: "error",
});

/** `referencias_normativas` da ficha, validadas pelo esquema do kb (ausente é lista vazia). */
export function referenciasDaFicha(ficha: { [campo: string]: unknown }): ReferenciaNormativa[] {
  return ficha.referencias_normativas === undefined ? [] : [...decodificarReferencias(ficha.referencias_normativas)];
}

/** Citações legíveis da ficha, na ordem da ficha. */
export function referenciasLegiveisDaFicha(
  ficha: { [campo: string]: unknown },
  universo: UniversoReferencias,
): ReferenciaLegivel[] {
  return referenciasLegiveis(referenciasDaFicha(ficha), universo);
}
