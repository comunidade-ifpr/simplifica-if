// @effect-diagnostics nodeBuiltinImport:off -- carregador síncrono de relacoes.yaml, usado pelos scripts e pela compilação do banco
/**
 * Relações entre normas (`base-conhecimento/relacoes.yaml`): `revoga`, `altera`, `regulamenta` e
 * `fundamenta-se-em`, com origem, dispositivo operador, alvo (ato ou dispositivo), efeito e a
 * evidência literal no texto da base.
 *
 * - `carregarRelacoes(raiz)`: lê e valida o contrato (Effect Schema) do arquivo;
 * - `validarRelacoes(raiz)`: confere IDs no registro (normas e stubs), operador e alvo_dispositivo
 *   no texto da base, evidência contida no dispositivo e status dos stubs atingidos;
 * - `camposRelacoesFrontMatter(...)`: os campos de relação que `gerar_base.ts` escreve no front
 *   matter de cada norma (o arquivo YAML é a fonte; o front matter é derivado);
 * - `proporRelacoes(raiz)`: regex sobre os dispositivos ("Ficam revogados", "Revogam-se",
 *   "passa a vigorar"...) que propõe arestas ainda não registradas nem descartadas. A proposta só
 *   entra no YAML depois de conferida no texto por uma pessoa (princípio 4 do plano).
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as NodeFS from "node:fs";
import { parse } from "yaml";
import { CAMINHOS, chaveDoCheckout, noCheckout } from "../caminhos.ts";
import { caminhoTexto, problemas } from "../esquema/mensagens.ts";
import {
  carregarDispositivos,
  carregarEstruturas,
  type Dispositivo,
  indiceDispositivos,
  listarNormas,
} from "./estrutura.ts";
import { analisarFrontMatter } from "./front-matter.ts";
import { ehIdNorma, ehIdDispositivo } from "./ids.ts";
import { palavrasDoTexto } from "./markdown.ts";
import { carregarRegistro, type Registro } from "./registro.ts";
import { extrairCitacoes } from "./resolver.ts";
import { textoDispositivos } from "./texto-dispositivos.ts";

const TIPOS_RELACAO = ["revoga", "altera", "regulamenta", "fundamenta-se-em"] as const;
export type TipoRelacao = (typeof TIPOS_RELACAO)[number];

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
/** Texto que satisfaz `predicado`, com a mensagem dada quando não satisfaz. */
const textoQue = (predicado: (valor: string) => boolean, mensagem: string) =>
  Schema.String.check(Schema.makeFilter((valor: string) => predicado(valor), { message: mensagem }));
const textoNaoVazio = Schema.String.check(Schema.isMinLength(1));
const idAto = textoQue(ehIdNorma, "ID de ato fora do formato canônico");
const dispositivo = textoQue(ehIdDispositivo, "dispositivo fora do formato (#art28-xvi)");

export const esquemaRelacao = Schema.Struct({
  tipo: Schema.Literals(TIPOS_RELACAO),
  origem: idAto,
  operador: Schema.optionalKey(dispositivo),
  alvo: idAto,
  alvo_dispositivo: Schema.optionalKey(dispositivo),
  alcance: Schema.optionalKey(textoNaoVazio),
  efeito_de: Schema.Union([Schema.Literal("vigencia-da-origem"), Schema.String.check(Schema.isPattern(RE_DATA))]).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("vigencia-da-origem")),
  ),
  evidencia: Schema.Struct({
    em: textoQue((valor) => {
      const [ato, disp] = valor.split("#");
      return ehIdNorma(ato!) && (disp === undefined || ehIdDispositivo(`#${disp}`));
    }, "evidencia.em deve ser ID de ato com dispositivo opcional"),
    trecho: textoNaoVazio,
  }),
  confirmado_em: Schema.String.check(Schema.isPattern(RE_DATA)),
  proposta: Schema.Literals(["front-matter", "regex", "manual"]),
  nota: Schema.optionalKey(Schema.String),
});
export type Relacao = typeof esquemaRelacao.Type;

