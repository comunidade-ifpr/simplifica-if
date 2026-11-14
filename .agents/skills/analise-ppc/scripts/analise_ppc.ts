#!/usr/bin/env bun
/**
 * Ponto de entrada único da skill analise-ppc.
 *
 * Todos os subcomandos rodam em TypeScript. Em `preparar-documento`, só a
 * conversão de `.docx` em artefatos ainda é feita pelo Python
 * (`converter_docx.py`), até a trilha T3; `ANALISE_PPC_PYTHON` escolhe o
 * interpretador.
 *
 * `ANALISE_PPC_AGORA` (data ISO 8601) fixa o relógio, para testes e
 * diferenciais.
 */
import path from "node:path";
import { Command, InvalidArgumentError } from "commander";
import { dumpsPy } from "@simplifica-if/kb/python/json";
import { caminhoComoUri } from "@simplifica-if/kb/python/url";
import { inteiroDeTexto } from "@simplifica-if/kb/python/valores";
import { caminhosPadrao } from "./caminhos.ts";
import { escreverSchemas, schemasDesatualizados } from "./esquemas.ts";
import { escreverIndice, indiceAtualizado } from "./indice-base.ts";
import { escreverMapa, mapaAtualizado } from "./mapa-fichas.ts";
import { AMOSTRA_MEDICAO, formatarMedicao, medirIdentificacao } from "./medicao-identificacao.ts";
import { prepararDocumento } from "./preparar-documento.ts";
import { dominioSurgePadrao, prepararSiteSurge, type PublicacaoSurge, publicarSiteSurge } from "./publicar-surge.ts";
import { gerarRelatorioHtml } from "./relatorio-html.ts";
import { validarResultadosRodada } from "./resultados.ts";
import { caminhosRodada, escreverJsonPy, resolverCaminho, TAMANHO_GRUPO_PADRAO } from "./rodada.ts";
import {
  mesclarResultadosAvulsos,
  montarGrupoAvulso,
  montarGruposSubagents,
  prepararPromptsSubagents,
} from "./subagents.ts";
import { validarBaseAnalise } from "./validacao-base.ts";

const COMANDO = "bun run .agents/skills/analise-ppc/scripts/analise_ppc.ts";
/** Imprime o JSON como `print(json.dumps(payload, ensure_ascii=False, indent=2))`. */
function imprimirJson(payload: unknown): void {
  process.stdout.write(`${dumpsPy(payload, { indent: 2 })}\n`);
}

/** Executa um subcomando; erros viram mensagem em stderr e código de saída 1. */
function executar(acao: () => void): void {
  try {
    acao();
    process.exitCode = 0;
  } catch (erro) {
    const mensagem = erro instanceof Error ? `${erro.name}: ${erro.message}` : String(erro);
    process.stderr.write(`${mensagem}\n`);
    process.exitCode = 1;
  }
}

function inteiro(valor: string): number {
  const numero = inteiroDeTexto(valor);
  if (numero === null) throw new InvalidArgumentError(`invalid int value: '${valor}'`);
  return numero;
}

function acumular(valor: string, anteriores: string[] = []): string[] {
  return [...anteriores, valor];
}

type Objeto = Record<string, unknown>;

