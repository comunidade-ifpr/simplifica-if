/**
 * Comandos da CLI `kb` sobre PPCs e cursos:
 *
 *   pnpm kb citacoes br/cne-cp/res/2021/1 [--json] [--confianca-min 0.8]
 *   pnpm kb buscar-secoes "<consulta>" [--json] [--tipo T]... [--nivel N] [--campus C] [--cnct X] [--forma F] [--ppc P] [--modo M] [--integral]
 *   pnpm kb cursos [--json] [--eixo E] [--turno T] [--campus C] [--nivel N] [--forma F] [--situacao S] [--cnct X] [--processo P]
 *   pnpm kb adequacao-art71 [--json] [--incluir-tecnologia]
 *   pnpm kb ppc-fatos [<ppc>] [--json] [--divergencias] [--nivel N]
 *   pnpm kb pacote-contexto <tarefa> <ppc> [--json]
 *   pnpm kb avaliar-busca [--json]
 *
 * Cada comando chama o serviço (`Ppcs`, `Cursos`, `PacoteContexto`) e formata a saída.
 */
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Argument from "effect/cli/Argument";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import * as Cursos from "../Cursos.ts";
import * as PacoteContexto from "../PacoteContexto.ts";
import * as Ppcs from "../Ppcs.ts";
import { INDICADORES, ROTULOS_INDICADOR } from "../adequacao/art71.ts";
import { avaliarBusca } from "../avaliacao/busca-secoes.ts";
import type { PacoteContexto as Pacote } from "../db/pacote-contexto.ts";
import {
  camadaRepositorio,
  exigirIdNorma,
  flagJson,
  flagLigada,
  flagLimite,
  flagTexto,
  imprimir,
  paraJson,
  paraJsonCompacto,
} from "./comum.ts";

const valor = <A>(opcao: Option.Option<A>): A | undefined => Option.getOrUndefined(opcao);

export const citacoes = Command.make(
  "citacoes",
  {
    id: Argument.String("id").pipe(
      Argument.withDescription("ID canônico, como br/cne-cp/res/2021/1 (aceita #dispositivo)"),
    ),
    json: flagJson,
    confiancaMin: Flag.Finite("confianca-min").pipe(
      Flag.withDescription("ignora citações com confiança menor"),
      Flag.filter(
        (n) => n >= 0 && n <= 1,
        () => "use um número entre 0 e 1",
      ),
      Flag.withDefault(0),
    ),
  },
  Effect.fn("kb.citacoes")(function* ({ id, json, confiancaMin }) {
    yield* exigirIdNorma(id, { aceitarExterno: true });
    const ppcs = yield* Ppcs.Ppcs;
    const relatorio = yield* ppcs.relatorioCitacoes(id, { confiancaMinima: confiancaMin });
    if (json) return yield* Console.log(paraJson(relatorio));
    const linhas = [
      `${id}${relatorio.titulo !== null ? ` — ${relatorio.titulo}` : ""}: ${relatorio.total_ppcs} PPCs, ${relatorio.total_ocorrencias} ocorrências`,
    ];
    for (const ppc of relatorio.ppcs) {
      linhas.push(`\n${ppc.ppc} (${ppc.nivel}, ${ppc.tipo_oferta})`);
      for (const o of ppc.ocorrencias) {
        const dispositivo = o.dispositivos?.join(" ") ?? o.dispositivoId ?? "";
        linhas.push(`  L${o.linha} [${o.regra} ${o.confianca}] ${o.trecho}${dispositivo ? ` ${dispositivo}` : ""}`);
      }
    }
    yield* imprimir(linhas);
  }, Effect.provide(camadaRepositorio)),
).pipe(Command.withDescription("Lista os PPCs convertidos que citam a norma <id>, com linha, trecho e regra."));

