/**
 * Validação da base de análise da skill: schemas, fichas, taxonomia de
 * tópicos, marcos normativos, validações cruzadas e contratos de exemplo.
 *
 * As mensagens de schema seguem as do antigo `validar_base_analise.py`. As referências normativas
 * das fichas e os marcos são conferidos por ID canônico (fase 2b do plano de arquitetura), contra
 * `manifest.json`, `normas/stubs.yaml` e o CNCT.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import {
  ehObjeto,
  itensDe,
  itensPercorridos,
  type ObjetoJson,
  representar,
  textoDe,
  textoOuVazio,
} from "@simplifica-if/kb/json";
import { lerTopicosSecoes } from "@simplifica-if/kb/db/pacote-contexto";
import { ehIdDispositivo, RE_REFERENCIA } from "@simplifica-if/kb/normas/ids";
import {
  type FonteReferencia,
  textoIdComDispositivo,
  type UniversoReferencias,
} from "@simplifica-if/kb/normas/referencia-estruturada";
import { aparar, ordenarTextos } from "@simplifica-if/kb/texto";
import { lerJson, listarArquivos } from "./arquivos.ts";
import { type CaminhosAnalise, caminhosPadrao } from "./caminhos.ts";
import { jsonSchemaGerado, type MarcoArquivo, schemasDesatualizados } from "./esquemas.ts";
import { type Derivacao, derivacaoPadrao, derivarMarco } from "./marcos.ts";
import { carregarUniverso } from "./referencias-fichas.ts";
import { validarSchemaAnalise } from "./schema-analise.ts";

export type Ficha = ObjetoJson;
export type Marco = ObjetoJson;

/** Marcos do arquivo com os campos derivados; marco cuja linha não deriva fica de fora. */
function marcosDerivados(marcos: readonly ObjetoJson[], derivar: Derivacao): Marco[] {
  const saida: Marco[] = [];
  for (const marco of marcos) {
    try {
      saida.push(derivarMarco(marco as unknown as MarcoArquivo, derivar) as unknown as Marco);
    } catch {
      // O erro é relatado por validarMarcosNormativos.
    }
  }
  return saida;
}

const TIPOS_ESCOPO_TOPICO = new Set(["tematico", "multitematico", "transversal", "condicional"]);

/** Resultado da leitura de um JSON: o valor ou a mensagem do erro de sintaxe. */
function tentarLerJson(caminho: string): { valor: unknown } | { erro: string } {
  try {
    return { valor: lerJson(caminho) };
  } catch (erro) {
    if (erro instanceof SyntaxError) return { erro: erro.message };
    throw erro;
  }
}

function carregarSchema(caminhos: CaminhosAnalise, nome: string): ObjetoJson {
  const payload = lerJson(path.join(caminhos.schemasDir, nome));
  if (!ehObjeto(payload)) throw new Error(`Schema inválido: ${nome}`);
  return payload;
}

function validarArquivoJson(caminho: string, schema: ObjetoJson): string[] {
  const lido = tentarLerJson(caminho);
  if ("erro" in lido) return [`${caminho}: JSON inválido: ${lido.erro}`];
  return validarSchemaAnalise(lido.valor, schema).map((erro) => `${caminho}: ${erro}`);
}

function textoAparado(valor: unknown): string {
  return aparar(textoOuVazio(valor));
}

function conjuntoOrdenado(valores: Iterable<string>): string {
  return representar(ordenarTextos(new Set(valores)));
}

/**
 * Confere o mapa tópico → tipos de seção do kb (`packages/kb/dados/topicos-secoes.yaml`), que decide
 * as seções do PPC de cada grupo de sub-agente: todo tópico da taxonomia tem uma entrada (lista vazia
 * vale) e toda entrada é um tópico. Sem o arquivo (skill fora do repositório), não confere.
 */
