// @effect-diagnostics nodeBuiltinImport:off -- leitura e validação síncronas dos registros de conselhos (gerar_base, validar_base)
/**
 * Conselhos superiores do IFPR (`institucional/ifpr/conselhos/<conselho_id>/`): o registro do conselho
 * (`conselho.json`) e um arquivo por reunião (`reunioes/<data>.json`) com os documentos publicados
 * (pareceres, pautas) e os itens de pauta deliberados. Hoje só o Consepe, migrado do Notion em
 * 17/11/2026 a partir dos atos públicos do conselho.
 *
 * Não há entidade de pessoa: relator e conselheiros ficaram de fora; um nome só aparece quando faz
 * parte do texto do ato. Os itens apontam para campus e curso pelas chaves canônicas, quando o curso
 * está cadastrado; `campus_texto` e `curso_texto` guardam a redação do ato.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { caminhoTexto, problemas } from "@simplifica-if/kb/esquema/mensagens";
import { ESTRITO } from "../esquema.ts";
import { compararTexto } from "../dominio/comum.ts";
import { ARQUIVO_INDICE, RAIZ_DADOS_INSTITUCIONAIS, textoRegistro } from "./institucional.ts";

export const PASTA_CONSELHOS = "conselhos";
const PREFIXO = `institucional/ifpr/${PASTA_CONSELHOS}`;

const texto = Schema.optional(Schema.String);
const data = Schema.String.check(
  Schema.makeFilter((valor: string) => /^\d{4}-\d{2}-\d{2}$/.test(valor), { message: "deve ser AAAA-MM-DD" }),
);
const https = Schema.String.check(
  Schema.makeFilter((valor: string) => valor.startsWith("https://"), { message: "deve ser URL https://" }),
);

export const esquemaConselho = Schema.Struct({
  conselho_id: Schema.String,
  nome: Schema.String,
  sigla: Schema.String,
  situacao: Schema.Literals(["ativo", "inativo"]),
  pagina_oficial: https,
});
export type Conselho = typeof esquemaConselho.Type;

export const esquemaDocumentoConselho = Schema.Struct({
  documento_id: Schema.String,
  tipo: Schema.Literals(["parecer", "pauta", "ata", "resolução", "outro"]),
  titulo: Schema.String,
  numero: texto,
  ano: Schema.Int,
  data,
  resumo: texto,
  url: https,
  coletado_em: data,
  /** Até onde o documento foi lido: só os metadados ou o texto. */
  extracao: Schema.Literals(["metadados", "texto"]),
});

export const esquemaItemPauta = Schema.Struct({
  item_id: Schema.String,
  ordem: Schema.Int,
  titulo: Schema.String,
  resumo: Schema.String,
  tipo_demanda: Schema.String,
  resultado: Schema.String,
  /** Documento da mesma reunião de onde o item saiu. */
  documento_id: Schema.String,
  processo_sei: texto,
  campus_texto: texto,
  campus_id: texto,
  curso_texto: texto,
  curso_id: texto,
  palavras_chave: Schema.Array(Schema.String),
  trecho_pauta: Schema.String,
});

export const esquemaReuniao = Schema.Struct({
  reuniao_id: Schema.String,
  conselho_id: Schema.String,
  titulo: Schema.String,
  data,
  tipo: Schema.Literals(["ordinária", "extraordinária"]),
  situacao: Schema.Literals(["realizada", "prevista", "cancelada"]),
  fonte: https,
  documentos: Schema.Array(esquemaDocumentoConselho),
  itens_pauta: Schema.Array(esquemaItemPauta),
});
export type Reuniao = typeof esquemaReuniao.Type;

const decodificar = {
  conselho: Schema.decodeUnknownResult(esquemaConselho, ESTRITO),
  reuniao: Schema.decodeUnknownResult(esquemaReuniao, ESTRITO),
};

export interface Conselhos {
  conselhos: Array<{ arquivo: string; dados: Conselho }>;
  reunioes: Array<{ arquivo: string; dados: Reuniao }>;
}

function lerJson<T>(
  arquivo: string,
  relativo: string,
  decodificarRegistro: (valor: unknown) => Result.Result<T, Schema.SchemaError>,
  erros: string[],
): T | null {
  let bruto: unknown;
  try {
    bruto = JSON.parse(NodeFS.readFileSync(arquivo, "utf-8"));
  } catch (erro) {
    erros.push(`${relativo}: JSON inválido: ${(erro as Error).message}`);
    return null;
  }
  const resultado = decodificarRegistro(bruto);
  if (Result.isFailure(resultado)) {
    for (const problema of problemas(resultado.failure.issue)) {
      erros.push(`${relativo}: ${caminhoTexto(problema.caminho) || "(raiz)"}: ${problema.mensagem}`);
    }
    return null;
  }
  return resultado.success;
}

