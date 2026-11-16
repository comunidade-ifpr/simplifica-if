// @effect-diagnostics nodeBuiltinImport:off -- gerador síncrono de indice.json, chamado pela CLI e pelos testes
/** Índice consolidado da base de análise (`base-analise/indice.json`). */
import * as NodeUtil from "node:util";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import {
  ehObjeto,
  itensDe,
  itensPercorridos,
  jsonIndentado,
  type ObjetoJson,
  textoDe,
  textoOuVazio,
} from "@simplifica-if/kb/json";
import { ordenarTextos } from "@simplifica-if/kb/texto";
import { agoraUtc, escreverTexto, lerJson, listarArquivos } from "./arquivos.ts";
import type { UniversoReferencias } from "@simplifica-if/kb/normas/referencia-estruturada";
import { carregarMarcos } from "./validacao-base.ts";
import { MODOS_EXECUCAO } from "./esquemas.ts";
import { VERIFICADOR_POR_FICHA } from "@simplifica-if/ppc/verificadores/registro";
import { type CaminhosAnalise, caminhosPadrao } from "./caminhos.ts";
import { marcoLegivel, normasCitadas, referenciasLegiveisDaFicha, universoOuVazio } from "./referencias-fichas.ts";

type Item = { [campo: string]: unknown };

function lerObjeto(caminho: string): ObjetoJson {
  const payload = lerJson(caminho);
  if (!ehObjeto(payload)) throw new Error(`${caminho}: payload deve ser objeto JSON`);
  return payload;
}

/** Campo obrigatório: ausente é erro, como no índice original. */
function exigir(payload: ObjetoJson, campo: string, origem: string): unknown {
  if (!Object.hasOwn(payload, campo)) throw new Error(`${origem}: campo obrigatório ausente: ${campo}`);
  return payload[campo];
}

/** Campo com valor padrão só quando ausente (presente e nulo continua nulo). */
function obter(payload: ObjetoJson, campo: string, padrao: unknown): unknown {
  return Object.hasOwn(payload, campo) ? payload[campo] : padrao;
}

function lista(valor: unknown): unknown[] {
  return itensPercorridos(valor);
}

/** Nome do arquivo sem a última extensão. */
function semExtensao(caminho: string): string {
  return NodePath.basename(caminho, NodePath.extname(caminho));
}

function relativo(caminhos: CaminhosAnalise, caminho: string): string {
  return NodePath.relative(caminhos.baseAnaliseDir, caminho).split(NodePath.sep).join("/");
}

function itemFicha(caminhos: CaminhosAnalise, arquivo: string, universo: UniversoReferencias): Item {
  const payload = lerObjeto(arquivo);
  return {
    categoria: "ficha",
    id: exigir(payload, "id", arquivo),
    titulo: exigir(payload, "titulo", arquivo),
    dominio: obter(payload, "dominio", ""),
    criticidade: exigir(payload, "criticidade", arquivo),
    execucao: exigir(payload, "execucao", arquivo),
    verificador: VERIFICADOR_POR_FICHA.get(textoOuVazio(payload.id))?.id ?? null,
    topicos_tematicos: lista(payload.topicos_tematicos),
    tipo_escopo: textoOuVazio(payload.tipo_escopo),
    ancoras_semanticas: lista(payload.ancoras_semanticas),
    referencias_normativas: referenciasLegiveisDaFicha(payload, universo).map((referencia) => referencia.texto),
    normas_citadas: normasCitadas(payload),
    arquivo: relativo(caminhos, arquivo),
  };
}

function carregarTopicos(caminhos: CaminhosAnalise): ObjetoJson[] {
  if (!NodeFS.existsSync(caminhos.topicosFichasPath)) return [];
  const payload = lerJson(caminhos.topicosFichasPath);
  const topicos = ehObjeto(payload) ? obter(payload, "topicos", []) : [];
  return itensDe(topicos).filter(ehObjeto);
}

function itemTopico(caminhos: CaminhosAnalise, topico: ObjetoJson): Item {
  const origem = caminhos.topicosFichasPath;
  return {
    categoria: "topico_fichas",
    id: textoDe(exigir(topico, "id", origem)),
    titulo: textoDe(exigir(topico, "titulo", origem)),
    grupo: textoOuVazio(topico.grupo),
    tipo_escopo: textoOuVazio(topico.tipo_escopo),
    aliases_titulo: lista(topico.aliases_titulo),
    termos_busca: lista(topico.termos_busca),
    fichas: lista(topico.fichas),
    arquivo: relativo(caminhos, origem),
  };
}

function itemValidacaoCruzada(caminhos: CaminhosAnalise, arquivo: string): Item {
  const payload = lerObjeto(arquivo);
  return {
    categoria: "validacao_cruzada",
    id: exigir(payload, "id", arquivo),
    titulo: exigir(payload, "titulo", arquivo),
    dominio: obter(payload, "dominio", "validacao_cruzada"),
    criticidade: exigir(payload, "criticidade", arquivo),
    tipo: exigir(payload, "tipo", arquivo),
    secoes: obter(payload, "secoes_relacionadas", []),
    arquivo: relativo(caminhos, arquivo),
  };
}