export function validarTopicosSecoes(idsTopicos: ReadonlySet<string>, caminhos: CaminhosAnalise): string[] {
  const arquivo = path.join(
    path.dirname(caminhos.baseConhecimentoDir),
    "packages",
    "kb",
    "dados",
    "topicos-secoes.yaml",
  );
  if (!existsSync(arquivo)) return [];
  let mapa: Record<string, string[]>;
  try {
    mapa = lerTopicosSecoes(arquivo);
  } catch (erro) {
    return [`${arquivo}: inválido: ${erro instanceof Error ? erro.message : String(erro)}`];
  }
  const erros: string[] = [];
  for (const id of ordenarTextos([...idsTopicos].filter((id) => !Object.hasOwn(mapa, id)))) {
    erros.push(`${arquivo}: tópico sem tipos de seção: ${id}`);
  }
  for (const id of ordenarTextos(Object.keys(mapa).filter((id) => !idsTopicos.has(id)))) {
    erros.push(`${arquivo}: tópico desconhecido: ${id}`);
  }
  return erros;
}

/** Confere `topicos-fichas.json` contra as fichas e os `topicos_tematicos` de cada ficha. */
export function validarTopicosFichas(
  fichasPorId: Map<string, Ficha>,
  caminhos: CaminhosAnalise = caminhosPadrao(),
): string[] {
  const arquivo = caminhos.topicosFichasPath;
  if (!existsSync(arquivo)) return [`${arquivo}: arquivo de taxonomia não encontrado`];
  const lido = tentarLerJson(arquivo);
  if ("erro" in lido) return [`${arquivo}: JSON inválido: ${lido.erro}`];
  if (!ehObjeto(lido.valor)) return [`${arquivo}: payload deve ser objeto JSON`];
  const topicos = lido.valor.topicos;
  if (!Array.isArray(topicos) || topicos.length === 0) {
    return [`${arquivo}: campo \`topicos\` deve ser lista não vazia`];
  }

  const erros: string[] = [];
  const idsTopicos = new Set<string>();
  const fichasCobertas = new Set<string>();
  topicos.forEach((topico, posicao) => {
    const indice = posicao + 1;
    if (!ehObjeto(topico)) {
      erros.push(`${arquivo}: tópico ${indice} deve ser objeto JSON`);
      return;
    }
    const topicoId = textoAparado(topico.id);
    const rotulo = topicoId || String(indice);
    if (!topicoId) erros.push(`${arquivo}: tópico ${indice} sem id`);
    else if (idsTopicos.has(topicoId)) erros.push(`${arquivo}: tópico duplicado: ${topicoId}`);
    idsTopicos.add(topicoId);
    for (const campo of ["titulo", "descricao", "tipo_escopo"]) {
      if (!textoAparado(topico[campo])) erros.push(`${arquivo}: tópico ${rotulo} sem \`${campo}\``);
    }
    const tipoEscopo = textoOuVazio(topico.tipo_escopo);
    if (tipoEscopo && !TIPOS_ESCOPO_TOPICO.has(tipoEscopo)) {
      erros.push(`${arquivo}: tópico ${rotulo} tem tipo_escopo inválido: ${tipoEscopo}`);
    }
    for (const campo of ["aliases_titulo", "termos_busca", "fichas"]) {
      const valores = topico[campo];
      if (!Array.isArray(valores)) {
        erros.push(`${arquivo}: tópico ${rotulo} deve ter \`${campo}\` como lista`);
        continue;
      }
      if ((campo === "aliases_titulo" || campo === "termos_busca") && valores.length === 0) {
        erros.push(`${arquivo}: tópico ${rotulo} deve ter \`${campo}\` não vazio`);
      }
      if (campo === "fichas") {
        if (valores.length === 0) erros.push(`${arquivo}: tópico ${rotulo} deve citar ao menos uma ficha`);
        for (const valor of valores) {
          const fichaId = textoDe(valor);
          if (!fichasPorId.has(fichaId)) erros.push(`${arquivo}: tópico ${rotulo} cita ficha desconhecida: ${fichaId}`);
          fichasCobertas.add(fichaId);
        }
      }
    }
  });

  const faltantes = ordenarTextos([...fichasPorId.keys()].filter((fichaId) => !fichasCobertas.has(fichaId)));
  if (faltantes.length) erros.push(`${arquivo}: fichas sem tópico temático: ${faltantes.join(", ")}`);
  erros.push(...validarTopicosSecoes(idsTopicos, caminhos));

  for (const fichaId of ordenarTextos(fichasPorId.keys())) {
    const ficha = fichasPorId.get(fichaId)!;
    const topicosFicha = ficha.topicos_tematicos;
    if (Object.hasOwn(ficha, "secoes_preferenciais")) {
      erros.push(`${fichaId}: campo legado \`secoes_preferenciais\` não é aceito`);
    }
    if (!Array.isArray(topicosFicha) || topicosFicha.length === 0) {
      erros.push(`${fichaId}: \`topicos_tematicos\` deve ser lista não vazia`);
      continue;
    }
    const declarados = new Set(topicosFicha.map((valor) => textoDe(valor)));
    const desconhecidos = ordenarTextos([...declarados].filter((valor) => !idsTopicos.has(valor)));
    if (desconhecidos.length) erros.push(`${fichaId}: tópicos desconhecidos: ${desconhecidos.join(", ")}`);
    const esperados = new Set(
      topicos
        .filter(
          (topico) => ehObjeto(topico) && itensPercorridos(topico.fichas).some((valor) => textoDe(valor) === fichaId),
        )
        .map((topico) => textoDe((topico as ObjetoJson).id)),
    );
    const iguais = declarados.size === esperados.size && [...declarados].every((valor) => esperados.has(valor));
    if (!iguais) {
      erros.push(
        `${fichaId}: topicos_tematicos divergente da taxonomia ` +
          `(ficha=${conjuntoOrdenado(declarados)}, taxonomia=${conjuntoOrdenado(esperados)})`,
      );
    }
    const ancoras = ficha.ancoras_semanticas;
    if (!Array.isArray(ancoras) || !ancoras.some((valor) => aparar(textoDe(valor)))) {
      erros.push(`${fichaId}: \`ancoras_semanticas\` deve ser lista não vazia`);
    }
  }
  return erros;
}

