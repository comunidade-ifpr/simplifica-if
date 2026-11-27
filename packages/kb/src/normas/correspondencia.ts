// @effect-diagnostics nodeBuiltinImport:off -- carregador síncrono de correspondencias/*.yaml, usado pelos scripts e pela compilação do banco
/**
 * Tabelas de correspondência entre normas que se sucedem, em
 * `base-conhecimento/correspondencias/*.yaml`: por dispositivo da norma de origem, `equivalente`,
 * `parcial` ou `sem-equivalente`, com os dispositivos de destino e nota.
 *
 * As tabelas são propostas por leitura comparada e ficam `status: rascunho` até a revisão
 * jurídica humana. Dispositivo sem item próprio herda o item do ancestral mais próximo.
 */
import * as Schema from "effect/Schema";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { parse } from "yaml";
import { CAMINHOS, noCheckout } from "../caminhos.ts";
import { caminhoTexto, problemas } from "../esquema/mensagens.ts";
import { dispositivosDaNorma, indiceDispositivos, type TipoDispositivo } from "./estrutura.ts";
import { ehIdNorma, ehIdDispositivo } from "./ids.ts";

/** Texto que satisfaz `predicado`, com a mensagem dada quando não satisfaz. */
const textoQue = (predicado: (valor: string) => boolean, mensagem: string) =>
  Schema.String.check(Schema.makeFilter((valor: string) => predicado(valor), { message: mensagem }));
const textoNaoVazio = Schema.String.check(Schema.isMinLength(1));
const dispositivo = textoQue(ehIdDispositivo, "dispositivo fora do formato (#art20-iii)");

const TIPOS_CORRESPONDENCIA = ["equivalente", "parcial", "sem-equivalente"] as const;

export const esquemaItemCorrespondencia = Schema.Struct({
  origem: dispositivo,
  tipo: Schema.Literals(TIPOS_CORRESPONDENCIA),
  destino: Schema.Array(dispositivo),
  nota: Schema.optionalKey(textoNaoVazio),
}).check(
  Schema.makeFilter((item) => {
    const achados: Schema.FilterIssue[] = [];
    if (item.tipo === "sem-equivalente" && item.destino.length) {
      achados.push({ path: ["destino"], issue: "sem-equivalente não tem destino" });
    }
    if (item.tipo !== "sem-equivalente" && item.destino.length === 0) {
      achados.push({ path: ["destino"], issue: `${item.tipo} exige destino` });
    }
    if (item.tipo === "sem-equivalente" && !item.nota) {
      achados.push({ path: ["nota"], issue: "sem-equivalente exige nota" });
    }
    return achados;
  }),
);

export const esquemaCorrespondencia = Schema.Struct({
  origem: textoQue(ehIdNorma, "origem deve ser ID de ato"),
  destino: textoQue(ehIdNorma, "destino deve ser ID de ato"),
  status: Schema.Literals(["rascunho", "revisado"]),
  elaborado_em: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)),
  revisado_por: Schema.optionalKey(Schema.String),
  metodo: textoNaoVazio,
  itens: Schema.Array(esquemaItemCorrespondencia).check(Schema.isMinLength(1)),
});
export type TabelaCorrespondencia = typeof esquemaCorrespondencia.Type & { arquivo: string };
export type ItemCorrespondencia = typeof esquemaItemCorrespondencia.Type;
const decodificarCorrespondencia = Schema.decodeUnknownSync(esquemaCorrespondencia, {
  onExcessProperty: "error",
  errors: "all",
});

export function diretorioCorrespondencias(raiz: string): string {
  return noCheckout(raiz, CAMINHOS.correspondencias);
}

