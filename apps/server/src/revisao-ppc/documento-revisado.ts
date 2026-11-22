/**
 * O PPC revisado para o painel de leitura: o Markdown que a lista guarda, as seções como âncoras
 * (`secao-<n>`) e, para cada pendência com trecho, a âncora `p-<chave>` nas linhas onde ele está, com o
 * texto do trecho (o leitor destaca a frase exata). A
 * localização é feita a cada leitura, sobre o texto atual da lista: depois de "Enviar a versão
 * corrigida", aponta o arquivo novo (e a pendência cujo trecho sumiu fica sem âncora).
 */
import type { DocumentoRevisado, PendenciaRevisao } from "@simplifica-if/contratos-app";
import { segmentarPpc } from "@simplifica-if/kb/ppcs/secoes";
import { localizadorDeLinhas } from "@simplifica-if/ppc/localizar-trecho";

type Ancora = DocumentoRevisado["ancoras"][number];

/** O nome do arquivo, sem a pasta (Windows ou POSIX). */
const nomeDoArquivo = (caminho: string) => caminho.split(/[\\/]/).pop() || caminho;

export function documentoRevisado(entrada: {
  readonly arquivo: string;
  readonly markdown: string;
  readonly pendencias: ReadonlyArray<{ readonly chave: string; readonly pendencia: PendenciaRevisao }>;
}): DocumentoRevisado {
  // A taxonomia do técnico, como na pré-conferência (`prepararPpc`).
  const secoes = segmentarPpc(entrada.markdown, "tecnico");
  const localizar = localizadorDeLinhas(entrada.markdown, secoes);
  const ancoras: Ancora[] = secoes.map((s, i) => ({
    id: `secao-${i + 1}`,
    rotulo: s.titulo,
    tipo: s.tipo,
    pai: null,
    linha_inicio: s.linhaInicio,
    linha_fim: Math.max(s.linhaInicio, s.linhaFim),
    revogado: false,
  }));
  const trechos: Array<DocumentoRevisado["trechos"][number]> = [];
  for (const { chave, pendencia } of entrada.pendencias) {
    if (pendencia.trecho === null) continue;
    const linhas = localizar(pendencia.trecho, pendencia.secao);
    if (linhas === null) continue;
    ancoras.push({
      id: `p-${chave}`,
      rotulo: pendencia.tituloFicha,
      tipo: "pendencia",
      pai: null,
      linha_inicio: linhas.inicio,
      linha_fim: linhas.fim,
      revogado: false,
    });
    trechos.push({ id: `p-${chave}`, texto: pendencia.trecho });
  }
  ancoras.sort((a, b) => a.linha_inicio - b.linha_inicio);
  return {
    titulo: nomeDoArquivo(entrada.arquivo),
    markdown: entrada.markdown,
    ancoras,
    trechos,
  };
}