/** Lê e valida o schema e o caminho de cada arquivo (o nome da pasta é o `conselho_id`; o da reunião, a data). */
export function carregarConselhos(raiz: string = RAIZ_DADOS_INSTITUCIONAIS): { dados: Conselhos; erros: string[] } {
  const erros: string[] = [];
  const dados: Conselhos = { conselhos: [], reunioes: [] };
  const pasta = NodePath.join(raiz, PASTA_CONSELHOS);
  if (!NodeFS.existsSync(pasta)) return { dados, erros };
  const subpastas = NodeFS.readdirSync(pasta, { withFileTypes: true })
    .filter((entrada) => entrada.isDirectory())
    .map((entrada) => entrada.name)
    .sort(compararTexto);
  for (const id of subpastas) {
    const relConselho = `${PREFIXO}/${id}/conselho.json`;
    const conselho = NodeFS.existsSync(NodePath.join(pasta, id, "conselho.json"))
      ? lerJson(NodePath.join(pasta, id, "conselho.json"), relConselho, decodificar.conselho, erros)
      : (erros.push(`${relConselho} ausente`), null);
    if (conselho) {
      if (conselho.conselho_id !== id) erros.push(`${relConselho}: conselho_id deveria ser ${id}`);
      dados.conselhos.push({ arquivo: relConselho, dados: conselho });
    }
    const pastaReunioes = NodePath.join(pasta, id, "reunioes");
    const arquivos = NodeFS.existsSync(pastaReunioes)
      ? NodeFS.readdirSync(pastaReunioes)
          .filter((nome) => nome.endsWith(".json"))
          .sort(compararTexto)
      : [];
    for (const nome of arquivos) {
      const relativo = `${PREFIXO}/${id}/reunioes/${nome}`;
      const reuniao = lerJson(NodePath.join(pastaReunioes, nome), relativo, decodificar.reuniao, erros);
      if (!reuniao) continue;
      if (reuniao.conselho_id !== id) erros.push(`${relativo}: conselho_id deveria ser ${id}`);
      if (nome !== `${reuniao.data}.json`) erros.push(`${relativo}: arquivo deveria se chamar ${reuniao.data}.json`);
      dados.reunioes.push({ arquivo: relativo, dados: reuniao });
    }
  }
  return { dados, erros };
}

/** Relações: documento do item na mesma reunião, campus e curso cadastrados, ids únicos. */
export function auditarConselhos(dados: Conselhos, campi: Set<string>, cursos: Set<string>): string[] {
  const erros: string[] = [];
  const vistos = new Set<string>();
  const unico = (id: string, arquivo: string) => {
    if (vistos.has(id)) erros.push(`${arquivo}: id repetido: ${id}`);
    vistos.add(id);
  };
  for (const { arquivo, dados: reuniao } of dados.reunioes) {
    unico(reuniao.reuniao_id, arquivo);
    const documentos = new Set(reuniao.documentos.map((documento) => documento.documento_id));
    for (const documento of reuniao.documentos) unico(documento.documento_id, arquivo);
    for (const item of reuniao.itens_pauta) {
      unico(item.item_id, arquivo);
      if (!documentos.has(item.documento_id)) {
        erros.push(`${arquivo}: item ${item.item_id}: documento_id fora da reunião: ${item.documento_id}`);
      }
      if (item.campus_id && !campi.has(item.campus_id)) {
        erros.push(`${arquivo}: item ${item.item_id}: campus_id inexistente: ${item.campus_id}`);
      }
      if (item.curso_id && !cursos.has(item.curso_id)) {
        erros.push(`${arquivo}: item ${item.item_id}: curso_id inexistente: ${item.curso_id}`);
      }
      if (item.curso_id && item.campus_id && !item.curso_id.startsWith(`${item.campus_id}/`)) {
        erros.push(`${arquivo}: item ${item.item_id}: curso_id de outro campus: ${item.curso_id}`);
      }
    }
  }
  return erros;
}

/** `conselhos/index.json`: uma linha por reunião, com o caminho e as contagens. */
export function montarIndiceConselhos(dados: Conselhos) {
  const items = dados.reunioes
    .map(({ arquivo, dados: reuniao }) => ({
      id: reuniao.reuniao_id,
      conselho_id: reuniao.conselho_id,
      data: reuniao.data,
      titulo: reuniao.titulo,
      documentos: reuniao.documentos.length,
      itens_pauta: reuniao.itens_pauta.length,
      path: arquivo,
    }))
    .sort((a, b) => compararTexto(a.conselho_id, b.conselho_id) || compararTexto(a.data, b.data));
  return {
    id: "conselhos-ifpr",
    title: "Conselhos superiores do IFPR",
    descricao:
      "Reuniões dos conselhos superiores (hoje o Consepe), com os documentos publicados e os itens de pauta deliberados. " +
      "O registro de cada conselho fica em conselhos/<conselho_id>/conselho.json.",
    tipo_item: "reuniao_conselho",
    conselhos: dados.conselhos.map(({ arquivo, dados: conselho }) => ({
      id: conselho.conselho_id,
      sigla: conselho.sigla,
      nome: conselho.nome,
      path: arquivo,
    })),
    total_itens: items.length,
    items,
  };
}

const ARQUIVO_INDICE_CONSELHOS = (raiz: string) => NodePath.join(raiz, PASTA_CONSELHOS, ARQUIVO_INDICE);

export function gravarIndiceConselhos(dados: Conselhos, raiz: string = RAIZ_DADOS_INSTITUCIONAIS): boolean {
  const destino = ARQUIVO_INDICE_CONSELHOS(raiz);
  const texto = textoRegistro(montarIndiceConselhos(dados));
  if (NodeFS.existsSync(destino) && NodeFS.readFileSync(destino, "utf-8") === texto) return false;
  NodeFS.writeFileSync(destino, texto, "utf-8");
  return true;
}

export function verificarIndiceConselhos(dados: Conselhos, raiz: string = RAIZ_DADOS_INSTITUCIONAIS): string[] {
  const destino = ARQUIVO_INDICE_CONSELHOS(raiz);
  const atual = NodeFS.existsSync(destino) ? NodeFS.readFileSync(destino, "utf-8") : null;
  if (atual === textoRegistro(montarIndiceConselhos(dados))) return [];
  return [
    `${PREFIXO}/${ARQUIVO_INDICE} ${atual === null ? "ausente" : "desatualizado"}; rode node scripts/gerar_base.ts`,
  ];
}