/** Tabelas de correspondência da base (arquivo relativo à raiz do repositório). */
export function carregarCorrespondencias(raiz: string): TabelaCorrespondencia[] {
  const diretorio = diretorioCorrespondencias(raiz);
  if (!NodeFS.existsSync(diretorio)) return [];
  return NodeFS.readdirSync(diretorio)
    .filter((nome) => nome.endsWith(".yaml"))
    .sort()
    .map((nome) => {
      const arquivo = NodePath.join(diretorio, nome);
      const dados = decodificarCorrespondencia(
        parse(NodeFS.readFileSync(arquivo, "utf-8"), { schema: "failsafe", uniqueKeys: true }),
      );
      return { ...dados, arquivo: NodePath.relative(raiz, arquivo).split(NodePath.sep).join("/") };
    });
}

export interface ResultadoCorrespondencia {
  /** ID consultado (`br/cne-cp/res/2021/1#art20`). */
  id: string;
  tabela: string;
  status: TabelaCorrespondencia["status"];
  destino_ato: string;
  /** Item aplicado; `herdado_de` quando veio de um ancestral. */
  item: ItemCorrespondencia;
  herdado_de: string | null;
  /** Itens próprios dos descendentes do dispositivo consultado (detalhamento). */
  detalhes: ItemCorrespondencia[];
  /** Texto do dispositivo de origem e dos dispositivos de destino. */
  texto_origem: string | null;
  textos_destino: { id: string; texto: string | null }[];
}

/** Um dispositivo da fonte da correspondência: o que o alinhamento mostra e a herança percorre. */
export interface DispositivoDaFonte {
  readonly tipo: TipoDispositivo;
  /** Rótulo como está no texto: `Art. 28`, `§ 1º`, `XVI`. */
  readonly rotulo: string;
  /** ID completo do pai; `null` no artigo. */
  readonly pai: string | null;
  /** Texto do próprio dispositivo (com o rótulo), sem os filhos. */
  readonly texto: string;
}

/**
 * O que a correspondência lê, já carregado do `kb.sqlite` (`db/consultas-normas.ts`): as tabelas e,
 * dos atos de origem e de destino, os dispositivos canônicos e a ordem deles no arquivo.
 */
export interface FonteCorrespondencia {
  /** Tabelas de correspondência por ato de origem. */
  readonly tabelas: ReadonlyMap<string, ReadonlyArray<TabelaCorrespondencia>>;
  /** Dispositivo pelo ID do ato (`br/cne-cp/res/2021/1#art20-iii`). */
  readonly dispositivos: ReadonlyMap<string, DispositivoDaFonte>;
  /** Sufixos dos dispositivos de cada ato de origem e de destino, na ordem do arquivo (`#art1`, `#art1-i`...). */
  readonly ordem: ReadonlyMap<string, ReadonlyArray<string>>;
}

/** Sufixos dos artigos do ato, em ordem. */
function artigosDe(ato: string, fonte: FonteCorrespondencia): string[] {
  return (fonte.ordem.get(ato) ?? []).filter((s) => fonte.dispositivos.get(`${ato}${s}`)?.tipo === "artigo");
}

/** Ancestrais de um ID de dispositivo, do mais próximo ao artigo (`#art20-par1-iii` → `#art20-par1`, `#art20`). */
function ancestrais(dispositivoId: string, fonte: FonteCorrespondencia, ato: string): string[] {
  const saida: string[] = [];
  let atual = fonte.dispositivos.get(`${ato}${dispositivoId}`)?.pai ?? null;
  while (atual) {
    saida.push(atual.slice(atual.indexOf("#")));
    atual = fonte.dispositivos.get(`${ato}${atual.slice(atual.indexOf("#"))}`)?.pai ?? null;
  }
  return saida;
}