export const esquemaDescartada = Schema.Struct({
  origem: idAto,
  operador: Schema.Union([dispositivo, Schema.Literal("*")]),
  motivo: textoNaoVazio,
});

export const esquemaRelacoes = Schema.Struct({
  relacoes: Schema.mutable(Schema.Array(esquemaRelacao)),
  descartadas: Schema.mutable(Schema.Array(esquemaDescartada)).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
});
export type ArquivoRelacoes = typeof esquemaRelacoes.Type;
const decodificarRelacoes = Schema.decodeUnknownSync(esquemaRelacoes, { onExcessProperty: "error", errors: "all" });

export function caminhoRelacoes(raiz: string): string {
  return noCheckout(raiz, CAMINHOS.relacoes);
}

/**
 * Contrato de `relacoes.yaml` sobre o texto do arquivo (YAML `failsafe`: todo escalar é texto).
 * Fora do contrato, lança o `Schema.SchemaError` (texto em português por `esquema/mensagens.ts`).
 */
export function arquivoRelacoesDoYaml(texto: string): ArquivoRelacoes {
  return decodificarRelacoes(parse(texto, { schema: "failsafe", uniqueKeys: true }));
}

/** Relações do texto de `relacoes.yaml`, na ordem do arquivo. */
export function relacoesDoYaml(texto: string): Relacao[] {
  return arquivoRelacoesDoYaml(texto).relacoes;
}

/** Por checkout (`chaveDoCheckout`); `validarRelacoes` o descarta para reler o arquivo. */
const cache = new Map<string, ArquivoRelacoes>();

/** Lê `relacoes.yaml` e aplica o contrato. */
export function carregarArquivoRelacoes(raiz: string): ArquivoRelacoes {
  const emCache = cache.get(chaveDoCheckout(raiz));
  if (emCache) return emCache;
  const arquivo = caminhoRelacoes(raiz);
  const dados = NodeFS.existsSync(arquivo)
    ? arquivoRelacoesDoYaml(NodeFS.readFileSync(arquivo, "utf-8"))
    : { relacoes: [], descartadas: [] };
  cache.set(chaveDoCheckout(raiz), dados);
  return dados;
}

/** Relações de `relacoes.yaml`, na ordem do arquivo. */
export function carregarRelacoes(raiz: string): Relacao[] {
  return carregarArquivoRelacoes(raiz).relacoes;
}

/** A relação atinge só parte do alvo (dispositivo ou alcance descrito)? */
export function relacaoParcial(relacao: Relacao): boolean {
  return relacao.alvo_dispositivo !== undefined || relacao.alcance !== undefined;
}

/** Atos que revogam `ato` no todo, na ordem das relações: as sucessoras de `kb impacto` e da ficha da norma. */
export function sucessorasDe(ato: string, relacoes: readonly Relacao[]): string[] {
  return relacoes.filter((r) => r.tipo === "revoga" && r.alvo === ato && !relacaoParcial(r)).map((r) => r.origem);
}

/** Relações que têm `id` (ato) como origem ou alvo. */
export function relacoesDe(id: string, raiz: string): { saida: Relacao[]; entrada: Relacao[] } {
  return relacoesDeEm(id, carregarRelacoes(raiz));
}

/** `relacoesDe` sobre uma lista de relações (a do arquivo, ou a do `kb.sqlite`: `relacoesBanco`). */
export function relacoesDeEm(id: string, relacoes: readonly Relacao[]): { saida: Relacao[]; entrada: Relacao[] } {
  const ato = id.split("#")[0]!;
  return {
    saida: relacoes.filter((relacao) => relacao.origem === ato),
    entrada: relacoes.filter((relacao) => relacao.alvo === ato),
  };
}

