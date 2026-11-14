/**
 * `FontesNormativas` (a carga da fase 5 no `kb.sqlite`, `db/fontes-normativas.ts`) pela API de
 * arquivos de `normas/`: nenhuma regra nova aqui, só o mapeamento para as linhas das tabelas.
 *
 * - `dispositivos`: `carregarEstruturas` (todas as normas, compilação da LDB inclusive, na ordem dos
 *   arquivos), com `canonico` pela deduplicação de `indiceDispositivos`;
 * - `relacoes`: `carregarRelacoes`, com o efeito resolvido por `efeitoDaRelacao`;
 * - `vigencias`: `intervalosVigencia` (isto é, `statusEm` nas datas em que o status pode mudar) para
 *   cada ato da base e dos stubs;
 * - `transicoes`: `carregarTransicoes` com `datasTransicao` (a situação numa data sai de
 *   `situacaoNaData`, na consulta);
 * - `tabelasCorrespondencia` e `correspondencias`: `carregarCorrespondencias`, um item por linha.
 *
 * Ordem estável: arquivos por caminho, itens na ordem do arquivo, atos por ID (code point).
 */
import path from "node:path";
import type {
  FontesNormativas,
  LinhaCorrespondencia,
  LinhaDispositivo,
  LinhaRelacao,
  LinhaTabelaCorrespondencia,
  LinhaTransicao,
  LinhaVigencia,
} from "../db/fontes-normativas.ts";
import { compararTexto } from "../texto.ts";
import { carregarCorrespondencias } from "./correspondencia.ts";
import { carregarEstruturas, indiceDispositivos } from "./estrutura.ts";
import { idDoAto } from "./ids.ts";
import { carregarRegistro, raizRepositorio } from "./registro.ts";
import { caminhoRelacoes, carregarRelacoes } from "./relacoes.ts";
import {
  caminhoTransicoes,
  carregarTransicoes,
  datasTransicao,
  efeitoDaRelacao,
  intervalosVigencia,
} from "./vigencia.ts";

const BASE = "base-conhecimento";

function relativo(raiz: string, absoluto: string): string {
  return path.relative(raiz, absoluto).split(path.sep).join("/");
}

/** Linha da tabela `dispositivos` de cada dispositivo das normas da base. */
export function* linhasDispositivos(raiz: string = raizRepositorio()): Generator<LinhaDispositivo> {
  const indice = indiceDispositivos(raiz);
  for (const estrutura of carregarEstruturas(raiz)) {
    for (const d of estrutura.dispositivos) {
      yield {
        id: d.id,
        ato_id: d.ato,
        norma_id: d.norma,
        dispositivo: d.dispositivo,
        tipo: d.tipo,
        rotulo: d.rotulo,
        pai: d.pai,
        ordem: d.ordem,
        texto: d.texto,
        caput: d.caput,
        texto_com_caput: [...d.caput, d.texto].join("\n"),
        estrutura: d.estrutura,
        notas: d.notas,
        revogado: d.revogado,
        vetado: d.vetado,
        canonico: indice.get(`${d.ato}${d.dispositivo}`) === d,
        path: `${BASE}/${estrutura.path}`,
        linha_inicio: d.linha_inicio,
        linha_fim: d.linha_fim,
      };
    }
  }
}

export function* linhasRelacoes(raiz: string = raizRepositorio()): Generator<LinhaRelacao> {
  const caminho = relativo(raiz, caminhoRelacoes(raiz));
  let ordem = 0;
  for (const r of carregarRelacoes(raiz)) {
    const efeito = efeitoDaRelacao(r, raiz);
    yield {
      ordem: ordem++,
      tipo: r.tipo,
      origem: r.origem,
      operador: r.operador ?? null,
      alvo: r.alvo,
      alvo_dispositivo: r.alvo_dispositivo ?? null,
      alcance: r.alcance ?? null,
      efeito_de: r.efeito_de,
      efeito_em: efeito.data,
      efeito_minimo: efeito.minimo,
      evidencia_em: r.evidencia.em,
      evidencia_trecho: r.evidencia.trecho,
      confirmado_em: r.confirmado_em,
      proposta: r.proposta,
      nota: r.nota ?? null,
      path: caminho,
    };
  }
}

/** Atos com vigência calculável: normas da base (sem variante) e stubs. */
export function atosComVigencia(raiz: string = raizRepositorio()): string[] {
  const atos = new Set<string>();
  for (const entrada of carregarRegistro(raiz).entradas) {
    if (entrada.situacao !== "externo") atos.add(idDoAto(entrada.id));
  }
  return [...atos].sort(compararTexto);
}

export function* linhasVigencias(raiz: string = raizRepositorio()): Generator<LinhaVigencia> {
  for (const ato of atosComVigencia(raiz)) {
    let ordem = 0;
    for (const intervalo of intervalosVigencia(ato, raiz)) yield { alvo: ato, ordem: ordem++, ...intervalo };
  }
}

export function* linhasTransicoes(raiz: string = raizRepositorio()): Generator<LinhaTransicao> {
  const caminho = relativo(raiz, caminhoTransicoes(raiz));
  for (const t of carregarTransicoes(raiz)) {
    yield {
      id: t.id,
      norma_id: t.norma,
      dispositivo: t.dispositivo,
      tipo: t.tipo,
      norma_anterior: t.norma_anterior ?? null,
      aplica_a: t.aplica_a,
      regra: t.regra,
      inicio: t.inicio,
      fim: t.fim,
      ...datasTransicao(t, raiz),
      evidencia: t.evidencia,
      path: caminho,
    };
  }
}

export function* linhasTabelasCorrespondencia(raiz: string = raizRepositorio()): Generator<LinhaTabelaCorrespondencia> {
  for (const t of carregarCorrespondencias(raiz)) {
    yield {
      arquivo: t.arquivo,
      origem: t.origem,
      destino: t.destino,
      status: t.status,
      elaborado_em: t.elaborado_em,
      revisado_por: t.revisado_por ?? null,
      metodo: t.metodo,
    };
  }
}

export function* linhasCorrespondencias(raiz: string = raizRepositorio()): Generator<LinhaCorrespondencia> {
  for (const t of carregarCorrespondencias(raiz)) {
    let ordem = 0;
    for (const item of t.itens) {
      yield {
        tabela: t.arquivo,
        ordem: ordem++,
        origem: `${t.origem}${item.origem}`,
        tipo: item.tipo,
        destino: item.destino.map((d) => `${t.destino}${d}`),
        nota: item.nota ?? null,
      };
    }
  }
}

/** A carga da fase 5 sobre os arquivos do checkout em `raiz`. */
export function fontesNormativasArquivos(raiz: string = raizRepositorio()): FontesNormativas {
  return {
    dispositivos: () => linhasDispositivos(raiz),
    relacoes: () => linhasRelacoes(raiz),
    vigencias: () => linhasVigencias(raiz),
    transicoes: () => linhasTransicoes(raiz),
    tabelasCorrespondencia: () => linhasTabelasCorrespondencia(raiz),
    correspondencias: () => linhasCorrespondencias(raiz),
  };
}