/** Correspondência de um dispositivo (ou ato) de origem, pelas tabelas da base. */
export function correspondenciaEm(id: string, fonte: FonteCorrespondencia): ResultadoCorrespondencia[] {
  const [ato, sufixo] = id.split("#") as [string, string | undefined];
  const saida: ResultadoCorrespondencia[] = [];
  const tabelas = fonte.tabelas.get(ato) ?? [];
  const alvos = tabelas.length === 0 ? [] : sufixo ? [`#${sufixo}`] : artigosDe(ato, fonte);
  for (const tabela of tabelas) {
    const porOrigem = new Map(tabela.itens.map((item) => [item.origem, item]));
    for (const alvo of alvos) {
      let item = porOrigem.get(alvo);
      let herdado: string | null = null;
      if (!item) {
        for (const ancestral of ancestrais(alvo, fonte, ato)) {
          item = porOrigem.get(ancestral);
          if (item) {
            herdado = ancestral;
            break;
          }
        }
      }
      if (!item) continue;
      const detalhes = tabela.itens.filter((i) => i.origem !== alvo && i.origem.startsWith(`${alvo}-`));
      saida.push({
        id: `${ato}${alvo}`,
        tabela: tabela.arquivo,
        status: tabela.status,
        destino_ato: tabela.destino,
        item,
        herdado_de: herdado,
        detalhes,
        texto_origem: fonte.dispositivos.get(`${ato}${alvo}`)?.texto ?? null,
        textos_destino: item.destino.map((d) => ({
          id: `${tabela.destino}${d}`,
          texto: fonte.dispositivos.get(`${tabela.destino}${d}`)?.texto ?? null,
        })),
      });
    }
  }
  return saida;
}

/**
 * Dispositivos de destino que correspondem ao ato `origem` (qualquer dispositivo) ou, com `#`, ao
 * dispositivo e aos subordinados dele (para `kb impacto-da-norma`).
 */
export function destinosDeOrigemEm(origem: string, fonte: FonteCorrespondencia): Set<string> {
  const saida = new Set<string>();
  if (origem.includes("#")) {
    // Dispositivo: só os destinos dele (item próprio ou herdado do ancestral) e dos subordinados.
    for (const r of correspondenciaEm(origem, fonte)) {
      for (const item of [r.item, ...r.detalhes]) for (const d of item.destino) saida.add(`${r.destino_ato}${d}`);
    }
    return saida;
  }
  for (const tabela of fonte.tabelas.get(origem) ?? []) {
    for (const item of tabela.itens) for (const d of item.destino) saida.add(`${tabela.destino}${d}`);
  }
  return saida;
}

/* ================================================================ alinhamento */

/** Um dispositivo numa linha do alinhamento. */
export interface LadoAlinhado {
  /** ID completo (`br/cne-cp/res/2021/1#art5-par2`). */
  readonly id: string;
  /** Os rótulos desde o artigo: `Art. 5º, § 2º`. */
  readonly rotulo: string;
  /** O texto do próprio dispositivo, sem o rótulo. */
  readonly texto: string;
  /** Os filhos que a linha não mostra, por tipo, na ordem do primeiro de cada tipo ("17 incisos"). */
  readonly subordinados: ReadonlyArray<{ readonly tipo: TipoDispositivo; readonly quantos: number }>;
}

/** Um dispositivo de origem citado por outra linha: o ID completo e os rótulos desde o artigo. */
export interface ReferenciaAlinhada {
  readonly id: string;
  readonly rotulo: string;
}

export interface DestinoAlinhado extends LadoAlinhado {
  /** N→1: os outros dispositivos de origem, com item próprio, que apontam este mesmo destino. */
  readonly tambem: ReadonlyArray<ReferenciaAlinhada>;
}

export interface LinhaAlinhada {
  readonly origem: LadoAlinhado;
  readonly tipo: ItemCorrespondencia["tipo"];
  /** A nota do item próprio; `null` sem nota e na linha herdada (a nota é a da linha do ancestral). */
  readonly nota: string | null;
  /** O ancestral de que a linha herdou o item, quando o dispositivo não tem item próprio. */
  readonly herdado_de: ReferenciaAlinhada | null;
  /** 1→N: os destinos empilham, na ordem do item. Vazio em `sem-equivalente`. */
  readonly destinos: ReadonlyArray<DestinoAlinhado>;
}

