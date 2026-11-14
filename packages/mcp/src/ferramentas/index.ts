/**
 * Registro único das ferramentas: o servidor registra a partir desta lista, e os testes de
 * contrato a percorrem. A ordem é a da tabela "Ferramentas" da especificação M0.1.
 */
import { buscarNorma } from "./buscar-norma.ts";
import { correspondencia } from "./correspondencia.ts";
import { etapa } from "./etapa.ts";
import type { Ferramenta } from "./ferramenta.ts";
import { fichaNorma } from "./ficha-norma.ts";
import { lerDispositivos } from "./ler-dispositivos.ts";
import { resolverCitacoes } from "./resolver-citacoes.ts";
import { sobreABase } from "./sobre-a-base.ts";

export const FERRAMENTAS: readonly Ferramenta[] = [
  buscarNorma,
  lerDispositivos,
  fichaNorma,
  correspondencia,
  resolverCitacoes,
  sobreABase,
  etapa,
];

export type { Contexto, Ferramenta } from "./ferramenta.ts";