export const buscarSecoes = Command.make(
  "buscar-secoes",
  {
    partes: Argument.String("consulta").pipe(
      Argument.withDescription("termos da busca"),
      Argument.variadic({ min: 1 }),
    ),
    json: flagJson,
    tipo: Flag.String("tipo").pipe(
      Flag.withDescription("tipo de seção (repetível), como estagio_praticas"),
      Flag.atLeast(0),
    ),
    nivel: flagTexto("nivel", "médio, superior, pós-graduação…"),
    campus: flagTexto("campus", "campus_id, como curitiba"),
    cnct: flagTexto("cnct", "habilitação do CNCT (cnct:tecnico-em-enfermagem ou só o slug)"),
    forma: flagTexto("forma", "integrado, subsequente, bacharelado…"),
    ppc: flagTexto("ppc", "um PPC (campus/curso ou ppc:campus/curso)"),
    limite: flagLimite("máximo de seções"),
    modo: Flag.Literals("modo", ["simples", "radicais", "completo"]).pipe(
      Flag.withDescription("simples, radicais ou completo"),
      Flag.withDefault("completo"),
    ),
    integral: flagLigada("integral", "inclui o texto integral de cada seção"),
  },
  Effect.fn("kb.buscarSecoes")(function* (o) {
    const ppcs = yield* Ppcs.Ppcs;
    const consulta = o.partes.join(" ");
    const filtros = {
      tipo: o.tipo.length ? [...o.tipo] : undefined,
      nivel: valor(o.nivel),
      campus: valor(o.campus),
      cnct: valor(o.cnct),
      forma: valor(o.forma),
      ppc: valor(o.ppc),
    };
    const resultados = yield* ppcs.buscarSecoes(consulta, filtros, {
      limite: o.limite,
      modo: o.modo,
      integral: o.integral,
    });
    if (o.json) {
      return yield* Console.log(paraJson({ consulta, filtros, modo: o.modo, total: resultados.length, resultados }));
    }
    const linhas: string[] = [];
    for (const r of resultados) {
      linhas.push(`${r.ppc} [${r.tipo}] ${r.titulo} — ${r.path}:${r.linha_inicio}-${r.linha_fim} (${r.pontuacao})`);
      for (const l of r.trecho) {
        linhas.push(`    L${l.linha}: ${l.texto.length > 220 ? `${l.texto.slice(0, 220)}…` : l.texto}`);
      }
    }
    yield* imprimir(linhas);
  }, Effect.provide(camadaRepositorio)),
).pipe(
  Command.withDescription(
    "Busca seções de PPC (FTS5 + radicais + sinônimos por tipo de seção), com filtros; devolve as linhas literais com arquivo e linha.",
  ),
);

export const cursos = Command.make(
  "cursos",
  {
    json: flagJson,
    eixo: flagTexto("eixo", "eixo tecnológico do CNCT, como 'Informação e Comunicação'"),
    turno: flagTexto("turno", "turno padronizado da oferta (matutino, noturno, integral…)"),
    campus: flagTexto("campus", "campus_id"),
    nivel: flagTexto("nivel", "médio, superior…"),
    forma: flagTexto("forma", "integrado, subsequente…"),
    situacao: flagTexto("situacao", "ativo, suspenso…"),
    cnct: flagTexto("cnct", "habilitação do CNCT"),
    processo: flagTexto("processo", "processo seletivo das ofertas, como processo-seletivo-2026"),
  },
  Effect.fn("kb.cursos")(function* (o) {
    const servico = yield* Cursos.Cursos;
    const filtros = {
      eixo: valor(o.eixo),
      turno: valor(o.turno),
      campus: valor(o.campus),
      nivel: valor(o.nivel),
      forma: valor(o.forma),
      situacao: valor(o.situacao),
      cnct: valor(o.cnct),
      processo: valor(o.processo),
    };
    const lista = yield* servico.listar(filtros);
    if (o.json) return yield* Console.log(paraJson({ filtros, total: lista.length, cursos: lista }));
    const linhas = lista.map((c) => {
      const turnos = [...new Set(c.ofertas.map((of) => of.turno ?? "?"))].join(", ");
      return `${c.id} — ${c.nome} (${c.forma_oferta ?? "?"}, ${c.situacao ?? "?"})${c.cnct ? ` [${c.cnct.eixo_tecnologico}]` : ""}${turnos ? ` turnos: ${turnos}` : ""} — ${c.path}`;
    });
    linhas.push(`${lista.length} cursos`);
    yield* imprimir(linhas);
  }, Effect.provide(camadaRepositorio)),
).pipe(Command.withDescription("Cursos de dados/institucional com CNCT (eixo) e ofertas (turno), com filtros."));

