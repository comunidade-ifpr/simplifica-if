/**
 * Comandos da CLI `kb` da fase 5 (dispositivos, vigência, relações, correspondência e impacto),
 * registrados por `cli.ts` com `registrarComandosNormas(programa)`:
 *
 *   bun run kb dispositivo br/cne-cp/res/2026/2#art71-parunico [--json] [--filhos]
 *   bun run kb vigencia br/cne-cp/res/2021/1 [--em 2026-11-01] [--json]
 *   bun run kb relacoes br/lei/1996/9394 [--json]
 *   bun run kb relacoes --propor [--json]
 *   bun run kb correspondencia br/cne-cp/res/2021/1#art20 [--json]
 *   bun run kb impacto br/cne-cp/res/2021/1 [--json] [--sem-ppcs] [--conteudo <dir>]
 *
 * As saídas não dependem do relógio: a data é `--em` ou a `data_referencia` de
 * `base-conhecimento/config/vigencia.yaml`.
 *
 * `dispositivo` e `correspondencia` leem o `kb.sqlite` (recompilado sozinho se velho), pelas mesmas
 * regras da API de arquivos (`db/consultas-normas.ts`; `db/base.test.ts` confere a igualdade).
 * `vigencia`, `relacoes` e `impacto` leem os arquivos: `vigencia` explica o status com os eventos e
 * as pendências que `statusEm` monta (o banco guarda só os intervalos que saem dele), `relacoes
 * --propor` roda o regex sobre o parser, e `impacto` lê os textos das skills (inclusive de outra
 * árvore, `--conteudo`), que não estão no banco.
 */
import type { Database } from "bun:sqlite";
import { type Command, InvalidArgumentError } from "commander";
import { abrirBanco } from "../db/banco.ts";
import { descendentesBanco, fonteCorrespondenciaBanco, obterDispositivoBanco } from "../db/consultas-normas.ts";
import { obterNorma } from "../db/consultas.ts";
import { correspondenciaEm } from "./correspondencia.ts";
import { ehIdNorma, idDoAto } from "./ids.ts";
import { impacto } from "./impacto.ts";
import { carregarRegistro } from "./registro.ts";
import { proporRelacoes, relacoesDe } from "./relacoes.ts";
import { dataReferencia, statusEm, transicoesAplicaveis } from "./vigencia.ts";

function json(valor: unknown): void {
  process.stdout.write(`${JSON.stringify(valor, null, 2)}\n`);
}

function comBanco<T>(acao: (db: Database) => T): T {
  const db = abrirBanco();
  try {
    return acao(db);
  } finally {
    db.close();
  }
}

function data(valor: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) throw new InvalidArgumentError("use AAAA-MM-DD");
  return valor;
}

function exigirIdNorma(programa: Command, id: string): string {
  const [norma] = id.split("#");
  if (!ehIdNorma(norma!)) programa.error(`ID fora do formato canônico: ${id} (ex.: br/cne-cp/res/2021/1)`);
  return idDoAto(norma!);
}