/** Resumo impresso por `montar-grupos-subagents` sem `--detalhado`. */
export function resumoGruposSubagents(payload: Objeto): Objeto {
  const grupos = Array.isArray(payload.grupos) ? (payload.grupos as Objeto[]) : [];
  const cnct = (payload.cnct_contexto ?? {}) as Objeto;
  const correspondencia = (cnct.correspondencia ?? {}) as Objeto;
  return {
    rodada_dir: payload.rodada_dir,
    ppc_markdown: payload.ppc_markdown,
    grupos_subagents: payload.grupos_subagents_path,
    cnct_contexto_path: payload.cnct_contexto_path,
    contexto_estrutural_path: payload.contexto_estrutural_path,
    validacoes_cruzadas_path: payload.validacoes_cruzadas_path,
    curso: payload.curso,
    total_fichas: payload.total_fichas,
    tamanho_grupo: payload.tamanho_grupo,
    total_grupos: grupos.length,
    grupos: grupos.map((grupo) => ({
      grupo_id: grupo.grupo_id,
      topico: grupo.topico,
      parte: grupo.parte,
      partes: grupo.partes,
      escopo_ppc: grupo.escopo_ppc,
      total_fichas: grupo.total_fichas,
      total_secoes: ((grupo.contextos ?? {}) as Objeto & { ppc?: Objeto }).ppc?.total_secoes ?? null,
      requer_contexto_cnct: grupo.requer_contexto_cnct ?? false,
      requer_fundamentacao_normativa: grupo.requer_fundamentacao_normativa ?? false,
      requer_anexos_visuais: grupo.requer_anexos_visuais ?? false,
    })),
    cnct_correspondencia: {
      denominacao: correspondencia.denominacao ?? null,
      eixo_tecnologico: correspondencia.eixo_tecnologico ?? null,
      score: correspondencia.score ?? null,
      tipo_correspondencia: correspondencia.tipo_correspondencia ?? null,
    },
  };
}

function validarBase(): number {
  const erros = validarBaseAnalise();
  if (erros.length) {
    for (const erro of erros) console.log(erro);
    return 1;
  }
  console.log("Base de análise válida.");
  return 0;
}

function gerarIndice(opcoes: { check?: boolean }): number {
  const caminhos = caminhosPadrao();
  if (opcoes.check) {
    if (indiceAtualizado(caminhos)) {
      console.log(`OK: ${caminhos.indicePath}`);
      return 0;
    }
    console.log(`ERRO: ${caminhos.indicePath} está desatualizado. Rode ${COMANDO} gerar-indice.`);
    return 1;
  }
  const indice = escreverIndice(caminhos);
  const resumo = indice.resumo as { total_fichas: number; total_itens: number };
  console.log(`Índice gerado em ${caminhos.indicePath} (${resumo.total_fichas} fichas, ${resumo.total_itens} itens).`);
  return 0;
}

function gerarMapa(opcoes: { check?: boolean }): number {
  const caminhos = caminhosPadrao();
  if (opcoes.check) {
    if (mapaAtualizado(caminhos)) {
      console.log(`OK: ${caminhos.mapaFichasPath}`);
      return 0;
    }
    console.log(`ERRO: ${caminhos.mapaFichasPath} está desatualizado. Rode ${COMANDO} gerar-mapa.`);
    return 1;
  }
  escreverMapa(caminhos);
  console.log(`Mapa de fichas gerado em ${caminhos.mapaFichasPath}.`);
  return 0;
}

function gerarSchemas(opcoes: { check?: boolean }): number {
  const caminhos = caminhosPadrao();
  if (opcoes.check) {
    const desatualizados = schemasDesatualizados(caminhos);
    if (!desatualizados.length) {
      console.log(`OK: ${caminhos.schemasDir}`);
      return 0;
    }
    for (const arquivo of desatualizados)
      console.log(`ERRO: ${arquivo} está desatualizado. Rode ${COMANDO} gerar-schemas.`);
    return 1;
  }
  for (const arquivo of escreverSchemas(caminhos)) console.log(`Schema gerado em ${arquivo}.`);
  return 0;
}

/** Saída de `gerar-relatorio-html`: caminho e URL do relatório e, se publicado, a URL pública. */
export function payloadRelatorio(relatorioHtml: string, publicacao?: PublicacaoSurge): Objeto {
  const relatorio = resolverCaminho(relatorioHtml);
  const uri = caminhoComoUri(relatorio);
  const payload: Objeto = {
    relatorio_html: relatorio,
    relatorio_url: uri,
    mensagem: `Relatório pronto: ${uri}`,
  };
  if (publicacao) {
    const publicUrl = publicacao.public_url || "";
    Object.assign(payload, {
      publicacao_servico: publicacao.servico,
      publicacao_url: publicUrl,
      surge_url: publicUrl,
      surge_domain: publicacao.domain,
      mensagem: `Relatório pronto: ${publicUrl || uri}`,
    });
  }
  return payload;
}