/**
 * Marcos de `marcos-normativos.json` com os campos derivados de `relacoes.yaml` (vigente,
 * substitui, antecessoras_historicas, dispositivos_revogados); ausente, inválido ou fora do
 * formato dá lista vazia.
 */
export function carregarMarcos(
  caminho: string = caminhosPadrao().marcosNormativosPath,
  derivar: Derivacao = derivacaoPadrao(),
): Marco[] {
  if (!existsSync(caminho)) return [];
  const lido = tentarLerJson(caminho);
  if ("erro" in lido) return [];
  const marcos = ehObjeto(lido.valor) ? lido.valor.marcos : undefined;
  return Array.isArray(marcos) ? marcosDerivados(marcos.filter(ehObjeto), derivar) : [];
}

/** `br/cne-ceb/res/2025/3#art6-iii` → ato e dispositivo. */
function separarDispositivo(id: string): { ref: string; dispositivo: string | undefined } {
  const posicao = id.indexOf("#");
  return posicao === -1
    ? { ref: id, dispositivo: undefined }
    : { ref: id.slice(0, posicao), dispositivo: id.slice(posicao) };
}

/** Texto legível de um ID com dispositivo opcional; o próprio ID se o dispositivo for malformado. */
function legivel(universo: UniversoReferencias, ref: string, dispositivo?: string): string {
  if (dispositivo !== undefined && !ehIdDispositivo(dispositivo)) return `${ref}${dispositivo}`;
  return textoIdComDispositivo(`${ref}${dispositivo ?? ""}`, universo);
}

