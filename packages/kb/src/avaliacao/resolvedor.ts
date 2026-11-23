// @effect-diagnostics nodeBuiltinImport:off -- avaliação síncrona sobre os arquivos do checkout, usada pela CLI
/**
 * Avaliação do resolvedor de citações contra `avaliacao/resolvedor/citacoes-anotadas.yaml`.
 *
 * Por par (linha, ato): precisão = pares emitidos com ID certo / pares emitidos com ID; recall =
 * pares anotados encontrados / pares anotados. A linha é localizada pelo `trecho` anotado (único
 * no PPC). Dispositivos são medidos à parte: fração dos dispositivos anotados que o resolvedor
 * devolveu para o mesmo ato na mesma linha.
 */
import * as Schema from "effect/Schema";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { parse } from "yaml";
import { CAMINHOS, noCheckout } from "../caminhos.ts";
import type { Registro } from "../normas/registro.ts";
import { extrairCitacoes } from "../normas/resolver.ts";
import { carregarIndicePpcs } from "../ppcs/citacoes.ts";
import { mascararFrontMatter } from "../ppcs/front-matter.ts";
import { compararTexto } from "../texto.ts";

const esquemaLinha = Schema.Struct({
  trecho: Schema.String.check(Schema.isMinLength(10)),
  ids: Schema.Array(Schema.String),
  sem_id: Schema.optionalKey(Schema.Array(Schema.String)),
});

/** Contrato de `citacoes-anotadas.yaml` (decodificado sem chaves extras). */
export const esquemaCitacoesAnotadas = Schema.Struct({
  status: Schema.Literals(["rascunho", "revisado"]),
  revisado_por: Schema.NullOr(Schema.String),
  anotado_por: Schema.String,
  ppcs: Schema.Array(
    Schema.Struct({ ppc: Schema.String, linhas: Schema.Array(esquemaLinha).check(Schema.isMinLength(1)) }),
  ).check(Schema.isMinLength(1)),
});
export type CitacoesAnotadas = typeof esquemaCitacoesAnotadas.Type;
const decodificarAnotacoes = Schema.decodeUnknownSync(esquemaCitacoesAnotadas, {
  onExcessProperty: "error",
  errors: "all",
});

/** O conjunto anotado de `avaliacao/resolvedor/citacoes-anotadas.yaml` do checkout em `raiz`. */
export function lerAnotacoes(raiz: string): CitacoesAnotadas {
  return decodificarAnotacoes(parse(NodeFS.readFileSync(noCheckout(raiz, CAMINHOS.anotacoesResolvedor), "utf-8")));
}

export interface ErroAvaliacao {
  ppc: string;
  linha: number;
  tipo: "falso-positivo" | "falso-negativo" | "dispositivo";
  id: string;
  regra?: string;
  trecho: string;
}

export interface ResultadoAvaliacao {
  ppcs: number;
  linhas: number;
  anotados: number;
  emitidos: number;
  acertos: number;
  precisao: number;
  recall: number;
  dispositivos: { anotados: number; acertos: number; taxa: number };
  porRegra: Record<string, { emitidos: number; acertos: number }>;
  erros: ErroAvaliacao[];
  /** Problemas do próprio arquivo de anotação (trecho ausente ou repetido). */
  problemas: string[];
}

function arredondar(valor: number): number {
  return Math.round(valor * 1000) / 1000;
}

