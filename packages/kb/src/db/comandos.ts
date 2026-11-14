/**
 * Comandos da CLI `kb` que consultam o `kb.sqlite` (fase 6). Registrados por `registrarComandosBanco`
 * em `cli.ts`; o banco é aberto (e recompilado, se velho) só quando um deles roda.
 *
 *   bun run kb buscar-norma "<consulta ou citação>" [--json] [--limite N] [--situacao base|stub|externo] [--vigentes [--em AAAA-MM-DD]]
 *   bun run kb buscar-secoes "<consulta>" [--json] [--tipo T]... [--nivel N] [--campus C] [--cnct X] [--forma F] [--ppc P] [--modo M] [--integral]
 *   bun run kb cursos [--json] [--eixo E] [--turno T] [--campus C] [--nivel N] [--forma F] [--situacao S] [--cnct X] [--processo P]
 *   bun run kb ppc-fatos [<ppc>] [--json] [--divergencias] [--nivel N]
 *   bun run kb pacote-contexto <tarefa> <ppc> [--json]
 *   bun run kb avaliar-busca [--json]
 */
import type { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { type Command, InvalidArgumentError } from "commander";
import { lerSinonimos } from "../busca/sinonimos.ts";
import { avaliarBusca } from "../avaliacao/busca-secoes.ts";
import { raizRepositorio } from "../normas/registro.ts";
import { abrirBanco } from "./banco.ts";
import {
  buscarNorma,
  buscarSecoes,
  divergenciasPpcSuap,
  fatosDosPpcs,
  listarCursos,
  type ModoBusca,
} from "./consultas.ts";
import { type PacoteContexto, pacoteContexto, pacoteDoMarkdown } from "./pacote-contexto.ts";

function json(valor: unknown): void {
  process.stdout.write(`${JSON.stringify(valor, null, 2)}\n`);
}

function inteiroPositivo(valor: string): number {
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) throw new InvalidArgumentError("use um inteiro positivo");
  return n;
}

function acumular(valor: string, anteriores: string[] = []): string[] {
  return [...anteriores, valor];
}

function dataIso(valor: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) throw new InvalidArgumentError("use AAAA-MM-DD");
  return valor;
}

function modo(valor: string): ModoBusca {
  if (valor !== "simples" && valor !== "radicais" && valor !== "completo") {
    throw new InvalidArgumentError("use simples, radicais ou completo");
  }
  return valor;
}

/** Normas, marcos, transições e seções de um pacote, em texto. */
function imprimirPartes(
  pacote: Pick<PacoteContexto, "normas" | "marcos" | "data_referencia" | "transicoes" | "secoes">,
): void {
  console.log(
    `normas: ${pacote.normas.map((n) => `${n.ref} (${n.dispositivos.map((d) => d.id.slice(d.id.indexOf("#"))).join(", ") || "sem dispositivo"})`).join("; ")}`,
  );
  console.log(`marcos: ${pacote.marcos.map((m) => m.marco).join(", ") || "nenhum"}`);
  console.log(
    `transições em ${pacote.data_referencia}: ${pacote.transicoes.map((t) => `${t.id} (${t.situacao})`).join(", ") || "nenhuma"}`,
  );
  for (const s of pacote.secoes)
    console.log(`  ${s.path}:${s.linha_inicio}-${s.linha_fim} [${s.tipo}] ${s.titulo} (${s.motivo.join("; ")})`);
}

function comBanco<T>(acao: (db: Database) => T): T {
  const db = abrirBanco();
  try {
    return acao(db);
  } finally {
    db.close();
  }
}

/** Uma linha por trecho, com o caminho e a linha, para a saída em texto. */
function indentar(texto: string, prefixo = "    "): string {
  return texto
    .split("\n")
    .map((l) => `${prefixo}${l}`)
    .join("\n");
}