/** Onde conferir a revogação: `revogada_por` no Markdown da norma ou `status_fonte` do stub. */
function origemRevogacao(fonte: FonteReferencia): string {
  if (fonte.path !== undefined) return `veja \`revogada_por\` em base-conhecimento/${fonte.path}`;
  return `veja \`status_fonte\` (${fonte.status_fonte ?? "?"}) em base-conhecimento/normas/stubs.yaml`;
}

/**
 * Confere por ID as `referencias_normativas` das fichas: ID inexistente na base, norma revogada
 * (manifesto ou stub), norma substituída por um marco, dispositivo revogado (o próprio ou um
 * dispositivo dentro dele) e referência repetida. O formato de `ref` e `dispositivo` é do schema.
 */
export function validarReferenciasFichas(
  fichasPorId: Map<string, Ficha>,
  universo: UniversoReferencias,
  marcos: readonly Marco[] = [],
): string[] {
  const substituidas = new Map<string, string>();
  const dispositivos = new Map<string, string>();
  for (const marco of marcos) {
    for (const id of [...itensPercorridos(marco.substitui), ...itensPercorridos(marco.antecessoras_historicas)]) {
      substituidas.set(textoDe(id), textoDe(marco.id));
    }
  }
  for (const marco of marcos) {
    for (const id of itensPercorridos(marco.dispositivos_revogados)) dispositivos.set(textoDe(id), textoDe(marco.id));
  }

  const erros: string[] = [];
  for (const fichaId of ordenarTextos(fichasPorId.keys())) {
    const vistas = new Set<string>();
    itensPercorridos(fichasPorId.get(fichaId)!.referencias_normativas).forEach((item, indice) => {
      // Fora do formato, o erro é do schema; aqui só se confere o que é ID bem formado.
      if (!ehObjeto(item) || typeof item.ref !== "string" || !RE_REFERENCIA.test(item.ref)) return;
      if (
        item.dispositivo !== undefined &&
        !(typeof item.dispositivo === "string" && ehIdDispositivo(item.dispositivo))
      ) {
        return;
      }
      const ref = item.ref;
      const dispositivo = item.dispositivo as string | undefined;
      const campo = `${fichaId}: \`referencias_normativas[${indice}]\``;
      const fonte = universo.fonte(ref);
      if (fonte === undefined) {
        erros.push(
          `${campo} cita ID inexistente na base: ${ref} ` +
            "(registre a norma em base-conhecimento/manifest.json ou em base-conhecimento/normas/stubs.yaml)",
        );
        return;
      }
      const texto = legivel(universo, ref, dispositivo);
      const chave = `${ref}${dispositivo ?? ""}`;
      if (vistas.has(chave)) erros.push(`${campo} repete a referência: ${texto}`);
      vistas.add(chave);
      const marcoSubstituta = substituidas.get(ref);
      if (fonte.status_vigencia === "revogada") {
        erros.push(
          `${campo} cita norma revogada: ${texto} (${ref}; ${origemRevogacao(fonte)}; ` +
            "atualize a ficha e base-analise/marcos-normativos.json)",
        );
      } else if (marcoSubstituta !== undefined) {
        erros.push(`${campo} cita norma substituída no marco ${marcoSubstituta}: ${texto} (${ref})`);
      }
      if (dispositivo === undefined) return;
      for (const [revogado, marcoId] of dispositivos) {
        const alvo = separarDispositivo(revogado);
        if (
          alvo.ref === ref &&
          alvo.dispositivo !== undefined &&
          (dispositivo === alvo.dispositivo || dispositivo.startsWith(`${alvo.dispositivo}-`))
        ) {
          erros.push(`${campo} cita dispositivo revogado (marco ${marcoId}): ${texto}`);
        }
      }
    });
  }
  return erros;
}

