/**
 * Validação da base de análise da skill: schemas, fichas, taxonomia de
 * tópicos, marcos normativos, validações cruzadas e contratos de exemplo.
 *
 * As mensagens são as mesmas do antigo `validar_base_analise.py`, conferidas
 * por teste diferencial sobre a base e sobre casos inválidos.
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
import {
  chaveEstruturada,
  type NormaManifesto,
  normaDaReferencia,
  normalizarReferencia,
  textoDaChave,
} from "@simplifica-if/kb/normas/referencias";
import { aparar, ordenarTextos } from "@simplifica-if/kb/texto";
import { lerJson, listarArquivos } from "./arquivos.ts";
import { type CaminhosAnalise, caminhosPadrao } from "./caminhos.ts";
import { validarSchemaAnalise } from "./schema-analise.ts";

export type Ficha = ObjetoJson;
export type Marco = ObjetoJson;

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

/** Normas do `manifest.json` da base de conhecimento; ausente ou fora do formato dá lista vazia. */
export function carregarManifestNormas(caminho: string = caminhosPadrao().manifestNormasPath): NormaManifesto[] {
  if (!existsSync(caminho)) return [];
  const payload = lerJson(caminho);
  return Array.isArray(payload) ? payload.filter(ehObjeto) : [];
}

/** Marcos de `marcos-normativos.json`; ausente, inválido ou fora do formato dá lista vazia. */
export function carregarMarcos(caminho: string = caminhosPadrao().marcosNormativosPath): Marco[] {
  if (!existsSync(caminho)) return [];
  const lido = tentarLerJson(caminho);
  if ("erro" in lido) return [];
  const marcos = ehObjeto(lido.valor) ? lido.valor.marcos : undefined;
  return Array.isArray(marcos) ? marcos.filter(ehObjeto) : [];
}

/**
 * Barra em `referencias_normativas` norma revogada no manifesto, norma
 * substituída por um marco e dispositivo revogado.
 */
export function validarReferenciasVigentes(
  fichasPorId: Map<string, Ficha>,
  manifest: readonly NormaManifesto[],
  marcos: readonly Marco[] = [],
): string[] {
  const substituidas = new Map<string, { texto: string; marcoId: string }>();
  const dispositivos = new Map<string, string>();
  for (const marco of marcos) {
    for (const texto of [...itensPercorridos(marco.substitui), ...itensPercorridos(marco.antecessoras_historicas)]) {
      const chave = chaveEstruturada(textoDe(texto));
      if (chave) substituidas.set(textoDaChave(chave), { texto: textoDe(texto), marcoId: textoDe(marco.id) });
    }
  }
  for (const marco of marcos) {
    for (const texto of itensPercorridos(marco.dispositivos_revogados)) {
      dispositivos.set(normalizarReferencia(textoDe(texto)), textoDe(marco.id));
    }
  }

  const erros: string[] = [];
  for (const fichaId of ordenarTextos(fichasPorId.keys())) {
    const ficha = fichasPorId.get(fichaId)!;
    for (const valor of itensPercorridos(ficha.referencias_normativas)) {
      const referencia = textoDe(valor);
      const normalizada = normalizarReferencia(referencia);
      const norma = normaDaReferencia(referencia, manifest);
      const chave = chaveEstruturada(referencia);
      const substituida = chave ? substituidas.get(textoDaChave(chave)) : undefined;
      if (norma && norma.status_vigencia === "revogada") {
        erros.push(
          `${fichaId}: \`referencias_normativas\` cita norma revogada: ${referencia} ` +
            `(veja \`revogada_por\` em base-conhecimento/${norma.path === undefined ? "" : textoDe(norma.path)}; ` +
            "atualize a ficha e base-analise/marcos-normativos.json)",
        );
      } else if (substituida) {
        erros.push(
          `${fichaId}: \`referencias_normativas\` cita norma substituída no marco ${substituida.marcoId}: ` +
            `${referencia} (${substituida.texto})`,
        );
      }
      for (const [dispositivo, marcoId] of dispositivos) {
        if (normalizada.startsWith(dispositivo)) {
          erros.push(
            `${fichaId}: \`referencias_normativas\` cita dispositivo revogado (marco ${marcoId}): ${referencia}`,
          );
        }
      }
    }
  }
  return erros;
}