export const adequacaoArt71 = Command.make(
  "adequacao-art71",
  {
    json: flagJson,
    incluirTecnologia: flagLigada(
      "incluir-tecnologia",
      "inclui os cursos superiores de tecnologia (o art. 71 também os alcança)",
    ),
  },
  Effect.fn("kb.adequacaoArt71")(function* ({ json, incluirTecnologia }) {
    const servico = yield* Cursos.Cursos;
    const relatorio = yield* servico.adequacaoArt71({ incluirTecnologia });
    if (json) return yield* Console.log(paraJson(relatorio));
    const linhas = [`Art. 71 da Res. CNE/CP nº 2/2026: ${relatorio.total} cursos alcançados`, relatorio.criterio, ""];
    for (const indicador of INDICADORES) {
      linhas.push(`${String(relatorio.totais[indicador]).padStart(4)}  ${ROTULOS_INDICADOR[indicador]}`);
    }
    for (const indicador of INDICADORES) {
      const doIndicador = relatorio.cursos.filter((curso) => curso.indicador === indicador);
      if (doIndicador.length === 0) continue;
      linhas.push(`\n## ${ROTULOS_INDICADOR[indicador]} (${doIndicador.length})`);
      for (const curso of doIndicador) {
        const ano = curso.ppc_ano ? ` PPC ${curso.ppc_ano}` : "";
        linhas.push(`  ${curso.curso} — ${curso.nome} (${curso.forma_oferta ?? "?"}${ano})`);
      }
    }
    yield* imprimir(linhas);
  }, Effect.provide(camadaRepositorio)),
).pipe(
  Command.withDescription(
    "Cursos técnicos em oferta sujeitos ao art. 71 da Res. CNE/CP nº 2/2026, com a DCN que o PPC cita.",
  ),
);

export const ppcFatos = Command.make(
  "ppc-fatos",
  {
    ppc: Argument.String("ppc").pipe(
      Argument.withDescription("campus/curso ou ppc:campus/curso (sem ele, todos)"),
      Argument.optional,
    ),
    json: flagJson,
    divergencias: flagLigada("divergencias", "só os PPCs com divergência PPC × SUAP, com os totais por aspecto"),
    nivel: flagTexto("nivel", "filtra por nível, como médio"),
  },
  Effect.fn("kb.ppcFatos")(function* ({ ppc, json, divergencias, nivel }) {
    const ppcs = yield* Ppcs.Ppcs;
    const filtros = {
      ...(Option.isSome(ppc) && ppc.value ? { ppc: ppc.value } : {}),
      ...(Option.isSome(nivel) && nivel.value ? { nivel: nivel.value } : {}),
    };
    if (divergencias) {
      const resultado = yield* ppcs.divergencias(filtros);
      if (json) return yield* Console.log(paraJson({ filtros, ...resultado, total_ppcs: resultado.ppcs.length }));
      const linhas: string[] = [];
      for (const [aspecto, totais] of Object.entries(resultado.totais)) {
        linhas.push(
          `${aspecto}: ${Object.entries(totais)
            .map(([r, n]) => `${r} ${n}`)
            .join(", ")}`,
        );
      }
      for (const p of resultado.ppcs) {
        linhas.push(`\n${p.ppc} — ${p.nome} (${p.campus})`);
        for (const c of p.cruzamento) linhas.push(`  ${c.aspecto}: ${c.resultado} — ${c.explicacao}`);
        const prefixos = p.cruzamento.map((c) => (c.aspecto === "carga_horaria" ? "carga" : c.aspecto));
        for (const f of p.fatos.filter((fato) => prefixos.some((prefixo) => fato.fato.startsWith(prefixo)))) {
          linhas.push(
            `    ${f.fato} = ${f.valor} [${f.status_curadoria}] ${f.path}:${f.linha}: ${f.trecho_fonte.slice(0, 160)}`,
          );
        }
      }
      return yield* imprimir(linhas);
    }
    const resultado = yield* ppcs.fatos(filtros);
    if (json) return yield* Console.log(paraJson({ filtros, total: resultado.length, ppcs: resultado }));
    const linhas: string[] = [];
    for (const p of resultado) {
      linhas.push(`${p.ppc} — ${p.nome} (${p.campus})`);
      for (const f of p.fatos) linhas.push(`  ${f.fato} = ${f.valor} [${f.status_curadoria}] ${f.path}:${f.linha}`);
      for (const c of p.cruzamento) linhas.push(`  SUAP ${c.aspecto}: ${c.resultado} — ${c.explicacao}`);
    }
    yield* imprimir(linhas);
  }, Effect.provide(camadaRepositorio)),
).pipe(
  Command.withDescription(
    "Fatos extraídos do PPC (carga horária total, estágio obrigatório e carga, ano) com trecho de origem, cruzados com o SUAP.",
  ),
);