/**
 * Confere `marcos-normativos.json`: schema (gerado do zod), ids únicos, atos da linha registrados,
 * linha que deriva um único ato vigente com texto na base e não revogado, normas substituídas e
 * dispositivos revogados existentes e fichas citadas. Os campos conferidos depois do schema são os
 * derivados de `relacoes.yaml` (`derivar`).
 */
export function validarMarcosNormativos(
  universo: UniversoReferencias,
  caminho: string = caminhosPadrao().marcosNormativosPath,
  fichasPorId?: Map<string, Ficha>,
  derivar: Derivacao = derivacaoPadrao(),
): string[] {
  if (!existsSync(caminho)) return [`${caminho}: registro de marcos normativos não encontrado`];
  const lido = tentarLerJson(caminho);
  if ("erro" in lido) return [`${caminho}: JSON inválido: ${lido.erro}`];
  const erros = validarSchemaAnalise(lido.valor, jsonSchemaGerado("marcos-normativos.schema.json")).map(
    (erro) => `${caminho}: ${erro}`,
  );
  if (erros.length) return erros;

  const ids = new Set<string>();
  for (const arquivo of itensDe((lido.valor as ObjetoJson).marcos) as unknown as MarcoArquivo[]) {
    const marcoId = textoDe(arquivo.id);
    const prefixo = `${caminho}: marco ${marcoId}:`;
    if (ids.has(marcoId)) erros.push(`${caminho}: marco duplicado: ${marcoId}`);
    ids.add(marcoId);
    for (const ato of arquivo.linha) {
      if (universo.fonte(ato) === undefined) erros.push(`${prefixo} \`linha\` cita ID inexistente na base: ${ato}`);
    }
    let marco: Marco;
    try {
      marco = derivarMarco(arquivo, derivar) as unknown as Marco;
    } catch (erro) {
      erros.push(`${prefixo} ${(erro as Error).message}`);
      continue;
    }
    const vigente = textoDe(marco.vigente);
    const fonteVigente = universo.fonte(vigente);
    if (fonteVigente === undefined || fonteVigente.situacao !== "base") {
      erros.push(`${prefixo} norma vigente fora do manifesto da base: ${legivel(universo, vigente)} (${vigente})`);
    } else if (fonteVigente.status_vigencia === "revogada") {
      erros.push(
        `${prefixo} norma marcada como vigente está revogada no manifesto: ${legivel(universo, vigente)} (${vigente})`,
      );
    }
    for (const campo of ["substitui", "antecessoras_historicas", "dispositivos_revogados"]) {
      for (const valor of itensDe(marco[campo])) {
        const { ref, dispositivo } = separarDispositivo(textoDe(valor));
        const fonte = universo.fonte(ref);
        if (fonte === undefined) {
          erros.push(`${prefixo} \`${campo}\` cita ID inexistente na base: ${ref}`);
        } else if (campo === "substitui" && fonte.status_vigencia === "vigente") {
          erros.push(
            `${prefixo} norma listada como substituída está vigente na base: ` +
              `${legivel(universo, ref, dispositivo)} (${ref})`,
          );
        }
      }
    }
    if (fichasPorId !== undefined) {
      for (const campo of ["fichas_responsaveis", "fichas_base_legal"]) {
        for (const fichaId of itensDe(marco[campo])) {
          if (typeof fichaId !== "string" || !fichasPorId.has(fichaId)) {
            erros.push(`${prefixo} \`${campo}\` cita ficha desconhecida: ${textoDe(fichaId)}`);
          }
        }
      }
    }
  }
  return erros;
}

/** Fichas de `fichas/` por id (na ordem dos arquivos; ids repetidos ficam com a última). */
export function carregarFichas(caminhos: CaminhosAnalise = caminhosPadrao()): Map<string, Ficha> {
  const fichas = new Map<string, Ficha>();
  for (const arquivo of listarArquivos(caminhos.fichasDir, ".json")) {
    const payload = lerJson(arquivo);
    if (ehObjeto(payload)) fichas.set(textoOuVazio(payload.id), payload);
  }
  return fichas;
}

