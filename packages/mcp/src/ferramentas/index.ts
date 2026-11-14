/**
 * Registro único das ferramentas: o servidor registra a partir desta lista, e os testes de
 * contrato a percorrem. A ordem é a da tabela "Ferramentas" da especificação M0.1.
 */
import { etapa } from "./etapa.ts";
import type { Ferramenta } from "./ferramenta.ts";
import { sobreABase } from "./sobre-a-base.ts";

export const FERRAMENTAS: readonly Ferramenta[] = [sobreABase, etapa];

export type { Contexto, Ferramenta } from "./ferramenta.ts";