function gerarRelatorio(opcoes: { rodadaDir: string; resultados: string; semSurge?: boolean; surgeDomain?: string }) {
  const relatorio = gerarRelatorioHtml(opcoes.rodadaDir, opcoes.resultados);
  if (opcoes.semSurge) return payloadRelatorio(relatorio.relatorio_html);
  const rodada = caminhosRodada(opcoes.rodadaDir);
  const siteDir = prepararSiteSurge(relatorio.relatorio_html, path.join(rodada.suporteDir, "surge-site"));
  const publicacao = publicarSiteSurge(siteDir, opcoes.surgeDomain || dominioSurgePadrao(rodada.rodadaDir));
  publicacao.relatorio_html_original = resolverCaminho(relatorio.relatorio_html);
  escreverJsonPy(path.join(rodada.suporteDir, "surge-publicacao.json"), publicacao);
  return payloadRelatorio(relatorio.relatorio_html, publicacao);
}

export function criarPrograma(): Command {
  const programa = new Command()
    .name("analise_ppc.ts")
    .description("Análise de PPC por sub-agentes na conversa")
    .enablePositionalOptions();

  programa
    .command("preparar-documento")
    .description("Criar a rodada e o PPC.md canônico")
    .argument("<arquivo>", "Arquivo .md ou .docx de entrada")
    .option("--saida-base <dir>", "Diretório base opcional para a rodada")
    .action((arquivo: string, opcoes: { saidaBase?: string }) => {
      executar(() => {
        const resultado = prepararDocumento(arquivo, opcoes.saidaBase ? { saidaBase: opcoes.saidaBase } : {});
        imprimirJson(resultado.resumo);
      });
    });

  programa
    .command("montar-grupos-subagents")
    .description("Montar os grupos por tópico para sub-agentes e salvar grupos-subagents.json")
    .requiredOption("--rodada-dir <dir>", "Diretório da rodada")
    .option(
      "--tamanho-grupo <n>",
      "Quantidade máxima de fichas por grupo (tópicos maiores viram partes)",
      inteiro,
      TAMANHO_GRUPO_PADRAO,
    )
    .option(
      "--detalhado",
      "Imprimir o JSON completo; por padrão a CLI mostra apenas um resumo e salva o payload completo.",
    )
    .action((opcoes: { rodadaDir: string; tamanhoGrupo: number; detalhado?: boolean }) => {
      executar(() => {
        const payload = montarGruposSubagents(opcoes.rodadaDir, opcoes.tamanhoGrupo);
        imprimirJson(opcoes.detalhado ? payload : resumoGruposSubagents(payload));
      });
    });

  programa
    .command("preparar-prompts-subagents")
    .description("Gerar pacotes Markdown autocontidos para cada grupo de sub-agente")
    .requiredOption("--rodada-dir <dir>", "Diretório da rodada")
    .action((opcoes: { rodadaDir: string }) => {
      executar(() => imprimirJson(prepararPromptsSubagents(opcoes.rodadaDir)));
    });

  programa
    .command("montar-grupo-avulso")
    .description("Montar um grupo avulso de fichas para reavaliação por sub-agente")
    .requiredOption("--rodada-dir <dir>", "Diretório da rodada")
    .requiredOption("--ficha-id <id>", "Ficha a incluir no grupo avulso (repetível)", acumular)
    .action((opcoes: { rodadaDir: string; fichaId: string[] }) => {
      executar(() => imprimirJson(montarGrupoAvulso(opcoes.rodadaDir, opcoes.fichaId)));
    });

  programa
    .command("mesclar-resultados-avulsos")
    .description("Mesclar respostas avulsas em resultados-subagents.json")
    .requiredOption("--rodada-dir <dir>", "Diretório da rodada")
    .option(
      "--resultados-base <arquivo>",
      "JSON base de resultados; relativo a arquivos-suporte quando não absoluto",
      "resultados-subagents.json",
    )
    .requiredOption(
      "--resultados-avulsos <arquivo>",
      "JSON retornado pelo sub-agente avulso; relativo a arquivos-suporte quando não absoluto",
    )
    .option("--saida <arquivo>", "Destino do JSON mesclado; padrão: sobrescreve --resultados-base")
    .action((opcoes: { rodadaDir: string; resultadosBase: string; resultadosAvulsos: string; saida?: string }) => {
      executar(() =>
        imprimirJson(
          mesclarResultadosAvulsos(opcoes.rodadaDir, opcoes.resultadosBase, opcoes.resultadosAvulsos, opcoes.saida),
        ),
      );
    });

  programa
    .command("validar-resultados")
    .description("Validar cobertura e contrato do JSON de resultados sem gerar HTML")
    .requiredOption("--rodada-dir <dir>", "Diretório da rodada")
    .option(
      "--resultados <arquivo>",
      "JSON coletado dos sub-agentes; relativo a arquivos-suporte quando não absoluto",
      "resultados-subagents.json",
    )
    .action((opcoes: { rodadaDir: string; resultados: string }) => {
      executar(() => imprimirJson(validarResultadosRodada(opcoes.rodadaDir, opcoes.resultados)));
    });

  programa
    .command("validar-base")
    .description("Validar fichas, tópicos, marcos normativos, validações cruzadas e contratos da base de análise")
    .action(() => {
      process.exitCode = validarBase();
    });

  programa
    .command("gerar-schemas")
    .description("Gerar os JSON Schemas de ficha e marcos normativos a partir do zod (scripts/esquemas.ts)")
    .option("--check", "verificar se os schemas estão atualizados sem reescrever")
    .action((opcoes: { check?: boolean }) => {
      process.exitCode = gerarSchemas(opcoes);
    });

  programa
    .command("gerar-indice")
    .description("Gerar base-analise/indice.json")
    .option("--check", "verificar se indice.json está atualizado sem reescrever")
    .action((opcoes: { check?: boolean }) => {
      process.exitCode = gerarIndice(opcoes);
    });

  programa
    .command("gerar-mapa")
    .description("Gerar base-analise/mapa-fichas.md")
    .option("--check", "verificar se mapa-fichas.md está atualizado sem reescrever")
    .action((opcoes: { check?: boolean }) => {
      process.exitCode = gerarMapa(opcoes);
    });

  programa
    .command("gerar-relatorio-html")
    .description("Gerar o relatório HTML final")
    .requiredOption("--rodada-dir <dir>", "Diretório da rodada")
    .option(
      "--resultados <arquivo>",
      "JSON coletado dos sub-agentes; relativo a arquivos-suporte quando não absoluto",
      "resultados-subagents.json",
    )
    .option("--sem-surge", "Gerar apenas o HTML local, sem publicar no Surge.")
    .option("--surge-domain <dominio>", "Domínio Surge de publicação; padrão: analise-ppc-<rodada>.surge.sh.")
    .action((opcoes: { rodadaDir: string; resultados: string; semSurge?: boolean; surgeDomain?: string }) => {
      executar(() => imprimirJson(gerarRelatorio(opcoes)));
    });

  programa
    .command("medir-identificacao")
    .description("Medir a identificação do curso nos PPCs técnicos da base contra dados/institucional/cursos")
    .option("--amostra", "medir só a amostra fixa usada nos testes")
    .option("--erros", "listar os casos errados ou vazios")
    .option("--json", "imprimir a medição completa em JSON")
    .action((opcoes: { amostra?: boolean; erros?: boolean; json?: boolean }) => {
      executar(() => {
        const medicao = medirIdentificacao(opcoes.amostra ? { amostra: AMOSTRA_MEDICAO } : {});
        if (opcoes.json) process.stdout.write(`${JSON.stringify(medicao, null, 2)}\n`);
        else process.stdout.write(formatarMedicao(medicao, { erros: Boolean(opcoes.erros) }));
      });
    });

  return programa;
}

if (import.meta.main) {
  await criarPrograma().parseAsync(process.argv);
}
