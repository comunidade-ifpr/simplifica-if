// @effect-diagnostics nodeBuiltinImport:off -- carregador síncrono de correspondencias/*.yaml, usado pelos scripts e pela compilação do banco
/**
 * Tabelas de correspondência entre normas que se sucedem (fase 5), em
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
import { dispositivosDaNorma, indiceDispositivos } from "./estrutura.ts";
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

/**
 * O que a correspondência lê, já carregado do `kb.sqlite` (`db/consultas-normas.ts`): as tabelas e,
 * dos atos de origem e de destino, os dispositivos canônicos (pai e texto) e os artigos.
 */
export interface FonteCorrespondencia {
  /** Tabelas de correspondência por ato de origem. */
  readonly tabelas: ReadonlyMap<string, ReadonlyArray<TabelaCorrespondencia>>;
  /** Dispositivo pelo ID do ato (`br/cne-cp/res/2021/1#art20-iii`): pai (ID completo) e texto. */
  readonly dispositivos: ReadonlyMap<string, { readonly pai: string | null; readonly texto: string }>;
  /** Sufixos dos artigos de cada ato de origem, em ordem (`#art1`, `#art2`...). */
  readonly artigos: ReadonlyMap<string, ReadonlyArray<string>>;
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
  const alvos = tabelas.length === 0 ? [] : sufixo ? [`#${sufixo}`] : (fonte.artigos.get(ato) ?? []);
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
 * dispositivo e aos subordinados dele (para `kb impacto`).
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
