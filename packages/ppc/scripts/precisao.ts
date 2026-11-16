/** Contagem por ficha dos resultados da pré-conferência na base (a tabela de `PRECISAO.md` e o teste de regressão). */
import type { PreConferencia } from "../src/pre-conferencia.ts";
import { FICHAS_D } from "../src/verificadores/registro.ts";

export type ContagemFicha = {
  atende: number;
  nao_atende: number;
  a_conferir: number;
  nao_se_aplica: number;
  apontamentos_nao_atende: number;
  apontamentos_a_conferir: number;
};

export function contarPorFicha(resultados: readonly PreConferencia[]): Record<string, ContagemFicha> {
  const saida: Record<string, ContagemFicha> = {};
  for (const ficha of FICHAS_D)
    saida[ficha] = {
      atende: 0,
      nao_atende: 0,
      a_conferir: 0,
      nao_se_aplica: 0,
      apontamentos_nao_atende: 0,
      apontamentos_a_conferir: 0,
    };
  for (const resultado of resultados)
    for (const ficha of resultado.fichas) {
      const contagem = saida[ficha.ficha]!;
      contagem[ficha.estado] += 1;
      for (const apontamento of ficha.apontamentos) contagem[`apontamentos_${apontamento.estado}`] += 1;
    }
  return saida;
}