/** Duas normas que se sucedem, lado a lado, pela tabela de correspondência. */
export interface Alinhamento {
  /** A tabela (relativa à raiz do repositório). */
  readonly tabela: string;
  readonly status: TabelaCorrespondencia["status"];
  readonly origem: string;
  readonly destino: string;
  /** Na ordem da origem. */
  readonly linhas: ReadonlyArray<LinhaAlinhada>;
  /** Os artigos do destino que nenhum item aponta, nem por um dispositivo deles, na ordem do destino. */
  readonly novos: ReadonlyArray<LadoAlinhado>;
}

/** O texto sem o rótulo do começo e a pontuação que o separa (`Art. 10. As…`, `I – a…`). */
function semRotulo(texto: string, rotulo: string): string {
  const resto = texto.startsWith(rotulo) ? texto.slice(rotulo.length) : texto;
  return resto.replace(/^[\s.–—-]+/, "");
}

/**
 * As duas normas da tabela alinhadas, numa lista de linhas na ordem da origem:
 *
 * - o artigo sem item em nenhum dispositivo abaixo dele é uma linha só, com o caput e a contagem dos
 *   filhos (`subordinados`);
 * - o artigo detalhado (algum dispositivo abaixo dele tem item próprio) tem uma linha por dispositivo,
 *   e o que não tem item herda o do ancestral mais próximo, como em `correspondenciaEm`;
 * - 1→N: os destinos do item empilham na linha; N→1: cada destino lista as outras origens que o apontam;
 * - os artigos do destino que nenhum item aponta, nem por um dispositivo deles, vão para `novos`.
 */
export function alinhamentoEm(tabela: TabelaCorrespondencia, fonte: FonteCorrespondencia): Alinhamento {
  const { origem: atoOrigem, destino: atoDestino } = tabela;
  const disp = (ato: string, sufixo: string) => fonte.dispositivos.get(`${ato}${sufixo}`);
  const sufixoDe = (id: string) => id.slice(id.indexOf("#"));
  /** Do dispositivo ao topo (o artigo), o próprio primeiro. */
  const linhagem = (ato: string, sufixo: string): string[] => {
    const saida = [sufixo];
    for (let pai = disp(ato, sufixo)?.pai ?? null; pai !== null; pai = disp(ato, sufixoDe(pai))?.pai ?? null) {
      saida.push(sufixoDe(pai));
    }
    return saida;
  };
  const rotulo = (ato: string, sufixo: string) =>
    linhagem(ato, sufixo)
      .reverse()
      .map((s, i) => {
        const r = (disp(ato, s)?.rotulo ?? s).replace(/\.$/, "");
        return i > 0 && r.startsWith("Parágrafo") ? `p${r.slice(1)}` : r;
      })
      .join(", ");
  const referencia = (ato: string, sufixo: string): ReferenciaAlinhada => ({
    id: `${ato}${sufixo}`,
    rotulo: rotulo(ato, sufixo),
  });
  const filhos = new Map<string, string[]>();
  for (const ato of [atoOrigem, atoDestino]) {
    for (const s of fonte.ordem.get(ato) ?? []) {
      const pai = disp(ato, s)?.pai;
      if (pai) filhos.set(pai, [...(filhos.get(pai) ?? []), s]);
    }
  }
  const subordinados = (ato: string, sufixo: string) => {
    const contagem = new Map<TipoDispositivo, number>();
    for (const f of filhos.get(`${ato}${sufixo}`) ?? []) {
      const tipo = disp(ato, f)?.tipo;
      if (tipo) contagem.set(tipo, (contagem.get(tipo) ?? 0) + 1);
    }
    return [...contagem].map(([tipo, quantos]) => ({ tipo, quantos }));
  };
  const lado = (ato: string, sufixo: string, comSubordinados: boolean): LadoAlinhado => {
    const d = disp(ato, sufixo);
    return {
      id: `${ato}${sufixo}`,
      rotulo: rotulo(ato, sufixo),
      texto: d ? semRotulo(d.texto, d.rotulo) : "",
      subordinados: comSubordinados ? subordinados(ato, sufixo) : [],
    };
  };

  const porOrigem = new Map(tabela.itens.map((item) => [item.origem, item]));
  const detalhados = new Set<string>();
  for (const item of tabela.itens) {
    const acima = linhagem(atoOrigem, item.origem);
    if (acima.length > 1) detalhados.add(acima.at(-1)!);
  }
  const origensPorDestino = new Map<string, string[]>();
  for (const item of tabela.itens) {
    for (const d of item.destino) origensPorDestino.set(d, [...(origensPorDestino.get(d) ?? []), item.origem]);
  }

  const linhas: LinhaAlinhada[] = [];
  for (const sufixo of fonte.ordem.get(atoOrigem) ?? []) {
    const acima = linhagem(atoOrigem, sufixo);
    const topo = acima.at(-1)!;
    const detalhado = detalhados.has(topo);
    if (acima.length > 1 && !detalhado) continue;
    const aplicado = acima.find((s) => porOrigem.has(s));
    if (aplicado === undefined) continue;
    const item = porOrigem.get(aplicado)!;
    const proprio = aplicado === sufixo;
    linhas.push({
      origem: lado(atoOrigem, sufixo, !detalhado),
      tipo: item.tipo,
      nota: proprio ? (item.nota ?? null) : null,
      herdado_de: proprio ? null : referencia(atoOrigem, aplicado),
      destinos: item.destino.map((d) => ({
        ...lado(atoDestino, d, true),
        tambem: (origensPorDestino.get(d) ?? []).filter((o) => o !== item.origem).map((o) => referencia(atoOrigem, o)),
      })),
    });
  }

  const apontados = new Set<string>();
  for (const item of tabela.itens) for (const d of item.destino) apontados.add(linhagem(atoDestino, d).at(-1)!);
  const novos = artigosDe(atoDestino, fonte)
    .filter((s) => !apontados.has(s))
    .map((s) => lado(atoDestino, s, true));

  return { tabela: tabela.arquivo, status: tabela.status, origem: atoOrigem, destino: atoDestino, linhas, novos };
}

