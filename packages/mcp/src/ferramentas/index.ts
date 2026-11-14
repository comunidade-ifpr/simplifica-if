/**
 * Registro único das ferramentas: o servidor registra a partir desta lista, e os testes de
 * contrato a percorrem. A ordem é a da tabela "Ferramentas" da especificação M0.1.
 */
import { adequacaoArt71 } from "./adequacao-art71.ts";
import { buscarSecoes } from "./buscar-secoes.ts";
import { citacoesDaNorma } from "./citacoes-da-norma.ts";
import { etapa } from "./etapa.ts";
import { fatosPpc } from "./fatos-ppc.ts";
import type { Ferramenta } from "./ferramenta.ts";
import { fichaCurso } from "./ficha-curso.ts";
import { impactoDaNorma } from "./impacto-da-norma.ts";
import { lerSecao } from "./ler-secao.ts";
import { listarCursos } from "./listar-cursos.ts";
import { sobreABase } from "./sobre-a-base.ts";

export const FERRAMENTAS: readonly Ferramenta[] = [
  citacoesDaNorma,
  impactoDaNorma,
  adequacaoArt71,
  buscarSecoes,
  lerSecao,
  listarCursos,
  fichaCurso,
  fatosPpc,
  sobreABase,
  etapa,
];

export type { Contexto, Ferramenta } from "./ferramenta.ts";
