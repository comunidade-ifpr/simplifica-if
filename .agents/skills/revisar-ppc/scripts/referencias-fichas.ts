/**
 * Referências normativas das fichas e dos marcos em texto legível, para os consumidores da base de
 * análise (índice, mapa, grupos e prompts dos sub-agentes). A estrutura e a renderização são do
 * núcleo (`@simplifica-if/kb/normas/referencia-estruturada`); aqui ficam só as adaptações à skill.
 */
import * as Schema from "effect/Schema";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { Registro } from "@simplifica-if/kb/normas/registro";
import {
  carregarUniversoReferencias,
  esquemaReferenciaNormativa,
  type ReferenciaLegivel,
  type ReferenciaNormativa,
  referenciasLegiveis,
  textoIdComDispositivo,
  UniversoReferencias,
} from "@simplifica-if/kb/normas/referencia-estruturada";
import { type CaminhosAnalise, caminhosPadrao } from "./caminhos.ts";

/**
 * Universo de IDs citáveis do projeto (`manifest.json`, `normas/stubs.yaml` e CNCT), ou `null` quando
 * o manifesto de normas não existe.
 */
export function carregarUniverso(caminhos: CaminhosAnalise = caminhosPadrao()): UniversoReferencias | null {
  if (!NodeFS.existsSync(caminhos.manifestNormasPath)) return null;
  return carregarUniversoReferencias(NodePath.dirname(caminhos.baseConhecimentoDir));
}

/** Universo do projeto ou, sem manifesto, um universo vazio (os textos ficam com os IDs). */
export function universoOuVazio(caminhos: CaminhosAnalise = caminhosPadrao()): UniversoReferencias {
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

/** IDs citados pela ficha, sem repetição, na ordem da primeira citação. */
export function normasCitadas(ficha: { [campo: string]: unknown }): string[] {
  return [...new Set(referenciasDaFicha(ficha).map((referencia) => referencia.ref))];
}

const CAMPOS_ID_MARCO = ["substitui", "antecessoras_historicas", "dispositivos_revogados"] as const;

/**
 * Marco com as normas por extenso ("Resolução CNE/CP nº 2/2026" em vez de `br/cne-cp/res/2026/2`),
 * para o contexto dos sub-agentes. Os demais campos ficam como estão.
 */
export function marcoLegivel<T extends { [campo: string]: unknown }>(marco: T, universo: UniversoReferencias): T {
  const copia: { [campo: string]: unknown } = { ...marco };
  if (typeof marco.vigente === "string") copia.vigente = textoIdComDispositivo(marco.vigente, universo);
  for (const campo of CAMPOS_ID_MARCO) {
    const valores = marco[campo];
    if (Array.isArray(valores)) {
      copia[campo] = valores.map((valor) =>
        typeof valor === "string" ? textoIdComDispositivo(valor, universo) : valor,
      );
    }
  }
  return copia as T;
}