/** Validação: dispositivos existentes nos dois textos, sem origem repetida, artigos da origem cobertos. */
export function validarCorrespondencias(raiz: string): string[] {
  let tabelas: TabelaCorrespondencia[];
  try {
    tabelas = carregarCorrespondencias(raiz);
  } catch (erro) {
    if (Schema.isSchemaError(erro)) {
      return problemas(erro.issue).map((p) => `correspondencias: ${caminhoTexto(p.caminho)}: ${p.mensagem}`);
    }
    return [`correspondencias: ${(erro as Error).message.split("\n")[0]}`];
  }
  const indice = indiceDispositivos(raiz);
  const erros: string[] = [];
  for (const tabela of tabelas) {
    const vistas = new Set<string>();
    tabela.itens.forEach((item, i) => {
      const rotulo = `${tabela.arquivo}: itens.${i} (${item.origem})`;
      if (vistas.has(item.origem)) erros.push(`${rotulo}: origem repetida`);
      vistas.add(item.origem);
      if (!indice.has(`${tabela.origem}${item.origem}`)) erros.push(`${rotulo}: dispositivo inexistente na origem`);
      for (const d of item.destino) {
        if (!indice.has(`${tabela.destino}${d}`))
          erros.push(`${rotulo}: destino ${d} inexistente em ${tabela.destino}`);
      }
    });
    for (const disp of dispositivosDaNorma(tabela.origem, raiz)) {
      if (disp.tipo === "artigo" && !vistas.has(disp.dispositivo)) {
        erros.push(`${tabela.arquivo}: artigo da origem sem item: ${disp.dispositivo}`);
      }
    }
  }
  return erros;
}
