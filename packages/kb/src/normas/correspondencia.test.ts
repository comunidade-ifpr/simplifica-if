import { describe, expect, test } from "vite-plus/test";
import { raizRepositorio } from "../caminhos.ts";
import {
  alinhamentoEm,
  carregarCorrespondencias,
  type DispositivoDaFonte,
  type FonteCorrespondencia,
  type LinhaAlinhada,
  type TabelaCorrespondencia,
} from "./correspondencia.ts";
import { dispositivosDaNorma } from "./estrutura.ts";

const raiz = raizRepositorio();
const DCN_2021 = "br/cne-cp/res/2021/1";
const DCN_2026 = "br/cne-cp/res/2026/2";

/** A fonte da correspondência montada dos arquivos (a do app vem do banco, com os mesmos campos). */
function fonteDosArquivos(tabelas: ReadonlyArray<TabelaCorrespondencia>): FonteCorrespondencia {
  const porOrigem = new Map<string, TabelaCorrespondencia[]>();
  for (const t of tabelas) porOrigem.set(t.origem, [...(porOrigem.get(t.origem) ?? []), t]);
  const dispositivos = new Map<string, DispositivoDaFonte>();
  const ordem = new Map<string, string[]>();
  for (const ato of new Set(tabelas.flatMap((t) => [t.origem, t.destino]))) {
    const lista = dispositivosDaNorma(ato, raiz);
    for (const d of lista) dispositivos.set(d.id, { tipo: d.tipo, rotulo: d.rotulo, pai: d.pai, texto: d.texto });
    ordem.set(
      ato,
      lista.map((d) => d.dispositivo),
    );
  }
  return { tabelas: porOrigem, dispositivos, ordem };
}

describe("alinhamentoEm: a tabela 1/2021 → 2/2026", () => {
  const tabelas = carregarCorrespondencias(raiz);
  const tabela = tabelas.find((t) => t.origem === DCN_2021 && t.destino === DCN_2026)!;
  const alinhamento = alinhamentoEm(tabela, fonteDosArquivos(tabelas));
  const linha = (sufixo: string): LinhaAlinhada => {
    const achada = alinhamento.linhas.find((l) => l.origem.id === `${DCN_2021}${sufixo}`);
    if (!achada) throw new Error(`sem linha para ${sufixo}`);
    return achada;
  };

  test("cabeçalho da tabela", () => {
    expect(alinhamento).toMatchObject({ origem: DCN_2021, destino: DCN_2026, status: "rascunho" });
    expect(alinhamento.tabela).toBe(tabela.arquivo);
  });

  test("uma linha por dispositivo, na ordem da origem", () => {
    const ids = alinhamento.linhas.map((l) => l.origem.id.slice(DCN_2021.length));
    expect(ids.slice(0, 4)).toEqual(["#art1", "#art1-parunico", "#art2", "#art3"]);
    const ordem = dispositivosDaNorma(DCN_2021, raiz).map((d) => d.dispositivo);
    const posicoes = ids.map((id) => ordem.indexOf(id));
    expect(posicoes.every((p, i) => p >= 0 && (i === 0 || p > posicoes[i - 1]!))).toBe(true);
    // todo item da tabela tem a linha dele
    for (const item of tabela.itens) expect(ids).toContain(item.origem);
  });

  test("artigo só com caput: uma linha, com a contagem dos filhos", () => {
    const art3 = linha("#art3");
    expect(art3.origem).toMatchObject({
      rotulo: "Art. 3º",
      texto: "São princípios da Educação Profissional e Tecnológica:",
      subordinados: [{ tipo: "inciso", quantos: 19 }],
    });
    expect(alinhamento.linhas.some((l) => l.origem.id.startsWith(`${DCN_2021}#art3-`))).toBe(false);
    // o destino também mostra o caput e os filhos
    expect(art3.destinos[0]).toMatchObject({ rotulo: "Art. 3º", subordinados: [{ tipo: "inciso", quantos: 17 }] });
  });

  test("artigo detalhado: os dispositivos sem item herdam o do ancestral", () => {
    expect(linha("#art5").origem.subordinados).toEqual([]);
    const par1 = linha("#art5-par1");
    expect(par1.herdado_de).toEqual({ id: `${DCN_2021}#art5`, rotulo: "Art. 5º" });
    expect(par1.origem.rotulo).toBe("Art. 5º, § 1º");
    expect(par1.nota).toBeNull();
    expect(par1.destinos.map((d) => d.id)).toEqual([`${DCN_2026}#art9`]);
    expect(linha("#art5-par2").herdado_de).toBeNull();
    // os incisos do § 4º, sem item, herdam o do § 4º
    expect(linha("#art5-par4-i").herdado_de?.id).toBe(`${DCN_2021}#art5-par4`);
    expect(linha("#art1-parunico").origem.rotulo).toBe("Art. 1º, parágrafo único");
  });

  test("1→N: os destinos empilham na linha", () => {
    const art2 = linha("#art2");
    expect(art2.tipo).toBe("parcial");
    expect(art2.nota).toContain("áreas tecnológicas");
    expect(art2.destinos.map((d) => d.rotulo)).toEqual(["Art. 1º, § 1º", "Art. 1º, § 2º"]);
    expect(art2.destinos[1]!.texto).toBe(
      "A EPT é organizada por eixos e áreas tecnológicas e por itinerários formativos profissionais.",
    );
  });

  test("N→1: o destino se repete, com as outras origens", () => {
    const [art10, art11] = [linha("#art10"), linha("#art11")];
    expect(art10.destinos.map((d) => d.id)).toEqual([`${DCN_2026}#art47`]);
    expect(art11.destinos.map((d) => d.id)).toEqual([`${DCN_2026}#art47`]);
    expect(art10.destinos[0]!.tambem).toEqual([{ id: `${DCN_2021}#art11`, rotulo: "Art. 11" }]);
    expect(art11.destinos[0]!.tambem).toEqual([{ id: `${DCN_2021}#art10`, rotulo: "Art. 10" }]);
    // a linha herdada não conta: só itens próprios apontam
    expect(linha("#art5").destinos[0]!.tambem).toEqual([]);
  });

  test("sem equivalente: sem destino, com a nota", () => {
    const sem = linha("#art1-parunico");
    expect(sem.tipo).toBe("sem-equivalente");
    expect(sem.destinos).toEqual([]);
    expect(sem.nota).toBe('A 2/2026 não define "Diretriz".');
  });

  test("novos: os artigos do destino que nenhum item aponta, nem por um dispositivo deles", () => {
    const novos = alinhamento.novos.map((n) => n.id.slice(DCN_2026.length));
    expect(novos).toEqual([
      "#art4",
      "#art5",
      "#art6",
      "#art8",
      "#art21",
      "#art55",
      "#art60",
      "#art65",
      "#art66",
      "#art67",
      "#art68",
      "#art72",
    ]);
    // o art. 36 da 2/2026 é apontado (pelo art. 33 e pelo inciso IX do art. 20) e não é novo
    expect(novos).not.toContain("#art36");
    expect(alinhamento.novos[0]!.rotulo).toBe("Art. 4º");
  });
});
