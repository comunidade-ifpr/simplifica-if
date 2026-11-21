/**
 * Mapa das fichas por tópico (`base-conhecimento/revisao-ppc/mapa-fichas.md`), gerado por
 * `gerar_base.ts` e conferido por `gerar_base.ts --check` e `validar_base.ts`. Sem data de geração:
 * o mesmo conteúdo dá o mesmo arquivo.
 */
import { ehObjeto, itensDe, itensPercorridos, type ObjetoJson, textoDe, textoOuVazio } from "@simplifica-if/kb/json";
import { aparar, apararFim, compararTexto, ordenarTextos } from "@simplifica-if/kb/texto";
import { VERIFICADOR_POR_FICHA } from "@simplifica-if/ppc/verificadores/registro";
import { type CaminhosRevisaoPpc, caminhosRevisaoPpc } from "./caminhos.ts";
import { referenciasDaFicha, universoOuVazio } from "./referencias.ts";
import { lerJson, listarJson } from "./validacao.ts";

function fichasPorId(caminhos: CaminhosRevisaoPpc): Map<string, ObjetoJson> {
  const fichas = new Map<string, ObjetoJson>();
  for (const arquivo of listarJson(caminhos.fichas)) {
    const payload = lerJson(arquivo);
    if (!ehObjeto(payload) || !Object.hasOwn(payload, "id")) throw new Error(`${arquivo}: ficha sem id`);
    fichas.set(textoDe(payload.id), payload);
  }
  return fichas;
}

function carregarTopicos(caminhos: CaminhosRevisaoPpc): ObjetoJson[] {
  const payload = lerJson(caminhos.topicosFichas);
  if (!ehObjeto(payload)) throw new Error(`${caminhos.topicosFichas}: payload deve ser objeto JSON`);
  return itensDe(payload.topicos).filter(ehObjeto);
}

/** Valor do campo em texto; ausente vira o padrão. */
function campo(objeto: ObjetoJson, nome: string, padrao = ""): string {
  return Object.hasOwn(objeto, nome) ? textoDe(objeto[nome]) : padrao;
}

function modoExecucao(ficha: ObjetoJson): string {
  return ehObjeto(ficha.execucao) ? textoOuVazio(ficha.execucao.modo) : "";
}

function linhaFicha(ficha: ObjetoJson): string {
  return `- \`${textoDe(ficha.id)}\` (${campo(ficha, "criticidade")}, ${campo(ficha, "dominio")}, ${modoExecucao(ficha)}) - ${textoDe(ficha.titulo)}`;
}

/** Fichas por modo de execução no app (`execucao.modo`): D só código, S código e IA, J julgamento da IA. */
function linhasExecucao(fichas: Map<string, ObjetoJson>): string[] {
  const linhas = [
    "## Execução no app",
    "",
    "O campo `execucao` de cada ficha diz como ela roda na revisão do app: `D`, só código, com o verificador (entre parênteses) registrado em `packages/ppc/src/verificadores/registro.ts`; `S`, o código acha o trecho e a IA confirma; `J`, julgamento da IA sobre as seções.",
    "",
  ];
  for (const modo of ["D", "S", "J"]) {
    const ids = ordenarTextos([...fichas.values()].filter((f) => modoExecucao(f) === modo).map((f) => textoDe(f.id)));
    const rotulo = (id: string) => {
      const verificador = VERIFICADOR_POR_FICHA.get(id);
      return verificador ? `\`${id}\` (\`${verificador.id}\`)` : `\`${id}\``;
    };
    linhas.push(`- \`${modo}\` (${ids.length}): ${ids.map(rotulo).join(", ")}`);
  }
  linhas.push("");
  return linhas;
}

function listaEmCodigo(valores: unknown): string {
  return itensPercorridos(valores)
    .map((valor) => `\`${textoDe(valor)}\``)
    .join(", ");
}

/**
 * Seção "Normas citadas pelas fichas": cada ID de `referencias_normativas`, com o título canônico e as
 * fichas que o citam (marcadas quando só como `complementar`).
 */
function linhasNormasCitadas(fichas: Map<string, ObjetoJson>, caminhos: CaminhosRevisaoPpc): string[] {
  const universo = universoOuVazio(caminhos);
  const citantes = new Map<string, Map<string, Set<string>>>();
  for (const fichaId of ordenarTextos(fichas.keys())) {
    for (const referencia of referenciasDaFicha(fichas.get(fichaId)!)) {
      const porFicha = citantes.get(referencia.ref) ?? new Map<string, Set<string>>();
      const papeis = porFicha.get(fichaId) ?? new Set<string>();
      papeis.add(referencia.papel);
      porFicha.set(fichaId, papeis);
      citantes.set(referencia.ref, porFicha);
    }
  }
  const linhas = [
    "## Normas citadas pelas fichas",
    "",
    "Gerado de `referencias_normativas`. Quando uma norma mudar, estas são as fichas a revisar.",
    "",
  ];
  for (const ref of ordenarTextos(citantes.keys())) {
    const fichasRef = [...citantes.get(ref)!].map(([fichaId, papeis]) =>
      papeis.has("fundamento") ? `\`${fichaId}\`` : `\`${fichaId}\` (complementar)`,
    );
    linhas.push(`- \`${ref}\` ${universo.titulo(ref)}: ${fichasRef.join(", ")}`);
  }
  linhas.push("");
  return linhas;
}

/** O Markdown do mapa. */
export function gerarMapaFichas(caminhos: CaminhosRevisaoPpc = caminhosRevisaoPpc()): string {
  const fichas = fichasPorId(caminhos);
  const topicosPorGrupo = new Map<string, ObjetoJson[]>();
  for (const topico of carregarTopicos(caminhos)) {
    const grupo = textoOuVazio(topico.grupo) || "Outros";
    const lista = topicosPorGrupo.get(grupo) ?? [];
    lista.push(topico);
    topicosPorGrupo.set(grupo, lista);
  }

  const linhas = [
    "# Mapa de fichas da revisão de PPC",
    "",
    "Este mapa organiza as fichas (os critérios da revisão de PPC) por tópicos semânticos, sem depender da numeração das seções do PPC.",
    "Gerado de `fichas/` e `topicos-fichas.json` por `node scripts/gerar_base.ts`; não edite à mão.",
    "",
    "## Como usar",
    "",
    "- Use os tópicos para localizar rapidamente quais fichas tratam de estágio, avaliação, AEE, infraestrutura, referências e outros temas.",
    "- Use `aliases_titulo` e `termos_busca` de `topicos-fichas.json` para localizar a seção correspondente mesmo quando o PPC usar outro título ou outra numeração.",
    "- Fichas transversais aparecem em tópicos próprios ou em mais de um tópico quando ajudam a cruzar seções.",
    "",
  ];

  linhas.push(...linhasExecucao(fichas));

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
  linhas.push(...linhasNormasCitadas(fichas, caminhos));

  return `${apararFim(linhas.join("\n"))}\n`;
}

/** O mapa como `gerar_base.ts` o grava (caminho absoluto e texto). */
export function mapaGerado(caminhos: CaminhosRevisaoPpc = caminhosRevisaoPpc()): { caminho: string; texto: string } {
  return { caminho: caminhos.mapa, texto: gerarMapaFichas(caminhos) };
}