export function avaliarResolvedor(anotacoes: CitacoesAnotadas, registro: Registro, raiz: string): ResultadoAvaliacao {
  const caminhos = new Map(carregarIndicePpcs(raiz).map((ppc) => [ppc.id, ppc.path]));
  const problemas: string[] = [];
  const erros: ErroAvaliacao[] = [];
  const porRegra: Record<string, { emitidos: number; acertos: number }> = {};
  let linhas = 0;
  let anotados = 0;
  let emitidos = 0;
  let acertos = 0;
  let dispositivosAnotados = 0;
  let dispositivosCertos = 0;

  for (const { ppc, linhas: anotadas } of anotacoes.ppcs) {
    const relativo = caminhos.get(ppc);
    if (!relativo) {
      problemas.push(`${ppc}: PPC fora do índice`);
      continue;
    }
    const texto = mascararFrontMatter(
      NodeFS.readFileSync(NodePath.join(noCheckout(raiz, CAMINHOS.base), relativo), "utf-8"),
    );
    const citacoes = extrairCitacoes(texto, registro);
    const linhasTexto = texto.split("\n");

    for (const anotada of anotadas) {
      const ocorrencias = linhasTexto.flatMap((linha, i) => (linha.includes(anotada.trecho) ? [i + 1] : []));
      const total = texto.split(anotada.trecho).length - 1;
      if (ocorrencias.length !== 1 || total !== 1) {
        problemas.push(`${ppc}: trecho ${total === 0 ? "ausente" : "repetido"}: ${anotada.trecho.slice(0, 60)}`);
        continue;
      }
      const numero = ocorrencias[0]!;
      linhas += 1;
      const esperados = new Map<string, Set<string>>();
      for (const valor of anotada.ids) {
        const [id, dispositivo] = valor.split("#") as [string, string | undefined];
        const conjunto = esperados.get(id) ?? new Set<string>();
        if (dispositivo) conjunto.add(`#${dispositivo}`);
        esperados.set(id, conjunto);
      }
      const daLinha = citacoes.filter((citacao) => citacao.linha === numero && citacao.id !== null);
      const emitidosLinha = new Map<string, { regras: Set<string>; dispositivos: Set<string> }>();
      for (const citacao of daLinha) {
        const id = citacao.id!;
        const registroLinha = emitidosLinha.get(id) ?? { regras: new Set<string>(), dispositivos: new Set<string>() };
        registroLinha.regras.add(citacao.regra);
        for (const d of citacao.dispositivos ?? (citacao.dispositivoId ? [citacao.dispositivoId] : [])) {
          registroLinha.dispositivos.add(d);
        }
        emitidosLinha.set(id, registroLinha);
      }

      anotados += esperados.size;
      emitidos += emitidosLinha.size;
      for (const [id, { regras, dispositivos }] of emitidosLinha) {
        const regra = [...regras].sort(compararTexto).join("+");
        porRegra[regra] ??= { emitidos: 0, acertos: 0 };
        porRegra[regra].emitidos += 1;
        if (esperados.has(id)) {
          acertos += 1;
          porRegra[regra].acertos += 1;
          for (const dispositivo of esperados.get(id)!) {
            dispositivosAnotados += 1;
            if (dispositivos.has(dispositivo)) dispositivosCertos += 1;
            else
              erros.push({
                ppc,
                linha: numero,
                tipo: "dispositivo",
                id: `${id}${dispositivo}`,
                regra,
                trecho: anotada.trecho,
              });
          }
        } else {
          erros.push({ ppc, linha: numero, tipo: "falso-positivo", id, regra, trecho: anotada.trecho });
        }
      }
      for (const [id, dispositivos] of esperados) {
        if (emitidosLinha.has(id)) continue;
        dispositivosAnotados += dispositivos.size;
        erros.push({ ppc, linha: numero, tipo: "falso-negativo", id, trecho: anotada.trecho });
      }
    }
  }

  return {
    ppcs: anotacoes.ppcs.length,
    linhas,
    anotados,
    emitidos,
    acertos,
    precisao: arredondar(emitidos === 0 ? 0 : acertos / emitidos),
    recall: arredondar(anotados === 0 ? 0 : acertos / anotados),
    dispositivos: {
      anotados: dispositivosAnotados,
      acertos: dispositivosCertos,
      taxa: arredondar(dispositivosAnotados === 0 ? 0 : dispositivosCertos / dispositivosAnotados),
    },
    porRegra: Object.fromEntries(Object.entries(porRegra).sort(([a], [b]) => compararTexto(a, b))),
    erros,
    problemas,
  };
}
