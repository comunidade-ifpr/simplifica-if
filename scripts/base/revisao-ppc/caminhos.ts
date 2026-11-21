// @effect-diagnostics nodeBuiltinImport:off -- junção de caminhos, pura, para a validação síncrona da base
/**
 * Onde fica a base da revisão de PPC (`base-conhecimento/revisao-ppc/`): as fichas, a taxonomia dos
 * tópicos, os marcos normativos, os JSON Schemas gerados e o mapa. Os testes montam os mesmos
 * caminhos sobre uma cópia temporária do projeto.
 */
import * as NodePath from "node:path";
import { CAMINHOS, noCheckout } from "@simplifica-if/kb/caminhos";
import { RAIZ_PROJETO } from "../../config.ts";

export interface CaminhosRevisaoPpc {
  /** Raiz do projeto (a que contém `base-conhecimento/`). */
  readonly raiz: string;
  readonly baseConhecimento: string;
  readonly manifestNormas: string;
  readonly pasta: string;
  readonly fichas: string;
  readonly topicosFichas: string;
  readonly marcos: string;
  readonly schemas: string;
  readonly mapa: string;
}

export function caminhosRevisaoPpc(raiz: string = RAIZ_PROJETO): CaminhosRevisaoPpc {
  const baseConhecimento = noCheckout(raiz, CAMINHOS.base);
  return {
    raiz,
    baseConhecimento,
    manifestNormas: NodePath.join(baseConhecimento, "manifest.json"),
    pasta: noCheckout(raiz, CAMINHOS.revisaoPpc),
    fichas: noCheckout(raiz, CAMINHOS.fichas),
    topicosFichas: noCheckout(raiz, CAMINHOS.topicosFichas),
    marcos: noCheckout(raiz, CAMINHOS.marcos),
    schemas: noCheckout(raiz, CAMINHOS.schemasRevisaoPpc),
    mapa: noCheckout(raiz, CAMINHOS.mapaFichas),
  };
}
