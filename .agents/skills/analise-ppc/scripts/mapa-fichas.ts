/** Mapa das fichas por tópico (`base-analise/mapa-fichas.md`). */
import { existsSync } from "node:fs";
import { ehObjeto, itensDe, itensPercorridos, type ObjetoJson, textoDe, textoOuVazio } from "@simplifica-if/kb/json";
import { aparar, apararFim, compararTexto, dividirLinhas, lerTexto, ordenarTextos } from "@simplifica-if/kb/texto";
import { agoraUtc, escreverTexto, lerJson, listarArquivos } from "./arquivos.ts";
import { type CaminhosAnalise, caminhosPadrao } from "./caminhos.ts";

const PREFIXO_GERADO_EM = "Gerado em: ";

function fichasPorId(caminhos: CaminhosAnalise): Map<string, ObjetoJson> {
  const fichas = new Map<string, ObjetoJson>();
  for (const arquivo of listarArquivos(caminhos.fichasDir, ".json")) {
    const payload = lerJson(arquivo);
    if (!ehObjeto(payload) || !Object.hasOwn(payload, "id")) throw new Error(`${arquivo}: ficha sem id`);
    fichas.set(textoDe(payload.id), payload);
  }
  return fichas;
}

function carregarTopicos(caminhos: CaminhosAnalise): ObjetoJson[] {
  const payload = lerJson(caminhos.topicosFichasPath);
  if (!ehObjeto(payload)) throw new Error(`${caminhos.topicosFichasPath}: payload deve ser objeto JSON`);
  return itensDe(payload.topicos).filter(ehObjeto);
}

/** Valor como numa f-string: ausente vira o padrão; nulo vira `None`. */
function campo(objeto: ObjetoJson, nome: string, padrao = ""): string {
  return Object.hasOwn(objeto, nome) ? textoDe(objeto[nome]) : padrao;
}

function linhaFicha(ficha: ObjetoJson): string {
  return `- \`${textoDe(ficha.id)}\` (${campo(ficha, "criticidade")}, ${campo(ficha, "dominio")}) - ${textoDe(ficha.titulo)}`;
}

function listaEmCodigo(valores: unknown): string {
  return itensPercorridos(valores)
    .map((valor) => `\`${textoDe(valor)}\``)
    .join(", ");
}

/** Gera o Markdown do mapa; `geradoEm` fixa a data (por padrão, agora em UTC). */
export function gerarMapaFichas(geradoEm?: string, caminhos: CaminhosAnalise = caminhosPadrao()): string {
  const fichas = fichasPorId(caminhos);
  const topicosPorGrupo = new Map<string, ObjetoJson[]>();
  for (const topico of carregarTopicos(caminhos)) {
    const grupo = textoOuVazio(topico.grupo) || "Outros";
    const lista = topicosPorGrupo.get(grupo) ?? [];
    lista.push(topico);
    topicosPorGrupo.set(grupo, lista);
  }

  const linhas = [
    "# Mapa de fichas da análise de PPC",
    "",
    "Este mapa organiza as fichas por tópicos semânticos, sem depender da numeração das seções do PPC.",
    "A numeração observada em um PPC específico deve ser detectada na rodada de análise, não codificada na ficha.",
    "",
    `${PREFIXO_GERADO_EM}${geradoEm || agoraUtc()}`,
    "",
    "## Como usar",
    "",
    "- Use os tópicos para localizar rapidamente quais fichas tratam de estágio, avaliação, AEE, infraestrutura, referências e outros temas.",
    "- Use `aliases_titulo` e `termos_busca` de `topicos-fichas.json` para localizar a seção correspondente mesmo quando o PPC usar outro título ou outra numeração.",
    "- Fichas transversais aparecem em tópicos próprios ou em mais de um tópico quando ajudam a cruzar seções.",
    "",
  ];

  for (const grupo of ordenarTextos(topicosPorGrupo.keys())) {
    linhas.push(`## ${grupo}`, "");
    const topicos = [...topicosPorGrupo.get(grupo)!].sort((a, b) =>
      compararTexto(textoOuVazio(a.titulo), textoOuVazio(b.titulo)),
    );
    for (const topico of topicos) {
      linhas.push(
        `### ${textoDe(topico.titulo)}`,
        "",
        aparar(textoOuVazio(topico.descricao)),
        "",
        `- Tipo de escopo: \`${campo(topico, "tipo_escopo")}\``,
        `- Aliases de título: ${listaEmCodigo(topico.aliases_titulo)}`,
        `- Termos de busca: ${listaEmCodigo(topico.termos_busca)}`,
        "",
      );
      for (const fichaId of itensPercorridos(topico.fichas)) {
        const ficha = fichas.get(textoDe(fichaId));
        if (ficha && Object.keys(ficha).length) linhas.push(linhaFicha(ficha));
        else linhas.push(`- \`${textoDe(fichaId)}\` - ficha não encontrada`);
      }
      linhas.push("");
    }
  }

  return `${apararFim(linhas.join("\n"))}\n`;
}

/** Grava `mapa-fichas.md` e devolve o texto gravado. */
export function escreverMapa(caminhos: CaminhosAnalise = caminhosPadrao(), geradoEm?: string): string {
  const mapa = gerarMapaFichas(geradoEm, caminhos);
  escreverTexto(caminhos.mapaFichasPath, mapa);
  return mapa;
}

/** Se `mapa-fichas.md` existe e é idêntico ao mapa gerado agora com o mesmo "Gerado em". */
export function mapaAtualizado(caminhos: CaminhosAnalise = caminhosPadrao()): boolean {
  if (!existsSync(caminhos.mapaFichasPath)) return false;
  const atual = lerTexto(caminhos.mapaFichasPath);
  const linha = dividirLinhas(atual).find((texto) => texto.startsWith(PREFIXO_GERADO_EM));
  const geradoEm = linha ? linha.slice(PREFIXO_GERADO_EM.length) : "";
  return atual === gerarMapaFichas(geradoEm, caminhos);
}