function palavrasNormalizadas(texto: string): string {
  return palavrasDoTexto(texto.replace(/[“”"]/g, '"')).join(" ");
}

/**
 * Texto em que a evidência deve estar: o do dispositivo ou, sem dispositivo, o do arquivo inteiro com
 * as `notas_da_fonte` do front matter (a nota de consolidação que registra uma alteração por norma
 * que a base não tem).
 */
function textoDaEvidencia(em: string, raiz: string, indice: Map<string, Dispositivo>): string | null {
  const [ato, disp] = em.split("#");
  if (disp) return indice.get(`${ato}#${disp}`)?.texto ?? null;
  const estrutura = carregarEstruturas(raiz).find((e) => e.id === ato);
  if (!estrutura) return null;
  const arquivo = listarNormas(raiz).find((norma) => norma.id === estrutura.id)?.arquivo;
  const notas = arquivo
    ? analisarFrontMatter(NodeFS.readFileSync(arquivo, "utf-8"), estrutura.path).meta["notas_da_fonte"]
    : [];
  const textos = [...estrutura.segmentos.map((s) => s.texto), ...(Array.isArray(notas) ? notas : [])];
  return palavrasDoTexto(textos.join("\n")).join(" ");
}

/**
 * Validação semântica de `relacoes.yaml`: IDs no registro, operador e alvo no texto, evidência
 * literal no texto indicado, unicidade e descartes. Devolve mensagens de erro.
 */
export function validarRelacoes(raiz: string, registro: Registro = carregarRegistro(raiz)): string[] {
  const erros: string[] = [];
  let arquivo: ArquivoRelacoes;
  try {
    cache.delete(chaveDoCheckout(raiz));
    arquivo = carregarArquivoRelacoes(raiz);
  } catch (erro) {
    if (Schema.isSchemaError(erro)) {
      return problemas(erro.issue).map((p) => `relacoes.yaml: ${caminhoTexto(p.caminho)}: ${p.mensagem}`);
    }
    return [`relacoes.yaml: ${(erro as Error).message.split("\n")[0]}`];
  }
  const indice = indiceDispositivos(raiz);
  const vistas = new Set<string>();
  arquivo.relacoes.forEach((relacao, i) => {
    const rotulo = `relacoes.yaml: relacoes.${i} (${relacao.tipo} ${relacao.origem} → ${relacao.alvo})`;
    const origem = registro.obter(relacao.origem);
    const alvo = registro.obter(relacao.alvo);
    if (!origem || origem.situacao === "externo") erros.push(`${rotulo}: origem fora da base e dos stubs`);
    if (!alvo || alvo.situacao === "externo") erros.push(`${rotulo}: alvo fora da base e dos stubs`);
    if (relacao.origem === relacao.alvo) erros.push(`${rotulo}: origem igual ao alvo`);
    if (origem?.situacao === "base") {
      if (!relacao.operador && relacao.tipo !== "fundamenta-se-em" && relacao.tipo !== "regulamenta") {
        erros.push(`${rotulo}: origem com texto na base exige operador`);
      }
      if (relacao.operador && !indice.has(`${relacao.origem}${relacao.operador}`)) {
        erros.push(`${rotulo}: operador ${relacao.operador} não existe no texto da origem`);
      }
    } else if (relacao.operador) {
      erros.push(`${rotulo}: operador informado, mas a origem não tem texto na base`);
    }
    if (relacao.alvo_dispositivo) {
      if (alvo?.situacao !== "base")
        erros.push(`${rotulo}: alvo_dispositivo exige alvo com texto na base (use alcance)`);
      else if (!indice.has(`${relacao.alvo}${relacao.alvo_dispositivo}`)) {
        erros.push(`${rotulo}: alvo_dispositivo ${relacao.alvo_dispositivo} não existe no texto do alvo`);
      }
    }
    const texto = textoDaEvidencia(relacao.evidencia.em, raiz, indice);
    if (texto === null) erros.push(`${rotulo}: evidencia.em ${relacao.evidencia.em} não está no texto da base`);
    else if (!palavrasNormalizadas(texto).includes(palavrasNormalizadas(relacao.evidencia.trecho))) {
      erros.push(`${rotulo}: trecho da evidência não está em ${relacao.evidencia.em}`);
    }
    const chave = `${relacao.tipo}|${relacao.origem}|${relacao.operador ?? ""}|${relacao.alvo}|${relacao.alvo_dispositivo ?? relacao.alcance ?? ""}`;
    if (vistas.has(chave)) erros.push(`${rotulo}: relação repetida`);
    vistas.add(chave);
  });
  arquivo.descartadas.forEach((descarte, i) => {
    if (registro.situacao(descarte.origem) !== "base") {
      erros.push(`relacoes.yaml: descartadas.${i}: origem ${descarte.origem} sem texto na base`);
    } else if (descarte.operador !== "*" && !indice.has(`${descarte.origem}${descarte.operador}`)) {
      erros.push(`relacoes.yaml: descartadas.${i}: operador ${descarte.operador} não existe`);
    }
  });
  return erros;
}

// ---------------------------------------------------------------------------------------------
// Front matter derivado

/** Campos de relação que `gerar_base.ts` escreve no front matter, nesta ordem. */
export const CAMPOS_RELACAO_FRONT_MATTER = [
  "revoga",
  "revogada_por",
  "altera",
  "alterada_por",
  "regulamenta",
  "regulamentada_por",
  "fundamenta_se_em",
  "fundamenta",
] as const;
export type CampoRelacao = (typeof CAMPOS_RELACAO_FRONT_MATTER)[number];

const CAMPO_POR_TIPO: Record<TipoRelacao, [CampoRelacao, CampoRelacao]> = {
  revoga: ["revoga", "revogada_por"],
  altera: ["altera", "alterada_por"],
  regulamenta: ["regulamenta", "regulamentada_por"],
  "fundamenta-se-em": ["fundamenta_se_em", "fundamenta"],
};

function textoDispositivo(dispositivo: string): string {
  try {
    return textoDispositivos([dispositivo]);
  } catch {
    return dispositivo;
  }
}

/** "Resolução CNE/CEB nº 3/2025 (art. 6º, III)": título do registro com o alcance. */
function textoAlvo(titulo: string, relacao: Relacao, lado: "alvo" | "origem"): string {
  if (lado === "origem") {
    return relacao.operador ? `${titulo} (${textoDispositivo(relacao.operador)})` : titulo;
  }
  if (relacao.alvo_dispositivo) return `${titulo} (${textoDispositivo(relacao.alvo_dispositivo)})`;
  if (relacao.alcance) return `${titulo} (${relacao.alcance})`;
  return titulo;
}

/**
 * Campos de relação do front matter da norma `id` (ato), gerados de `relacoes.yaml`: a origem vê o
 * alvo (`revoga: [Resolução CNE/CP nº 1/2021]`) e o alvo vê a origem com o dispositivo operador
 * (`revogada_por: [Resolução CNE/CP nº 2/2026 (art. 74, II)]`). Campos vazios ficam de fora.
 */
export function camposRelacoesFrontMatter(
  id: string,
  raiz: string,
  registro: Registro = carregarRegistro(raiz),
): Partial<Record<CampoRelacao, string[]>> {
  const ato = id;
  const campos: Partial<Record<CampoRelacao, string[]>> = {};
  const titulo = (outro: string) => registro.obter(outro)?.title ?? outro;
  for (const relacao of carregarRelacoes(raiz)) {
    const [direto, inverso] = CAMPO_POR_TIPO[relacao.tipo];
    if (relacao.origem === ato) (campos[direto] ??= []).push(textoAlvo(titulo(relacao.alvo), relacao, "alvo"));
    if (relacao.alvo === ato) {
      const texto = textoAlvo(titulo(relacao.origem), relacao, "origem");
      const lista = (campos[inverso] ??= []);
      const alcance = relacao.alvo_dispositivo ? textoDispositivo(relacao.alvo_dispositivo) : relacao.alcance;
      lista.push(alcance ? `${texto} — ${alcance}` : texto);
    }
  }
  for (const campo of Object.keys(campos) as CampoRelacao[]) campos[campo] = [...new Set(campos[campo])];
  return campos;
}

// ---------------------------------------------------------------------------------------------
// Propostas por regex

const RE_OPERADOR =
  /\b(?:ficam?\s+revogad[oa]s?|revoga(?:m)?-se|revogar|revoga\b|revogam\b|passa(?:m)?\s+a\s+vigorar\s+(?:com|acrescid)|altera\s+(?:o|os|a|as)\s+(?:art|disposit))/i;

export interface Proposta {
  tipo: "revoga" | "altera";
  origem: string;
  operador: string;
  alvos: string[];
  trecho: string;
}

/**
 * Propostas de relação por regex sobre os dispositivos das normas da base: dispositivo com
 * "Ficam revogados", "Revogam-se", "passa a vigorar com"... cujas citações resolvidas apontam para
 * outro ato. Fica de fora o que já está em `relacoes` (mesmo operador) ou em `descartadas`.
 */
export function proporRelacoes(raiz: string, registro: Registro = carregarRegistro(raiz)): Proposta[] {
  const arquivo = carregarArquivoRelacoes(raiz);
  const registradas = new Set(arquivo.relacoes.map((r) => `${r.origem}${r.operador ?? ""}`));
  const descartadas = new Set(arquivo.descartadas.map((d) => `${d.origem}${d.operador === "*" ? "" : d.operador}`));
  const descartadasTodas = new Set(arquivo.descartadas.filter((d) => d.operador === "*").map((d) => d.origem));
  const propostas: Proposta[] = [];
  for (const disp of carregarDispositivos(raiz)) {
    if (disp.tipo === "secao" || disp.tipo === "anexo") continue;
    // Só o texto próprio do dispositivo (sem o texto de outra norma citado depois de "redação:").
    const proprio = disp.texto.split(/redação:|alterações:|seguinte[s]? [^:]{0,40}:/)[0]!;
    const m = RE_OPERADOR.exec(proprio);
    if (!m) continue;
    const chave = disp.id;
    if (registradas.has(chave) || descartadas.has(chave) || descartadasTodas.has(disp.norma)) continue;
    // Revogação no caput ("Ficam revogados:") se resolve nos incisos.
    if (/revogad[oa]s?:\s*$/i.test(proprio.trim())) continue;
    const alvos = [
      ...new Set(
        extrairCitacoes(proprio, registro)
          .filter((c) => c.id !== null && c.id !== disp.norma)
          .map((c) => c.id!),
      ),
    ];
    const operadorPai = disp.pai ? disp.pai.slice(disp.norma.length) : null;
    if (alvos.length === 0 && !(operadorPai && /revogad/i.test(disp.caput.at(-1) ?? ""))) continue;
    propostas.push({
      tipo: /revog/i.test(m[0]) ? "revoga" : "altera",
      origem: disp.norma,
      operador: disp.dispositivo,
      alvos,
      trecho: proprio.slice(0, 300),
    });
  }
  // Incisos de um caput "Ficam revogados:" também são propostas.
  for (const disp of carregarDispositivos(raiz)) {
    if (disp.tipo !== "inciso") continue;
    if (!/revogad[oa]s?(?: as seguintes [^:]*)?:\s*$/i.test(disp.caput.at(-1) ?? "")) continue;
    const chave = disp.id;
    if (registradas.has(chave) || descartadas.has(chave) || descartadasTodas.has(disp.norma)) continue;
    if (propostas.some((p) => p.origem === disp.norma && p.operador === disp.dispositivo)) continue;
    const alvos = [
      ...new Set(
        extrairCitacoes(disp.texto, registro)
          .filter((c) => c.id !== null && c.id !== disp.norma)
          .map((c) => c.id!),
      ),
    ];
    propostas.push({
      tipo: "revoga",
      origem: disp.norma,
      operador: disp.dispositivo,
      alvos,
      trecho: disp.texto.slice(0, 300),
    });
  }
  return propostas;
}
