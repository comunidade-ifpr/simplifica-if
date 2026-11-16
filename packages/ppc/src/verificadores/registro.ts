/**
 * Registro ficha → verificador das fichas D da `revisar-ppc` (`execucao.modo: "D"`).
 *
 * É o mapa que a etapa 4 do M1.11 (IA) consulta para saber o que o código já resolveu, e que o
 * `revisar_ppc.ts validar-base` confere: toda ficha D tem verificador aqui, e todo verificador daqui
 * é de uma ficha D. Cada verificador tem casos em `test/verificadores.test.ts` (o teste confere que
 * nenhum fica sem caso) e a precisão medida em `PRECISAO.md`.
 */
import type { Verificador } from "./comum.ts";
import { aeeComoComponente, cargaHorariaTotal, componentesFgb, requisitoIngresso } from "./curriculo.ts";
import { denominacaoCnct, eixoCnct } from "./identificacao.ts";
import {
  baseLegalIdentidade,
  legislacaoProfissional,
  marcosInstitucionais,
  marcosNasReferencias,
  normasRevogadas,
  politicaAssistenciaEstudantil,
} from "./normas.ts";

export const VERIFICADORES: readonly Verificador[] = [
  denominacaoCnct,
  baseLegalIdentidade,
  eixoCnct,
  cargaHorariaTotal,
  requisitoIngresso,
  componentesFgb,
  aeeComoComponente,
  marcosNasReferencias,
  normasRevogadas,
  marcosInstitucionais,
  legislacaoProfissional,
  politicaAssistenciaEstudantil,
];

/** Ficha → verificador. */
export const VERIFICADOR_POR_FICHA: ReadonlyMap<string, Verificador> = new Map(VERIFICADORES.map((v) => [v.ficha, v]));

/** Fichas resolvidas só por código. */
export const FICHAS_D: readonly string[] = VERIFICADORES.map((v) => v.ficha);