/** Confere `marcos-normativos.json`: schema, ids únicos, vigência no manifesto e fichas citadas. */
export function validarMarcosNormativos(
  manifest: readonly NormaManifesto[],
  caminho: string = caminhosPadrao().marcosNormativosPath,
  fichasPorId?: Map<string, Ficha>,
  schema: ObjetoJson = carregarSchema(caminhosPadrao(), "marcos-normativos.schema.json"),
): string[] {
  if (!existsSync(caminho)) return [`${caminho}: registro de marcos normativos não encontrado`];
  const lido = tentarLerJson(caminho);
  if ("erro" in lido) return [`${caminho}: JSON inválido: ${lido.erro}`];
  const erros = validarSchemaAnalise(lido.valor, schema).map((erro) => `${caminho}: ${erro}`);
  if (erros.length) return erros;

  const ids = new Set<string>();
  for (const marco of itensDe((lido.valor as ObjetoJson).marcos) as Marco[]) {
    const marcoId = textoDe(marco.id);
    if (ids.has(marcoId)) erros.push(`${caminho}: marco duplicado: ${marcoId}`);
    ids.add(marcoId);
    const vigente = textoDe(marco.vigente);
    const normaVigente = normaDaReferencia(vigente, manifest);
    if (normaVigente === null) {
      erros.push(`${caminho}: marco ${marcoId}: norma vigente fora do manifesto da base: ${vigente}`);
    } else if (normaVigente.status_vigencia === "revogada") {
      erros.push(`${caminho}: marco ${marcoId}: norma marcada como vigente está revogada no manifesto: ${vigente}`);
    }
    for (const substituida of itensDe(marco.substitui)) {
      const norma = normaDaReferencia(textoDe(substituida), manifest);
      if (norma && norma.status_vigencia === "vigente") {
        erros.push(
          `${caminho}: marco ${marcoId}: norma listada como substituída está vigente no manifesto: ${textoDe(substituida)}`,
        );
      }
    }
    if (fichasPorId !== undefined) {
      for (const campo of ["fichas_responsaveis", "fichas_base_legal"]) {
        for (const fichaId of itensDe(marco[campo])) {
          if (typeof fichaId !== "string" || !fichasPorId.has(fichaId)) {
            erros.push(`${caminho}: marco ${marcoId}: \`${campo}\` cita ficha desconhecida: ${textoDe(fichaId)}`);
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
  const schemaFicha = carregarSchema(caminhos, "ficha.schema.json");
  const schemaValidacao = carregarSchema(caminhos, "validacao-cruzada.schema.json");
  const schemaResultado = carregarSchema(caminhos, "resultado-lote.schema.json");
  const schemaAlertas = carregarSchema(caminhos, "alertas-transversais.schema.json");
  const schemaMarcos = carregarSchema(caminhos, "marcos-normativos.schema.json");

  for (const arquivo of listarArquivos(caminhos.schemasDir, ".schema.json")) {
    const payload = lerJson(arquivo);
    if (!ehObjeto(payload) || payload.type !== "object") {
      erros.push(`${arquivo}: schema deve ser objeto com type=object`);
    }
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

  const manifest = carregarManifestNormas(caminhos.manifestNormasPath);
  if (manifest.length === 0) {
    erros.push(
      `${caminhos.manifestNormasPath}: manifesto de normas não encontrado; checagem de vigência não executada`,
    );
  } else {
    erros.push(...validarReferenciasVigentes(fichasPorId, manifest, carregarMarcos(caminhos.marcosNormativosPath)));
    erros.push(...validarMarcosNormativos(manifest, caminhos.marcosNormativosPath, fichasPorId, schemaMarcos));
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
