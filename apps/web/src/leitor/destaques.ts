/**
 * Os destaques da CSS Custom Highlight API com mais de um leitor na janela. O `index.css` estiliza nomes
 * fixos (`::highlight(trecho-exato)`, `busca`, `busca-atual`), e `CSS.highlights` guarda um destaque por
 * nome: se cada leitor pusesse o seu, um apagaria o do outro. Aqui cada leitor registra as faixas dele
 * sob o nome, e o destaque do nome é a soma das faixas de todos.
 */

const porNome = new Map<string, Map<symbol, { readonly faixas: ReadonlyArray<Range>; readonly prioridade: number }>>();

function refazer(nome: string): void {
  const doNome = porNome.get(nome);
  if (doNome === undefined || doNome.size === 0) {
    porNome.delete(nome);
    CSS.highlights.delete(nome);
    return;
  }
  const registros = [...doNome.values()];
  const destaque = new Highlight(...registros.flatMap((r) => r.faixas));
  destaque.priority = Math.max(...registros.map((r) => r.prioridade));
  CSS.highlights.set(nome, destaque);
}

/** Pinta as faixas sob `nome`, somadas às dos outros leitores; a função devolvida as tira. */
export function pintar(nome: string, faixas: ReadonlyArray<Range>, prioridade = 0): () => void {
  if (!("highlights" in CSS) || faixas.length === 0) return () => {};
  const chave = Symbol(nome);
  const doNome = porNome.get(nome) ?? new Map();
  porNome.set(nome, doNome);
  doNome.set(chave, { faixas, prioridade });
  refazer(nome);
  return () => {
    if (!doNome.delete(chave)) return;
    refazer(nome);
  };
}