const ALERTA_EXEMPLO = {
  alertas_transversais: [
    {
      id: "ALERTA-001",
      validacao_id: "VC-EXEMPLO",
      titulo: "Alerta transversal",
      criticidade: "OBRIG",
      descricao: "Descrição objetiva.",
      fichas_relacionadas: ["CT-IDENT-01"],
      evidencias: ["Evidência textual."],
      revisao_humana_obrigatoria: true,
    },
  ],
};

/** Valida a base de análise inteira e devolve as mensagens de erro (lista vazia quando válida). */
export function validarBaseAnalise(caminhos: CaminhosAnalise = caminhosPadrao()): string[] {
  const erros: string[] = [];
  const schemaFicha = jsonSchemaGerado("ficha.schema.json");
  const schemaValidacao = carregarSchema(caminhos, "validacao-cruzada.schema.json");
  const schemaResultado = carregarSchema(caminhos, "resultado-lote.schema.json");
  const schemaAlertas = carregarSchema(caminhos, "alertas-transversais.schema.json");

  for (const arquivo of listarArquivos(caminhos.schemasDir, ".schema.json")) {
    const payload = lerJson(arquivo);
    if (!ehObjeto(payload) || payload.type !== "object") {
      erros.push(`${arquivo}: schema deve ser objeto com type=object`);
    }
  }
  for (const arquivo of schemasDesatualizados(caminhos)) {
    erros.push(`${arquivo}: diverge do schema zod de scripts/esquemas.ts; rode \`revisar_ppc.ts gerar-schemas\``);
  }

  const fichasPorId = new Map<string, Ficha>();
  for (const arquivo of listarArquivos(caminhos.fichasDir, ".json")) {
    const lido = tentarLerJson(arquivo);
    if ("erro" in lido) {
      erros.push(`${arquivo}: JSON inválido: ${lido.erro}`);
      continue;
    }
    erros.push(...validarSchemaAnalise(lido.valor, schemaFicha).map((erro) => `${arquivo}: ${erro}`));
    const payload = ehObjeto(lido.valor) ? lido.valor : {};
    const fichaId = textoOuVazio(payload.id);
    if (fichasPorId.has(fichaId)) erros.push(`${arquivo}: ficha duplicada: ${fichaId}`);
    fichasPorId.set(fichaId, payload);
  }
  erros.push(...validarTopicosFichas(fichasPorId, caminhos));

  const universo = carregarUniverso(caminhos);
  if (universo === null) {
    erros.push(
      `${caminhos.manifestNormasPath}: manifesto de normas não encontrado; checagem de vigência não executada`,
    );
  } else {
    erros.push(...validarReferenciasFichas(fichasPorId, universo, carregarMarcos(caminhos.marcosNormativosPath)));
    erros.push(...validarMarcosNormativos(universo, caminhos.marcosNormativosPath, fichasPorId));
  }

  const idsValidacoes = new Set<string>();
  for (const arquivo of listarArquivos(caminhos.validacoesCruzadasDir, ".json")) {
    const lido = tentarLerJson(arquivo);
    if ("erro" in lido) {
      erros.push(`${arquivo}: JSON inválido: ${lido.erro}`);
      continue;
    }
    erros.push(...validarSchemaAnalise(lido.valor, schemaValidacao).map((erro) => `${arquivo}: ${erro}`));
    const validacaoId = textoOuVazio(ehObjeto(lido.valor) ? lido.valor.id : undefined);
    if (idsValidacoes.has(validacaoId)) erros.push(`${arquivo}: validação cruzada duplicada: ${validacaoId}`);
    idsValidacoes.add(validacaoId);
  }

  erros.push(...validarArquivoJson(path.join(caminhos.contratosDir, "resposta_lote.exemplo.json"), schemaResultado));
  erros.push(...validarSchemaAnalise(ALERTA_EXEMPLO, schemaAlertas));
  return erros;
}