export function registrarComandosNormas(programa: Command): void {
  programa
    .command("dispositivo")
    .description("Texto de um dispositivo (com caput herdado, notas de redação e linha de origem).")
    .argument("<id>", "ID com dispositivo, como br/cne-cp/res/2026/2#art71-parunico")
    .option("--json", "saída em JSON")
    .option("--filhos", "inclui incisos, alíneas e parágrafos do dispositivo")
    .action((id: string, opcoes: { json?: boolean; filhos?: boolean }) => {
      exigirIdNorma(programa, id);
      const achado = comBanco((db) => {
        const d = obterDispositivoBanco(db, id);
        if (!d) return null;
        return {
          d,
          titulo: obterNorma(db, d.disp.ato)?.titulo ?? d.disp.ato,
          filhos: opcoes.filhos ? descendentesBanco(db, d.disp.id).map((f) => f.disp) : [],
        };
      });
      if (!achado) {
        if (opcoes.json) json({ id, encontrado: false });
        else console.log(`dispositivo não encontrado: ${id}`);
        process.exitCode = 1;
        return;
      }
      const { disp } = achado.d;
      const filhos = achado.filhos;
      // path relativo a base-conhecimento/, como no manifest
      const path = achado.d.path.replace(/^base-conhecimento\//, "");
      if (opcoes.json) return json({ ...disp, path, filhos });
      console.log(`${disp.id} — ${achado.titulo}`);
      console.log(`  ${achado.d.path}:${disp.linha_inicio}-${disp.linha_fim}`);
      if (disp.estrutura.length) console.log(`  ${disp.estrutura.join(" › ")}`);
      for (const caput of disp.caput) console.log(`  [caput] ${caput}`);
      console.log(`\n${disp.texto}`);
      if (disp.revogado) console.log("\n(revogado)");
      for (const nota of disp.notas) console.log(`  nota (${nota.tipo}): ${nota.texto}`);
      for (const filho of filhos) console.log(`\n${filho.dispositivo}: ${filho.texto}`);
    });

  programa
    .command("vigencia")
    .description(
      "Status de vigência de uma norma numa data, com as relações que o determinam e as regras de transição.",
    )
    .argument("<id>", "ID da norma, como br/cne-cp/res/2021/1")
    .option("--em <data>", "data AAAA-MM-DD (padrão: data_referencia de config/vigencia.yaml)", data)
    .option("--json", "saída em JSON")
    .action((id: string, opcoes: { em?: string; json?: boolean }) => {
      const ato = exigirIdNorma(programa, id);
      const quando = opcoes.em ?? dataReferencia();
      const resultado = statusEm(ato, quando);
      const transicoes = transicoesAplicaveis(ato, quando);
      if (opcoes.json) return json({ ...resultado, transicoes });
      const titulo = carregarRegistro().obter(ato)?.title ?? ato;
      console.log(`${titulo} (${ato}) em ${quando}: ${resultado.status}${resultado.certo ? "" : " — A CONFIRMAR"}`);
      const inicio = resultado.inicio;
      console.log(
        `  início de vigência: ${inicio.data ?? `a confirmar${inicio.minimo ? ` (não antes de ${inicio.minimo})` : ""}`}`,
      );
      for (const evento of resultado.eventos) {
        const alcance = evento.alvo_dispositivo ?? evento.alcance;
        const efeito =
          evento.efeito_de ?? `a confirmar${evento.efeito_minimo ? `, não antes de ${evento.efeito_minimo}` : ""}`;
        const estado =
          evento.ocorreu === true ? "em vigor" : evento.ocorreu === false ? "ainda sem efeito" : "a confirmar";
        console.log(
          `  ${evento.tipo} por ${evento.origem}${evento.operador ?? ""}${alcance ? ` (${alcance})` : ""}: efeito ${efeito} → ${estado}`,
        );
      }
      for (const pendencia of resultado.pendencias) console.log(`  pendência: ${pendencia}`);
      for (const t of transicoes) {
        const fim =
          t.fim === "sem-prazo" ? "sem prazo" : (t.fim_em ?? `${t.fim} a partir de ${t.inicio} (a confirmar)`);
        console.log(`  transição ${t.id} (${t.norma}${t.dispositivo}, ${t.tipo}): ${t.situacao}; fim: ${fim}`);
        console.log(`    ${t.regra}`);
      }
    });

  programa
    .command("relacoes")
    .description(
      "Relações de base-conhecimento/relacoes.yaml de uma norma, ou propostas do regex ainda não registradas.",
    )
    .argument("[id]", "ID da norma")
    .option("--propor", "lista propostas do regex (Ficam revogados, passa a vigorar...) ainda não confirmadas")
    .option("--json", "saída em JSON")
    .action((id: string | undefined, opcoes: { propor?: boolean; json?: boolean }) => {
      if (opcoes.propor) {
        const propostas = proporRelacoes();
        if (opcoes.json) return json(propostas);
        console.log(`${propostas.length} propostas não registradas nem descartadas em relacoes.yaml`);
        for (const p of propostas)
          console.log(`  ${p.tipo} ${p.origem}${p.operador} → ${p.alvos.join(", ") || "?"}: ${p.trecho}`);
        return;
      }
      if (!id) programa.error("informe o ID da norma ou --propor");
      const ato = exigirIdNorma(programa, id!);
      const relacoes = relacoesDe(ato);
      if (opcoes.json) return json({ id: ato, ...relacoes });
      for (const r of relacoes.saida) {
        console.log(
          `  ${ato}${r.operador ?? ""} ${r.tipo} ${r.alvo}${r.alvo_dispositivo ?? ""}${r.alcance ? ` (${r.alcance})` : ""}`,
        );
      }
      for (const r of relacoes.entrada) {
        console.log(
          `  ${r.origem}${r.operador ?? ""} ${r.tipo} ${ato}${r.alvo_dispositivo ?? ""}${r.alcance ? ` (${r.alcance})` : ""}`,
        );
      }
    });

  programa
    .command("correspondencia")
    .description(
      "Dispositivos da norma sucessora que correspondem a um dispositivo (tabela de correspondência, rascunho).",
    )
    .argument("<id>", "ID com dispositivo, como br/cne-cp/res/2021/1#art20 (sem dispositivo: todos os artigos)")
    .option("--json", "saída em JSON")
    .action((id: string, opcoes: { json?: boolean }) => {
      exigirIdNorma(programa, id);
      const resultados = comBanco((db) => correspondenciaEm(id, fonteCorrespondenciaBanco(db)));
      if (opcoes.json) return json(resultados);
      if (resultados.length === 0) {
        console.log(`sem tabela de correspondência para ${id}`);
        process.exitCode = 1;
        return;
      }
      for (const r of resultados) {
        console.log(
          `${r.id} → ${r.destino_ato}: ${r.item.tipo}${r.herdado_de ? ` (herdado de ${r.herdado_de})` : ""} [${r.status}]`,
        );
        for (const d of r.textos_destino) console.log(`  ${d.id}: ${d.texto ?? "(texto não encontrado)"}`);
        if (r.item.nota) console.log(`  nota: ${r.item.nota}`);
        for (const detalhe of r.detalhes) {
          console.log(
            `  ${detalhe.origem} → ${detalhe.destino.join(", ") || "—"}: ${detalhe.tipo}${detalhe.nota ? `; ${detalhe.nota}` : ""}`,
          );
        }
      }
      console.log(`\nTabela ${resultados[0]!.tabela}: rascunho sem revisão jurídica.`);
    });

  programa
    .command("impacto")
    .description("Fichas, validações cruzadas, textos das skills, normas e PPCs afetados por mudança na norma.")
    .argument("<id>", "ID da norma, como br/cne-cp/res/2021/1")
    .option("--json", "saída em JSON")
    .option("--sem-ppcs", "não lista os PPCs que citam a norma (mais rápido)")
    .option("--conteudo <dir>", "raiz alternativa dos arquivos de conteúdo das skills (ex.: git archive de um commit)")
    .action((id: string, opcoes: { json?: boolean; semPpcs?: boolean; conteudo?: string }) => {
      exigirIdNorma(programa, id);
      const resultado = impacto(id, {
        incluirPpcs: !opcoes.semPpcs,
        ...(opcoes.conteudo ? { raizConteudo: opcoes.conteudo } : {}),
      });
      if (opcoes.json) return json(resultado);
      console.log(`${resultado.titulo ?? id} (${id}): ${resultado.status} em ${resultado.data_referencia}`);
      if (resultado.sucessoras.length) console.log(`  sucessora(s): ${resultado.sucessoras.join(", ")}`);
      if (resultado.transicoes.length) console.log(`  regras de transição: ${resultado.transicoes.join(", ")}`);
      for (const r of resultado.relacoes) {
        console.log(`  relação: ${r.origem}${r.operador ?? ""} ${r.tipo} ${r.alvo}${r.alvo_dispositivo ?? ""}`);
      }
      for (const n of resultado.normas_que_citam)
        console.log(`  norma que a cita: ${n.id} (${n.dispositivos.join(", ")})`);
      const porMotivo = (motivo: string) => resultado.arquivos.filter((a) => a.motivos.includes(motivo as never));
      const estritos = resultado.arquivos.filter((a) => a.motivos.some((m) => m !== "tema"));
      console.log(`\nArquivos das skills citando a norma ou dispositivos correspondentes: ${estritos.length}`);
      for (const a of estritos) {
        console.log(
          `  ${a.arquivo} [${a.motivos.join(", ")}]${a.dispositivos.length ? ` ${a.dispositivos.join(" ")}` : ""}`,
        );
      }
      const tematicos = porMotivo("tema").filter((a) => !estritos.includes(a));
      console.log(
        `\nFichas só por tema (${resultado.topicos_atingidos.length} tópicos atingidos): ${tematicos.length}`,
      );
      for (const a of tematicos) console.log(`  ${a.arquivo} (${a.topicos?.join(", ")})`);
      console.log(`\nPPCs que citam a norma: ${opcoes.semPpcs ? "não consultado" : resultado.ppcs.total}`);
    });
}