export function registrarComandosBanco(programa: Command): void {
  programa
    .command("buscar-norma")
    .description(
      "Busca normas: uma citação ou ID ('Res. CNE/CP 2/2026, art. 28, VII') vai direto ao dispositivo; senão, busca textual com radicais nos metadados das normas e nos dispositivos (com o caput herdado).",
    )
    .argument("<consulta...>", "citação, ID ou termos")
    .option("--json", "saída em JSON")
    .option("--limite <n>", "máximo de resultados", inteiroPositivo, 10)
    .option("--situacao <s>", "base, stub ou externo")
    .option("--vigentes", "exclui atos revogados ou ainda não vigentes na data e dispositivos revogados")
    .option("--em <data>", "data da vigência para --vigentes (padrão: data_referencia)", dataIso)
    .action(
      (partes: string[], o: { json?: boolean; limite: number; situacao?: string; vigentes?: boolean; em?: string }) => {
        const consulta = partes.join(" ");
        const resultados = comBanco((db) =>
          buscarNorma(db, consulta, {
            limite: o.limite,
            ...(o.situacao ? { situacao: o.situacao } : {}),
            ...(o.vigentes ? { vigentes: true } : {}),
            ...(o.em ? { em: o.em } : {}),
          }),
        );
        if (o.json) return json({ consulta, total: resultados.length, resultados });
        const curto = (t: string) => (t.length > 600 ? `${t.slice(0, 600)}…` : t);
        for (const r of resultados) {
          const cabecalho = `${r.norma.titulo} [${r.norma.status_vigencia ?? r.norma.situacao}] (${r.origem}${r.pontuacao !== null ? ` ${r.pontuacao}` : ""})`;
          const d = r.dispositivo;
          if (d) {
            console.log(`${d.id} — ${cabecalho}${r.pedido ? ` — citado: ${r.pedido}, fora do texto` : ""}`);
            console.log(`  ${d.path}:${d.linha_inicio}-${d.linha_fim}${d.revogado ? " (revogado)" : ""}`);
            for (const caput of d.caput) console.log(indentar(`[caput] ${curto(caput)}`));
            console.log(indentar(curto([d.texto, ...d.subordinados.map((f) => f.texto)].join("\n"))));
          } else if (r.metadados) {
            console.log(`${r.norma.id} — ${cabecalho}`);
            console.log(`  metadados — ${r.metadados.path}:${r.metadados.linha}`);
            console.log(indentar(curto(r.metadados.texto)));
          }
        }
      },
    );

  programa
    .command("buscar-secoes")
    .description(
      "Busca seções de PPC (FTS5 + radicais + sinônimos por tipo de seção), com filtros; devolve as linhas literais com arquivo e linha.",
    )
    .argument("<consulta...>", "termos da busca")
    .option("--json", "saída em JSON")
    .option("--tipo <tipo>", "tipo de seção (repetível), como estagio_praticas", acumular)
    .option("--nivel <nivel>", "médio, superior, pós-graduação…")
    .option("--campus <campus>", "campus_id, como curitiba")
    .option("--cnct <id>", "habilitação do CNCT (cnct:tecnico-em-enfermagem ou só o slug)")
    .option("--forma <forma>", "integrado, subsequente, bacharelado…")
    .option("--ppc <ppc>", "um PPC (campus/curso ou ppc:campus/curso)")
    .option("--limite <n>", "máximo de seções", inteiroPositivo, 10)
    .option("--modo <modo>", "simples, radicais ou completo", modo, "completo")
    .option("--integral", "inclui o texto integral de cada seção")
    .action(
      (
        partes: string[],
        o: {
          json?: boolean;
          tipo?: string[];
          nivel?: string;
          campus?: string;
          cnct?: string;
          forma?: string;
          ppc?: string;
          limite: number;
          modo: ModoBusca;
          integral?: boolean;
        },
      ) => {
        const consulta = partes.join(" ");
        const filtros = { tipo: o.tipo, nivel: o.nivel, campus: o.campus, cnct: o.cnct, forma: o.forma, ppc: o.ppc };
        const resultados = comBanco((db) =>
          buscarSecoes(db, consulta, filtros, {
            limite: o.limite,
            modo: o.modo,
            lexico: lerSinonimos(),
            integral: o.integral ?? false,
          }),
        );
        if (o.json) return json({ consulta, filtros, modo: o.modo, total: resultados.length, resultados });
        for (const r of resultados) {
          console.log(`${r.ppc} [${r.tipo}] ${r.titulo} — ${r.path}:${r.linha_inicio}-${r.linha_fim} (${r.pontuacao})`);
          for (const l of r.trecho)
            console.log(`    L${l.linha}: ${l.texto.length > 220 ? `${l.texto.slice(0, 220)}…` : l.texto}`);
        }
      },
    );

  programa
    .command("cursos")
    .description("Cursos de dados/institucional com CNCT (eixo) e ofertas (turno), com filtros.")
    .option("--json", "saída em JSON")
    .option("--eixo <eixo>", "eixo tecnológico do CNCT, como 'Informação e Comunicação'")
    .option("--turno <turno>", "turno padronizado da oferta (matutino, noturno, integral…)")
    .option("--campus <campus>", "campus_id")
    .option("--nivel <nivel>", "médio, superior…")
    .option("--forma <forma>", "integrado, subsequente…")
    .option("--situacao <situacao>", "ativo, suspenso…")
    .option("--cnct <id>", "habilitação do CNCT")
    .option("--processo <id>", "processo seletivo das ofertas, como processo-seletivo-2026")
    .action(
      (o: {
        json?: boolean;
        eixo?: string;
        turno?: string;
        campus?: string;
        nivel?: string;
        forma?: string;
        situacao?: string;
        cnct?: string;
        processo?: string;
      }) => {
        const { json: emJson, ...filtros } = o;
        const cursos = comBanco((db) => listarCursos(db, filtros));
        if (emJson) return json({ filtros, total: cursos.length, cursos });
        for (const c of cursos) {
          const turnos = [...new Set(c.ofertas.map((of) => of.turno ?? "?"))].join(", ");
          console.log(
            `${c.id} — ${c.nome} (${c.forma_oferta ?? "?"}, ${c.situacao ?? "?"})${c.cnct ? ` [${c.cnct.eixo_tecnologico}]` : ""}${turnos ? ` turnos: ${turnos}` : ""} — ${c.path}`,
          );
        }
        console.log(`${cursos.length} cursos`);
      },
    );

  programa
    .command("ppc-fatos")
    .description(
      "Fatos extraídos do PPC (carga horária total, estágio obrigatório e carga, ano) com trecho de origem, cruzados com o SUAP.",
    )
    .argument("[ppc]", "campus/curso ou ppc:campus/curso (sem ele, todos)")
    .option("--json", "saída em JSON")
    .option("--divergencias", "só os PPCs com divergência PPC × SUAP, com os totais por aspecto")
    .option("--nivel <nivel>", "filtra por nível, como médio")
    .action((ppc: string | undefined, o: { json?: boolean; divergencias?: boolean; nivel?: string }) => {
      const filtros = { ...(ppc ? { ppc } : {}), ...(o.nivel ? { nivel: o.nivel } : {}) };
      if (o.divergencias) {
        const resultado = comBanco((db) => divergenciasPpcSuap(db, filtros));
        if (o.json) return json({ filtros, ...resultado, total_ppcs: resultado.ppcs.length });
        for (const [aspecto, totais] of Object.entries(resultado.totais)) {
          console.log(
            `${aspecto}: ${Object.entries(totais)
              .map(([r, n]) => `${r} ${n}`)
              .join(", ")}`,
          );
        }
        for (const p of resultado.ppcs) {
          console.log(`\n${p.ppc} — ${p.nome} (${p.campus})`);
          for (const c of p.cruzamento) console.log(`  ${c.aspecto}: ${c.resultado} — ${c.explicacao}`);
          const prefixos = p.cruzamento.map((c) => (c.aspecto === "carga_horaria" ? "carga" : c.aspecto));
          for (const f of p.fatos.filter((fato) => prefixos.some((prefixo) => fato.fato.startsWith(prefixo)))) {
            console.log(
              `    ${f.fato} = ${f.valor} [${f.status_curadoria}] ${f.path}:${f.linha}: ${f.trecho_fonte.slice(0, 160)}`,
            );
          }
        }
        return;
      }
      const resultado = comBanco((db) => fatosDosPpcs(db, filtros));
      if (o.json) return json({ filtros, total: resultado.length, ppcs: resultado });
      for (const p of resultado) {
        console.log(`${p.ppc} — ${p.nome} (${p.campus})`);
        for (const f of p.fatos) console.log(`  ${f.fato} = ${f.valor} [${f.status_curadoria}] ${f.path}:${f.linha}`);
        for (const c of p.cruzamento) console.log(`  SUAP ${c.aspecto}: ${c.resultado} — ${c.explicacao}`);
      }
    });

  programa
    .command("pacote-contexto")
    .description(
      "Contexto de uma tarefa da analise-ppc (ficha, tópico, grupo-NNN ou todas) para um PPC: CNCT, fichas, dispositivos citados, marcos, regras de transição, seções relevantes e fatos.",
    )
    .argument("<tarefa>", "CT-CURR-12, CT-CURR-12,CT-IDENT-01, estagio, grupo-001 ou todas")
    .argument("<ppc>", "campus/curso, ppc:campus/curso ou um arquivo .md (PPC fora da base)")
    .option("--json", "saída em JSON (o pacote inteiro)")
    .action((tarefa: string, ppc: string, o: { json?: boolean }) => {
      if (ppc.toLowerCase().endsWith(".md") && existsSync(ppc)) {
        const pacote = comBanco((db) =>
          pacoteDoMarkdown(db, tarefa, ppc, { lexico: lerSinonimos(), raiz: raizRepositorio() }),
        );
        if (o.json) return json(pacote);
        console.log(`${pacote.path} (fora da base); fichas: ${pacote.fichas_ids.join(", ")}`);
        imprimirPartes(pacote);
        console.log(
          `tamanho: ${pacote.tamanho.caracteres} caracteres (${pacote.secoes.length} seções; PPC inteiro: ${pacote.tamanho.caracteres_ppc_inteiro})`,
        );
        return;
      }
      const pacote = comBanco((db) =>
        pacoteContexto(db, tarefa, ppc, { lexico: lerSinonimos(), raiz: raizRepositorio() }),
      );
      if (o.json) return json(pacote);
      console.log(`${pacote.ppc.id} — ${pacote.ppc.curso_nome}; fichas: ${pacote.fichas_ids.join(", ")}`);
      imprimirPartes(pacote);
      console.log(
        `tamanho: ${pacote.tamanho.caracteres} caracteres (${pacote.tamanho.secoes} seções, ${pacote.tamanho.caracteres_secoes} caracteres de seção; PPC inteiro: ${pacote.tamanho.caracteres_ppc_inteiro})`,
      );
    });

  programa
    .command("avaliar-busca")
    .description(
      "Recall@10 da busca de seções no conjunto rotulado (avaliacao/busca-secoes/), com e sem stemmer e sinônimos.",
    )
    .option("--json", "saída em JSON")
    .action((o: { json?: boolean }) => {
      const resultado = comBanco((db) => avaliarBusca(db, { lexico: lerSinonimos() }));
      if (o.json) return json(resultado);
      console.log(`${resultado.consultas} consultas, recall@${resultado.k} (meta ${resultado.meta}):`);
      for (const [m, v] of Object.entries(resultado.recall)) console.log(`  ${m.padEnd(9)} ${v}`);
      for (const d of resultado.detalhes) {
        const perdas = Object.entries(d.faltando).filter(([, l]) => l.length);
        if (!perdas.length) continue;
        console.log(`${d.id} "${d.consulta}" ${JSON.stringify(d.recall)}`);
        for (const [m, l] of perdas) for (const x of l) console.log(`    ${m}: falta ${x}`);
      }
    });
}
