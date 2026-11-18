// @effect-diagnostics nodeBuiltinImport:off -- caminhos dos registros com node:path, em funções puras chamadas pelo pipeline da base
/**
 * Índice dos campi (`institucional/ifpr/campi/index.json`): lista os registros com o nome e o `path`
 * de cada arquivo (relativo a `base-conhecimento/`). A `revisar-ppc` o lê para reconhecer o campus
 * na identificação do PPC (`referencias-identificacao.ts`). As demais coleções não têm índice: o kb
 * lê os registros direto. Não tem data: muda só quando os registros mudam. Gerado por `gerar_base.ts`
 * e conferido por `validar_base.ts`.
 */
import * as NodePath from "node:path";
import type { ArquivoGerado } from "../base/gerados.ts";
import { compararTexto } from "../dominio/comum.ts";
import {
  ARQUIVO_INDICE,
  caminhosRegistro,
  RAIZ_DADOS_INSTITUCIONAIS,
  textoRegistro,
  type DadosInstitucionais,
} from "./institucional.ts";

/** Caminho publicado de um registro: `institucional/ifpr/<coleção>/...`, com `/` em qualquer sistema. */
const publicado = (relativo: string) => ["institucional", "ifpr", ...relativo.split(NodePath.sep)].join("/");

export function montarIndiceCampi(dados: DadosInstitucionais) {
  const items = dados.campi
    .map((c) => ({ id: c.campus_id, nome: c.nome, path: publicado(caminhosRegistro.campus(c)) }))
    .sort((a, b) => compararTexto(a.id, b.id));
  return {
    id: "campi-ifpr",
    title: "Campi do IFPR",
    descricao: "Campi e campi avançados do Instituto Federal do Paraná, um arquivo por campus.",
    tipo_item: "campus",
    total_itens: items.length,
    items,
  };
}

/** O `campi/index.json`, como `gerar_base` o grava e `validar_base` o confere. */
export function indiceCampiGerado(dados: DadosInstitucionais, raiz: string = RAIZ_DADOS_INSTITUCIONAIS): ArquivoGerado {
  return { caminho: NodePath.join(raiz, "campi", ARQUIVO_INDICE), texto: textoRegistro(montarIndiceCampi(dados)) };
}
