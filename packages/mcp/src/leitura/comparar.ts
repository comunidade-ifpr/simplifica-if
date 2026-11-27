/**
 * `compararNormas`: as duas normas lado a lado pela tabela de correspondência (`Normas.alinhamento`),
 * com a diferença palavra a palavra de cada par (`diferencaPalavras`) e a vigência de cada norma.
 */
import type { LadoAlinhado } from "@simplifica-if/kb/normas/correspondencia";
import { diferencaPalavras, type Trecho } from "@simplifica-if/kb/normas/diferenca";
import * as Normas from "@simplifica-if/kb/Normas";
import * as Effect from "effect/Effect";
import type { EntradaComparar, LadoComparado, LinhaComparada, NormaComparada } from "../comparar.ts";
import { type Base, EntradaInvalida } from "../contratos.ts";
import { responder } from "../envelope.ts";
import { linkNorma } from "../links.ts";

const comparado = (lado: LadoAlinhado, trechos: ReadonlyArray<Trecho>): LadoComparado => ({
  id: lado.id,
  rotulo: lado.rotulo,
  link: linkNorma(lado.id),
  trechos,
  subordinados: lado.subordinados,
});

const inteiro = (lado: LadoAlinhado) => comparado(lado, lado.texto === "" ? [] : [{ texto: lado.texto, mudou: false }]);

export const makeComparar = Effect.fn("Leitura.makeComparar")(function* (base: Base) {
  const normas = yield* Normas.Normas;

  const norma = Effect.fn("Leitura.normaComparada")(function* (id: string) {
    const ficha = yield* normas.ficha(id);
    const resultado: NormaComparada = {
      id,
      titulo: ficha?.titulo ?? id,
      // calculado no dia da vigência, como no índice e na ficha; não a coluna da data de referência
      status_vigencia: ficha === null ? null : (yield* normas.vigencia(id)).status,
      link: linkNorma(id),
    };
    return resultado;
  });

  const compararNormas = Effect.fn("Leitura.compararNormas")(function* (e: typeof EntradaComparar.Type) {
    const alinhamento = yield* normas.alinhamento(e.a, e.b);
    if (alinhamento === null) {
      return yield* new EntradaInvalida({
        mensagem: `não há tabela de correspondência entre "${e.a}" e "${e.b}": sem ela, as normas não se comparam`,
      });
    }
    const linhas = alinhamento.linhas.map((l): LinhaComparada => {
      const item = { tipo: l.tipo, nota: l.nota, herdado_de: l.herdado_de };
      // sem destino não há par; na linha herdada, o destino é o do ancestral, não o par deste
      // dispositivo: nos dois casos, os textos inteiros, sem grifo
      if (l.destinos.length === 0 || l.herdado_de !== null) {
        return {
          ...item,
          origem: inteiro(l.origem),
          destinos: l.destinos.map((d) => ({ ...inteiro(d), tambem: d.tambem })),
          identicos: false,
          reescrito: false,
        };
      }
      const diferenca = diferencaPalavras(
        l.origem.texto,
        l.destinos.map((d) => d.texto),
      );
      return {
        ...item,
        origem: comparado(l.origem, diferenca.origem),
        destinos: l.destinos.map((d, i) => ({ ...comparado(d, diferenca.destinos[i]!), tambem: d.tambem })),
        identicos: diferenca.identicos,
        reescrito: diferenca.reescrito,
      };
    });
    return responder(base, {
      tabela: { arquivo: alinhamento.tabela, status: alinhamento.status },
      origem: yield* norma(alinhamento.origem),
      destino: yield* norma(alinhamento.destino),
      linhas,
      novos: alinhamento.novos.map(inteiro),
    });
  });

  return { compararNormas };
});
