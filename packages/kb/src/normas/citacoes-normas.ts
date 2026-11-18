/**
 * Citações entre normas: as citações resolvidas no texto de cada norma da base (dispositivos e
 * preâmbulo, onde ficam os considerandos), segmento por segmento. É a entrada de "normas que citam"
 * do `kb impacto`; a compilação grava o mesmo resultado na tabela `normas_citacoes`, para o impacto
 * responder pelo banco sem reprocessar os Markdown.
 */
import { carregarEstruturas } from "./estrutura.ts";
import type { Registro } from "./registro.ts";
import { extrairCitacoes } from "./resolver.ts";

/** Citação resolvida (com ID) e os dispositivos citados, como o impacto as compara. */
export interface CitacaoResolvida {
  id: string;
  /** `dispositivos` da citação, ou `[dispositivoId]`, ou vazio. */
  dispositivos: string[];
  trecho: string;
}

/** Segmento de uma norma da base (dispositivo ou preâmbulo) com as citações resolvidas dele. */
export interface SegmentoCitante {
  /** ID do arquivo citante (com variante, se houver). */
  norma: string;
  ato: string;
  /** Sufixo do dispositivo (`#art5-ii`) ou `preâmbulo`. */
  segmento: string;
  /** Markdown, relativo à raiz do repositório. */
  path: string;
  linha_inicio: number;
  citacoes: CitacaoResolvida[];
}

/** Citações com ID de um texto, no formato da comparação do impacto. */
export function citacoesResolvidas(texto: string, registro: Registro): CitacaoResolvida[] {
  const saida: CitacaoResolvida[] = [];
  for (const c of extrairCitacoes(texto, registro)) {
    if (c.id === null) continue;
    saida.push({
      id: c.id,
      dispositivos: c.dispositivos ?? (c.dispositivoId ? [c.dispositivoId] : []),
      trecho: c.trecho,
    });
  }
  return saida;
}

/**
 * Segmentos (dispositivos e preâmbulo) das normas da base, com as citações, na ordem dos arquivos;
 * com `excetoAto`, sem os do próprio ato (o impacto não conta a norma citando a si mesma).
 */
export function* segmentosCitantes(registro: Registro, raiz: string, excetoAto?: string): Generator<SegmentoCitante> {
  for (const estrutura of carregarEstruturas(raiz)) {
    if (estrutura.ato === excetoAto) continue;
    for (const segmento of estrutura.segmentos) {
      if (segmento.tipo !== "dispositivo" && segmento.tipo !== "preambulo") continue;
      yield {
        norma: estrutura.id,
        ato: estrutura.ato,
        segmento: segmento.dispositivo ? segmento.dispositivo.slice(segmento.dispositivo.indexOf("#")) : "preâmbulo",
        path: `base-conhecimento/${estrutura.path}`,
        linha_inicio: segmento.linha_inicio,
        citacoes: citacoesResolvidas(segmento.texto, registro),
      };
    }
  }
}