function itemContrato(caminhos: CaminhosAnalise, arquivo: string): Item {
  const payload = lerObjeto(arquivo);
  const id = semExtensao(arquivo);
  return {
    categoria: "contrato",
    id,
    titulo: NodePath.basename(arquivo),
    tipo_contrato: id.endsWith(".exemplo") ? id.slice(0, -".exemplo".length) : id,
    campos_raiz: ordenarTextos(Object.keys(payload)),
    arquivo: relativo(caminhos, arquivo),
  };
}

function itemSchema(caminhos: CaminhosAnalise, arquivo: string): Item {
  const payload = lerObjeto(arquivo);
  return {
    categoria: "schema",
    id: semExtensao(arquivo),
    titulo: textoOuVazio(payload.title) || NodePath.basename(arquivo),
    schema_id: textoOuVazio(payload.$id),
    arquivo: relativo(caminhos, arquivo),
  };
}

function itensMarcosNormativos(caminhos: CaminhosAnalise, universo: UniversoReferencias): Item[] {
  const origem = caminhos.marcosNormativosPath;
  if (!NodeFS.existsSync(origem)) return [];
  // Vigente e substituídas são derivados de base-conhecimento/relacoes.yaml (fase 5).
  return carregarMarcos(origem).map((marco) => {
    const legivel = marcoLegivel(marco, universo);
    return {
      categoria: "marco_normativo",
      id: textoDe(obter(marco, "id", "")),
      titulo: textoDe(obter(marco, "tema", "")),
      vigente: textoDe(obter(legivel, "vigente", "")),
      vigente_id: textoDe(obter(marco, "vigente", "")),
      substitui: lista(legivel.substitui),
      substitui_ids: lista(marco.substitui),
      arquivo: relativo(caminhos, origem),
    };
  });
}

/** Monta o índice; `geradoEm` fixa a data (por padrão, agora em UTC). */
export function gerarIndice(geradoEm?: string, caminhos: CaminhosAnalise = caminhosPadrao()): ObjetoJson {
  const base = caminhos.baseAnaliseDir;
  const universo = universoOuVazio(caminhos);
  const fichas = listarArquivos(NodePath.join(base, "fichas"), ".json").map((arquivo) =>
    itemFicha(caminhos, arquivo, universo),
  );
  const validacoes = listarArquivos(NodePath.join(base, "validacoes-cruzadas"), ".json").map((arquivo) =>
    itemValidacaoCruzada(caminhos, arquivo),
  );
  const contratos = listarArquivos(NodePath.join(base, "contratos"), ".json").map((arquivo) =>
    itemContrato(caminhos, arquivo),
  );
  const schemas = listarArquivos(NodePath.join(base, "schemas"), ".schema.json").map((arquivo) =>
    itemSchema(caminhos, arquivo),
  );
  const topicos = carregarTopicos(caminhos).map((topico) => itemTopico(caminhos, topico));
  const marcos = itensMarcosNormativos(caminhos, universo);
  const itens = [...fichas, ...validacoes, ...topicos, ...marcos, ...contratos, ...schemas];
  return {
    base_analise_dir: "revisar-ppc/base-analise",
    gerado_em: geradoEm || agoraUtc(),
    resumo: {
      total_fichas: fichas.length,
      fichas_por_execucao: Object.fromEntries(
        MODOS_EXECUCAO.map((modo) => [
          modo,
          fichas.filter((item) => ehObjeto(item.execucao) && item.execucao.modo === modo).length,
        ]),
      ),
      total_validacoes_cruzadas: validacoes.length,
      total_topicos_fichas: topicos.length,
      total_marcos_normativos: marcos.length,
      total_contratos: contratos.length,
      total_schemas: schemas.length,
      total_itens: itens.length,
    },
    itens,
  };
}

/** Grava `indice.json` e devolve o índice gravado. */
export function escreverIndice(caminhos: CaminhosAnalise = caminhosPadrao(), geradoEm?: string): ObjetoJson {
  const indice = gerarIndice(geradoEm, caminhos);
  escreverTexto(caminhos.indicePath, jsonIndentado(indice));
  return indice;
}

/** Se `indice.json` existe e equivale ao índice gerado agora com o mesmo `gerado_em`. */
export function indiceAtualizado(caminhos: CaminhosAnalise = caminhosPadrao()): boolean {
  if (!NodeFS.existsSync(caminhos.indicePath)) return false;
  const atual = lerJson(caminhos.indicePath);
  const geradoEm = ehObjeto(atual) ? textoDe(obter(atual, "gerado_em", "")) : "";
  // O JSON gravado não tem as chaves `undefined` do objeto gerado; compara os dois como JSON.
  return NodeUtil.isDeepStrictEqual(atual, JSON.parse(JSON.stringify(gerarIndice(geradoEm, caminhos))));
}