/** Normas, marcos, transições e seções de um pacote, em texto. */
function linhasDasPartes(
  pacote: Pick<Pacote, "normas" | "marcos" | "data_referencia" | "transicoes" | "secoes">,
): string[] {
  return [
    `normas: ${pacote.normas.map((n) => `${n.ref} (${n.dispositivos.map((d) => d.id.slice(d.id.indexOf("#"))).join(", ") || "sem dispositivo"})`).join("; ")}`,
    `marcos: ${pacote.marcos.map((m) => m.marco).join(", ") || "nenhum"}`,
    `transições em ${pacote.data_referencia}: ${pacote.transicoes.map((t) => `${t.id} (${t.situacao})`).join(", ") || "nenhuma"}`,
    ...pacote.secoes.map(
      (s) => `  ${s.path}:${s.linha_inicio}-${s.linha_fim} [${s.tipo}] ${s.titulo} (${s.motivo.join("; ")})`,
    ),
  ];
}

export const pacoteContexto = Command.make(
  "pacote-contexto",
  {
    tarefa: Argument.String("tarefa").pipe(
      Argument.withDescription("CT-CURR-12, CT-CURR-12,CT-IDENT-01, estagio, grupo-001 ou todas"),
    ),
    ppc: Argument.String("ppc").pipe(
      Argument.withDescription("campus/curso, ppc:campus/curso ou um arquivo .md (PPC fora da base)"),
    ),
    json: flagJson,
  },
  Effect.fn("kb.pacoteContexto")(function* ({ tarefa, ppc, json }) {
    const servico = yield* PacoteContexto.PacoteContexto;
    const fs = yield* FileSystem.FileSystem;
    if (ppc.toLowerCase().endsWith(".md") && (yield* fs.exists(ppc))) {
      const markdown = yield* fs.readFileString(ppc);
      const pacote = yield* servico.doMarkdown(tarefa, ppc, markdown);
      if (json) return yield* Console.log(paraJson(pacote));
      return yield* imprimir([
        `${pacote.path} (fora da base); fichas: ${pacote.fichas_ids.join(", ")}`,
        ...linhasDasPartes(pacote),
        `tamanho: ${pacote.tamanho.caracteres} caracteres (${pacote.secoes.length} seções; PPC inteiro: ${pacote.tamanho.caracteres_ppc_inteiro})`,
      ]);
    }
    const pacote = yield* servico.montar(tarefa, ppc);
    if (json) return yield* Console.log(paraJson(pacote));
    yield* imprimir([
      `${pacote.ppc.id} — ${pacote.ppc.curso_nome}; fichas: ${pacote.fichas_ids.join(", ")}`,
      ...linhasDasPartes(pacote),
      `tamanho: ${pacote.tamanho.caracteres} caracteres (${pacote.tamanho.secoes} seções, ${pacote.tamanho.caracteres_secoes} caracteres de seção; PPC inteiro: ${pacote.tamanho.caracteres_ppc_inteiro})`,
    ]);
  }, Effect.provide(camadaRepositorio)),
).pipe(
  Command.withDescription(
    "Contexto de uma tarefa da revisar-ppc (ficha, tópico, grupo-NNN ou todas) para um PPC: CNCT, fichas, dispositivos citados, marcos, regras de transição, seções relevantes e fatos.",
  ),
);

export const avaliarBuscaCmd = Command.make(
  "avaliar-busca",
  { json: flagJson },
  Effect.fn("kb.avaliarBusca")(function* ({ json }) {
    const resultado = yield* avaliarBusca();
    if (json) return yield* Console.log(paraJson(resultado));
    const linhas = [`${resultado.consultas} consultas, recall@${resultado.k} (meta ${resultado.meta}):`];
    for (const [m, v] of Object.entries(resultado.recall)) linhas.push(`  ${m.padEnd(9)} ${v}`);
    for (const d of resultado.detalhes) {
      const perdas = Object.entries(d.faltando).filter(([, l]) => l.length);
      if (!perdas.length) continue;
      linhas.push(`${d.id} "${d.consulta}" ${paraJsonCompacto(d.recall)}`);
      for (const [m, l] of perdas) for (const x of l) linhas.push(`    ${m}: falta ${x}`);
    }
    yield* imprimir(linhas);
  }, Effect.provide(camadaRepositorio)),
).pipe(
  Command.withDescription(
    "Recall@10 da busca de seções no conjunto rotulado (avaliacao/busca-secoes/), com e sem stemmer e sinônimos.",
  ),
);
