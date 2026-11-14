#!/usr/bin/env node
/**
 * CLI `kb`: consultas determinísticas à base de conhecimento.
 *
 *   pnpm kb resolver "Resolução CNE/CP nº 1/2021, art. 20" [--json]
 *   pnpm kb citacoes br/cne-cp/res/2021/1 [--json] [--confianca-min 0.8]
 *   pnpm kb adequacao-art71 [--json] [--incluir-tecnologia]
 *   pnpm kb avaliar-resolvedor [--json]
 *
 * Comandos sobre o kb.sqlite (buscar-norma, buscar-secoes, cursos, ppc-fatos, pacote-contexto,
 * avaliar-busca): db/comandos.ts.
 *
 * Saídas sem relógio e com ordem estável: as mesmas fontes dão a mesma saída.
 */
import { Command, InvalidArgumentError } from "commander";
import { adequacaoArt71, INDICADORES, ROTULOS_INDICADOR } from "./adequacao/art71.ts";
import { avaliarResolvedor } from "./avaliacao/resolvedor.ts";
import { ehIdExterno, ehIdNorma, idDoAto } from "./normas/ids.ts";
import { registroPadrao, resolucaoComEntrada } from "./normas/resolver.ts";
import { ppcsQueCitam, relatorioCitacoes } from "./ppcs/citacoes.ts";
import { registrarComandosNormas } from "./normas/comandos.ts";
import { registrarComandosBanco } from "./db/comandos.ts";

function json(valor: unknown): void {
  process.stdout.write(`${JSON.stringify(valor, null, 2)}\n`);
}

function confianca(valor: string): number {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 0 || numero > 1) throw new InvalidArgumentError("use um número entre 0 e 1");
  return numero;
}

const programa = new Command()
  .name("kb")
  .description("Consultas à base de conhecimento do IFPR (IDs canônicos de normas, citações em PPCs).")
  .showHelpAfterError();

programa
  .command("resolver")
  .description("Resolve uma citação normativa para o ID canônico (e o dispositivo, se houver).")
  .argument("<texto...>", "citação, como 'Res. CNE/CP nº 1/2021, art. 20' ou uma URL do Planalto/DOU")
  .option("--json", "saída em JSON")
  .action((partes: string[], opcoes: { json?: boolean }) => {
    const texto = partes.join(" ");
    const registro = registroPadrao();
    const resultado = resolucaoComEntrada(texto, registro);
    const entrada = resultado.id ? registro.obter(resultado.id) : undefined;
    if (opcoes.json) return json(resultado);
    if (!resultado.id) {
      console.log(`não resolvida (${resultado.regra})`);
      process.exitCode = 1;
      return;
    }
    console.log(
      resultado.id +
        (resultado.dispositivos
          ? ` ${resultado.dispositivos.join(" ")}`
          : resultado.dispositivoId
            ? ` ${resultado.dispositivoId}`
            : ""),
    );
    console.log(`  regra: ${resultado.regra}; confiança: ${resultado.confianca}; situação: ${resultado.situacao}`);
    if (entrada) console.log(`  ${entrada.title}${entrada.path ? ` — base-conhecimento/${entrada.path}` : ""}`);
  });

programa
  .command("citacoes")
  .description("Lista os PPCs convertidos que citam a norma <id>, com linha, trecho e regra.")
  .argument("<id>", "ID canônico, como br/cne-cp/res/2021/1 (aceita #dispositivo)")
  .option("--json", "saída em JSON")
  .option("--confianca-min <n>", "ignora citações com confiança menor", confianca, 0)
  .action((id: string, opcoes: { json?: boolean; confiancaMin: number }) => {
    const [norma] = id.split("#");
    if (!ehIdNorma(norma!) && !ehIdExterno(norma!)) {
      programa.error(`ID fora do formato canônico: ${id} (ex.: br/cne-cp/res/2021/1)`);
    }
    const ppcs = ppcsQueCitam(id, { confiancaMinima: opcoes.confiancaMin });
    const entrada = registroPadrao().obter(idDoAto(norma!));
    const ocorrencias = ppcs.reduce((total, ppc) => total + ppc.ocorrencias.length, 0);
    if (opcoes.json) return json(relatorioCitacoes(id, ppcs, registroPadrao()));
    console.log(`${id}${entrada ? ` — ${entrada.title}` : ""}: ${ppcs.length} PPCs, ${ocorrencias} ocorrências`);
    for (const ppc of ppcs) {
      console.log(`\n${ppc.ppc} (${ppc.nivel}, ${ppc.tipo_oferta})`);
      for (const o of ppc.ocorrencias) {
        const dispositivo = o.dispositivos?.join(" ") ?? o.dispositivoId ?? "";
        console.log(`  L${o.linha} [${o.regra} ${o.confianca}] ${o.trecho}${dispositivo ? ` ${dispositivo}` : ""}`);
      }
    }
  });

programa
  .command("adequacao-art71")
  .description("Cursos técnicos em oferta sujeitos ao art. 71 da Res. CNE/CP nº 2/2026, com a DCN que o PPC cita.")
  .option("--json", "saída em JSON")
  .option("--incluir-tecnologia", "inclui os cursos superiores de tecnologia (o art. 71 também os alcança)")
  .action((opcoes: { json?: boolean; incluirTecnologia?: boolean }) => {
    const relatorio = adequacaoArt71({ incluirTecnologia: opcoes.incluirTecnologia ?? false });
    if (opcoes.json) return json(relatorio);
    console.log(`Art. 71 da Res. CNE/CP nº 2/2026: ${relatorio.total} cursos alcançados`);
    console.log(relatorio.criterio);
    console.log("");
    for (const indicador of INDICADORES) {
      console.log(`${String(relatorio.totais[indicador]).padStart(4)}  ${ROTULOS_INDICADOR[indicador]}`);
    }
    for (const indicador of INDICADORES) {
      const cursos = relatorio.cursos.filter((curso) => curso.indicador === indicador);
      if (cursos.length === 0) continue;
      console.log(`\n## ${ROTULOS_INDICADOR[indicador]} (${cursos.length})`);
      for (const curso of cursos) {
        const ano = curso.ppc_ano ? ` PPC ${curso.ppc_ano}` : "";
        console.log(`  ${curso.curso} — ${curso.nome} (${curso.forma_oferta ?? "?"}${ano})`);
      }
    }
  });

programa
  .command("avaliar-resolvedor")
  .description("Mede precisão e recall do resolvedor no conjunto anotado (avaliacao/resolvedor/).")
  .option("--json", "saída em JSON")
  .action((opcoes: { json?: boolean }) => {
    const resultado = avaliarResolvedor();
    if (opcoes.json) return json(resultado);
    console.log(
      `${resultado.ppcs} PPCs, ${resultado.linhas} linhas, ${resultado.anotados} citações anotadas, ${resultado.emitidos} emitidas`,
    );
    console.log(
      `precisão ${resultado.precisao}  recall ${resultado.recall}  dispositivos ${resultado.dispositivos.taxa}`,
    );
    for (const problema of resultado.problemas) console.log(`PROBLEMA: ${problema}`);
    for (const erro of resultado.erros) {
      console.log(
        `${erro.tipo.padEnd(15)} ${erro.id.padEnd(38)} ${(erro.regra ?? "").padEnd(24)} ${erro.ppc} L${erro.linha}`,
      );
    }
  });

registrarComandosNormas(programa);
registrarComandosBanco(programa);

await programa.parseAsync();
