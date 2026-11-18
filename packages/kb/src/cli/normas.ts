/**
 * Comandos da CLI `kb` sobre normas:
 *
 *   pnpm kb resolver "Resolução CNE/CP nº 1/2021, art. 20" [--json]
 *   pnpm kb buscar-norma "<consulta ou citação>" [--json] [--limite N] [--situacao base|stub|externo] [--vigentes [--em AAAA-MM-DD]]
 *   pnpm kb dispositivo br/cne-cp/res/2026/2#art71-parunico [--json] [--filhos]
 *   pnpm kb vigencia br/cne-cp/res/2021/1 [--em 2026-11-01] [--json]
 *   pnpm kb relacoes br/lei/1996/9394 [--json]
 *   pnpm kb relacoes --propor [--json]
 *   pnpm kb correspondencia br/cne-cp/res/2021/1#art20 [--json]
 *   pnpm kb impacto br/cne-cp/res/2021/1 [--json] [--sem-ppcs] [--conteudo <dir>]
 *   pnpm kb avaliar-resolvedor [--json]
 *
 * Cada comando chama o serviço (`Normas`, `Impacto`) e formata a saída. As saídas não dependem do
 * relógio: a data é `--em` ou a `data_referencia` de `base-conhecimento/config/vigencia.yaml`.
 * `avaliar-resolvedor` e `relacoes --propor` são curadoria e leem os arquivos direto.
 */
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Argument from "effect/cli/Argument";
import * as Command from "effect/cli/Command";
import * as FontesNormativas from "../FontesNormativas.ts";
import * as Impacto from "../Impacto.ts";
import * as Normas from "../Normas.ts";
import { avaliarResolvedor, lerAnotacoes } from "../avaliacao/resolvedor.ts";
import { carregarRegistro } from "../normas/registro.ts";
import { proporRelacoes } from "../normas/relacoes.ts";
import { EncerrarComCodigo } from "../principal.ts";
import {
  camadaRepositorio,
  Checkout,
  EntradaInvalida,
  exigirIdNorma,
  FalhaNaCuradoria,
  flagData,
  flagJson,
  flagLigada,
  flagLimite,
  flagTexto,
  imprimir,
  paraJson,
} from "./comum.ts";

/** Uma linha por trecho, com recuo, para a saída em texto. */
function indentar(texto: string, prefixo = "    "): string {
  return texto
    .split("\n")
    .map((l) => `${prefixo}${l}`)
    .join("\n");
}

const curto = (t: string) => (t.length > 600 ? `${t.slice(0, 600)}…` : t);

export const resolver = Command.make(
  "resolver",
  {
    partes: Argument.String("texto").pipe(
      Argument.withDescription("citação, como 'Res. CNE/CP nº 1/2021, art. 20' ou uma URL do Planalto/DOU"),
      Argument.variadic({ min: 1 }),
    ),
    json: flagJson,
  },
  Effect.fn("kb.resolver")(function* ({ partes, json }) {
    const normas = yield* Normas.Normas;
    const resultado = yield* normas.resolver(partes.join(" "));
    if (json) return yield* Console.log(paraJson(resultado));
    if (!resultado.id) {
      yield* Console.log(`não resolvida (${resultado.regra})`);
      return yield* new EncerrarComCodigo({ codigo: 1 });
    }
    const linhas = [
      resultado.id +
        (resultado.dispositivos
          ? ` ${resultado.dispositivos.join(" ")}`
          : resultado.dispositivoId
            ? ` ${resultado.dispositivoId}`
            : ""),
      `  regra: ${resultado.regra}; confiança: ${resultado.confianca}; situação: ${resultado.situacao}`,
    ];
    if (resultado.titulo !== undefined) {
      linhas.push(`  ${resultado.titulo}${resultado.path ? ` — base-conhecimento/${resultado.path}` : ""}`);
    }
    yield* imprimir(linhas);
  }, Effect.provide(camadaRepositorio)),
).pipe(Command.withDescription("Resolve uma citação normativa para o ID canônico (e o dispositivo, se houver)."));

export const buscarNorma = Command.make(
  "buscar-norma",
  {
    partes: Argument.String("consulta").pipe(
      Argument.withDescription("citação, ID ou termos"),
      Argument.variadic({ min: 1 }),
    ),
    json: flagJson,
    limite: flagLimite("máximo de resultados"),
    situacao: flagTexto("situacao", "base, stub ou externo"),
    vigentes: flagLigada("vigentes", "exclui atos revogados ou ainda não vigentes na data e dispositivos revogados"),
    em: flagData("data da vigência para --vigentes (padrão: data_referencia)"),
  },
  Effect.fn("kb.buscarNorma")(function* ({ partes, json, limite, situacao, vigentes, em }) {
    const normas = yield* Normas.Normas;
    const consulta = partes.join(" ");
    const { resultados, avisos } = yield* normas.buscar(consulta, {
      limite,
      ...(Option.isSome(situacao) && situacao.value ? { situacao: situacao.value } : {}),
      ...(vigentes ? { vigentes: true } : {}),
      ...(Option.isSome(em) ? { em: em.value } : {}),
    });
    for (const aviso of avisos) yield* Console.error(`kb: ${aviso}`);
    if (json) {
      yield* Console.log(paraJson({ consulta, total: resultados.length, avisos, resultados }));
    } else {
      const linhas: string[] = [];
      for (const r of resultados) {
        const cabecalho = `${r.norma.titulo} [${r.norma.status_vigencia ?? r.norma.situacao}] (${r.origem}${r.pontuacao !== null ? ` ${r.pontuacao}` : ""})`;
        const d = r.dispositivo;
        if (d) {
          linhas.push(`${d.id} — ${cabecalho}${r.pedido ? ` — citado: ${r.pedido}, fora do texto` : ""}`);
          linhas.push(`  ${d.path}:${d.linha_inicio}-${d.linha_fim}${d.revogado ? " (revogado)" : ""}`);
          for (const caput of d.caput) linhas.push(indentar(`[caput] ${curto(caput)}`));
          linhas.push(indentar(curto([d.texto, ...d.subordinados.map((f) => f.texto)].join("\n"))));
        } else if (r.metadados) {
          linhas.push(`${r.norma.id} — ${cabecalho}`);
          linhas.push(`  metadados — ${r.metadados.path}:${r.metadados.linha}`);
          linhas.push(indentar(curto(r.metadados.texto)));
        }
      }
      yield* imprimir(linhas);
    }
    if (avisos.some((a) => a.startsWith("ID desconhecido"))) return yield* new EncerrarComCodigo({ codigo: 1 });
  }, Effect.provide(camadaRepositorio)),
).pipe(
  Command.withDescription(
    "Busca normas: uma citação ou ID ('Res. CNE/CP 2/2026, art. 28, VII') vai direto ao dispositivo; senão, busca textual com radicais nos metadados das normas e nos dispositivos (com o caput herdado).",
  ),
);

export const dispositivo = Command.make(
  "dispositivo",
  {
    id: Argument.String("id").pipe(
      Argument.withDescription("ID com dispositivo, como br/cne-cp/res/2026/2#art71-parunico"),
    ),
    json: flagJson,
    filhos: flagLigada("filhos", "inclui incisos, alíneas e parágrafos do dispositivo"),
  },
  Effect.fn("kb.dispositivo")(function* ({ id, json, filhos }) {
    yield* exigirIdNorma(id);
    const normas = yield* Normas.Normas;
    const achado = yield* normas.dispositivo(id);
    if (!achado) {
      yield* Console.log(json ? paraJson({ id, encontrado: false }) : `dispositivo não encontrado: ${id}`);
      return yield* new EncerrarComCodigo({ codigo: 1 });
    }
    const { disp } = achado;
    const titulo = (yield* normas.obter(disp.ato))?.titulo ?? disp.ato;
    const descendentes = filhos ? (yield* normas.descendentes(disp.id)).map((f) => f.disp) : [];
    // path relativo a base-conhecimento/, como no manifest
    const path = achado.path.replace(/^base-conhecimento\//, "");
    if (json) return yield* Console.log(paraJson({ ...disp, path, filhos: descendentes }));
    const linhas = [`${disp.id} — ${titulo}`, `  ${achado.path}:${disp.linha_inicio}-${disp.linha_fim}`];
    if (disp.estrutura.length) linhas.push(`  ${disp.estrutura.join(" › ")}`);
    for (const caput of disp.caput) linhas.push(`  [caput] ${caput}`);
    linhas.push(`\n${disp.texto}`);
    if (disp.revogado) linhas.push("\n(revogado)");
    for (const nota of disp.notas) linhas.push(`  nota (${nota.tipo}): ${nota.texto}`);
    for (const filho of descendentes) linhas.push(`\n${filho.dispositivo}: ${filho.texto}`);
    yield* imprimir(linhas);
  }, Effect.provide(camadaRepositorio)),
).pipe(Command.withDescription("Texto de um dispositivo (com caput herdado, notas de redação e linha de origem)."));

export const vigencia = Command.make(
  "vigencia",
  {
    id: Argument.String("id").pipe(Argument.withDescription("ID da norma, como br/cne-cp/res/2021/1")),
    em: flagData("data AAAA-MM-DD (padrão: data_referencia de config/vigencia.yaml)"),
    json: flagJson,
  },
  Effect.fn("kb.vigencia")(function* ({ id, em, json }) {
    const ato = yield* exigirIdNorma(id);
    const normas = yield* Normas.Normas;
    const quando = Option.isSome(em) ? em.value : yield* normas.dataReferencia;
    const { transicoes, ...resultado } = yield* normas.vigencia(ato, { em: quando });
    if (json) return yield* Console.log(paraJson({ ...resultado, transicoes }));
    const { registro } = yield* FontesNormativas.FontesNormativas;
    const titulo = registro.obter(ato)?.title ?? ato;
    const linhas = [`${titulo} (${ato}) em ${quando}: ${resultado.status}${resultado.certo ? "" : " — A CONFIRMAR"}`];
    const inicio = resultado.inicio;
    linhas.push(
      `  início de vigência: ${inicio.data ?? `a confirmar${inicio.minimo ? ` (não antes de ${inicio.minimo})` : ""}`}`,
    );
    for (const evento of resultado.eventos) {
      const alcance = evento.alvo_dispositivo ?? evento.alcance;
      const efeito =
        evento.efeito_de ?? `a confirmar${evento.efeito_minimo ? `, não antes de ${evento.efeito_minimo}` : ""}`;
      const estado =
        evento.ocorreu === true ? "em vigor" : evento.ocorreu === false ? "ainda sem efeito" : "a confirmar";
      linhas.push(
        `  ${evento.tipo} por ${evento.origem}${evento.operador ?? ""}${alcance ? ` (${alcance})` : ""}: efeito ${efeito} → ${estado}`,
      );
    }
    for (const pendencia of resultado.pendencias) linhas.push(`  pendência: ${pendencia}`);
    for (const t of transicoes) {
      const fim = t.fim === "sem-prazo" ? "sem prazo" : (t.fim_em ?? `${t.fim} a partir de ${t.inicio} (a confirmar)`);
      linhas.push(`  transição ${t.id} (${t.norma}${t.dispositivo}, ${t.tipo}): ${t.situacao}; fim: ${fim}`);
      linhas.push(`    ${t.regra}`);
    }
    yield* imprimir(linhas);
  }, Effect.provide(camadaRepositorio)),
).pipe(
  Command.withDescription(
    "Status de vigência de uma norma numa data, com as relações que o determinam e as regras de transição.",
  ),
);

const proporRelacoesNoCheckout = Effect.fn("kb.relacoes.propor")(function* (json: boolean) {
  const { raiz } = yield* Checkout;
  const propostas = yield* Effect.try({
    try: () => proporRelacoes(raiz),
    catch: (cause) => new FalhaNaCuradoria({ comando: "relacoes --propor", cause }),
  });
  if (json) return yield* Console.log(paraJson(propostas));
  yield* imprimir([
    `${propostas.length} propostas não registradas nem descartadas em relacoes.yaml`,
    ...propostas.map((p) => `  ${p.tipo} ${p.origem}${p.operador} → ${p.alvos.join(", ") || "?"}: ${p.trecho}`),
  ]);
});

const relacoesRegistradas = Effect.fn("kb.relacoes.registradas")(function* (id: string, json: boolean) {
  const ato = yield* exigirIdNorma(id);
  const normas = yield* Normas.Normas;
  const relacoes = yield* normas.relacoes(ato);
  if (json) return yield* Console.log(paraJson(relacoes));
  yield* imprimir([
    ...relacoes.saida.map(
      (r) =>
        `  ${ato}${r.operador ?? ""} ${r.tipo} ${r.alvo}${r.alvo_dispositivo ?? ""}${r.alcance ? ` (${r.alcance})` : ""}`,
    ),
    ...relacoes.entrada.map(
      (r) =>
        `  ${r.origem}${r.operador ?? ""} ${r.tipo} ${ato}${r.alvo_dispositivo ?? ""}${r.alcance ? ` (${r.alcance})` : ""}`,
    ),
  ]);
}, Effect.provide(camadaRepositorio));

export const relacoes = Command.make(
  "relacoes",
  {
    id: Argument.String("id").pipe(Argument.withDescription("ID da norma"), Argument.optional),
    propor: flagLigada(
      "propor",
      "lista propostas do regex (Ficam revogados, passa a vigorar...) ainda não confirmadas",
    ),
    json: flagJson,
  },
  Effect.fn("kb.relacoes")(function* ({ id, propor, json }) {
    if (propor) return yield* proporRelacoesNoCheckout(json);
    if (Option.isNone(id)) return yield* new EntradaInvalida({ motivo: "id-ausente" });
    yield* relacoesRegistradas(id.value, json);
  }),
).pipe(
  Command.withDescription(
    "Relações de base-conhecimento/relacoes.yaml de uma norma, ou propostas do regex ainda não registradas.",
  ),
);

export const correspondencia = Command.make(
  "correspondencia",
  {
    id: Argument.String("id").pipe(
      Argument.withDescription(
        "ID com dispositivo, como br/cne-cp/res/2021/1#art20 (sem dispositivo: todos os artigos)",
      ),
    ),
    json: flagJson,
  },
  Effect.fn("kb.correspondencia")(function* ({ id, json }) {
    yield* exigirIdNorma(id);
    const normas = yield* Normas.Normas;
    const resultados = yield* normas.correspondencia(id);
    if (json) return yield* Console.log(paraJson(resultados));
    if (resultados.length === 0) {
      yield* Console.log(`sem tabela de correspondência para ${id}`);
      return yield* new EncerrarComCodigo({ codigo: 1 });
    }
    const linhas: string[] = [];
    for (const r of resultados) {
      linhas.push(
        `${r.id} → ${r.destino_ato}: ${r.item.tipo}${r.herdado_de ? ` (herdado de ${r.herdado_de})` : ""} [${r.status}]`,
      );
      for (const d of r.textos_destino) linhas.push(`  ${d.id}: ${d.texto ?? "(texto não encontrado)"}`);
      if (r.item.nota) linhas.push(`  nota: ${r.item.nota}`);
      for (const detalhe of r.detalhes) {
        linhas.push(
          `  ${detalhe.origem} → ${detalhe.destino.join(", ") || "—"}: ${detalhe.tipo}${detalhe.nota ? `; ${detalhe.nota}` : ""}`,
        );
      }
    }
    linhas.push(`\nTabela ${resultados[0]!.tabela}: rascunho sem revisão jurídica.`);
    yield* imprimir(linhas);
  }, Effect.provide(camadaRepositorio)),
).pipe(
  Command.withDescription(
    "Dispositivos da norma sucessora que correspondem a um dispositivo (tabela de correspondência, rascunho).",
  ),
);

export const impacto = Command.make(
  "impacto",
  {
    id: Argument.String("id").pipe(Argument.withDescription("ID da norma, como br/cne-cp/res/2021/1")),
    json: flagJson,
    semPpcs: flagLigada("sem-ppcs", "não lista os PPCs que citam a norma (mais rápido)"),
    conteudo: flagTexto(
      "conteudo",
      "raiz alternativa dos arquivos de conteúdo das skills (ex.: git archive de um commit)",
    ),
  },
  Effect.fn("kb.impacto")(function* ({ id, json, semPpcs, conteudo }) {
    yield* exigirIdNorma(id);
    const servico = yield* Impacto.Impacto;
    const resultado = yield* servico.daNorma(id, {
      incluirPpcs: !semPpcs,
      ...(Option.isSome(conteudo) ? { raizConteudo: conteudo.value } : {}),
    });
    if (json) return yield* Console.log(paraJson(resultado));
    const linhas = [`${resultado.titulo ?? id} (${id}): ${resultado.status} em ${resultado.data_referencia}`];
    if (resultado.sucessoras.length) linhas.push(`  sucessora(s): ${resultado.sucessoras.join(", ")}`);
    if (resultado.transicoes.length) linhas.push(`  regras de transição: ${resultado.transicoes.join(", ")}`);
    for (const r of resultado.relacoes) {
      linhas.push(`  relação: ${r.origem}${r.operador ?? ""} ${r.tipo} ${r.alvo}${r.alvo_dispositivo ?? ""}`);
    }
    for (const n of resultado.normas_que_citam)
      linhas.push(`  norma que a cita: ${n.id} (${n.dispositivos.join(", ")})`);
    const estritos = resultado.arquivos.filter((a) => a.motivos.some((m) => m !== "tema"));
    linhas.push(`\nArquivos das skills citando a norma ou dispositivos correspondentes: ${estritos.length}`);
    for (const a of estritos) {
      linhas.push(
        `  ${a.arquivo} [${a.motivos.join(", ")}]${a.dispositivos.length ? ` ${a.dispositivos.join(" ")}` : ""}`,
      );
    }
    const tematicos = resultado.arquivos.filter((a) => a.motivos.includes("tema") && !estritos.includes(a));
    linhas.push(`\nFichas só por tema (${resultado.topicos_atingidos.length} tópicos atingidos): ${tematicos.length}`);
    for (const a of tematicos) linhas.push(`  ${a.arquivo} (${a.topicos?.join(", ")})`);
    linhas.push(`\nPPCs que citam a norma: ${semPpcs ? "não consultado" : resultado.ppcs.total}`);
    yield* imprimir(linhas);
  }, Effect.provide(camadaRepositorio)),
).pipe(
  Command.withDescription(
    "Fichas, validações cruzadas, textos das skills, normas e PPCs afetados por mudança na norma.",
  ),
);

export const avaliarResolvedorCmd = Command.make(
  "avaliar-resolvedor",
  { json: flagJson },
  Effect.fn("kb.avaliarResolvedor")(function* ({ json }) {
    const { raiz } = yield* Checkout;
    const resultado = yield* Effect.try({
      try: () => avaliarResolvedor(lerAnotacoes(raiz), carregarRegistro(raiz), raiz),
      catch: (cause) => new FalhaNaCuradoria({ comando: "avaliar-resolvedor", cause }),
    });
    if (json) return yield* Console.log(paraJson(resultado));
    yield* imprimir([
      `${resultado.ppcs} PPCs, ${resultado.linhas} linhas, ${resultado.anotados} citações anotadas, ${resultado.emitidos} emitidas`,
      `precisão ${resultado.precisao}  recall ${resultado.recall}  dispositivos ${resultado.dispositivos.taxa}`,
      ...resultado.problemas.map((problema) => `PROBLEMA: ${problema}`),
      ...resultado.erros.map(
        (erro) =>
          `${erro.tipo.padEnd(15)} ${erro.id.padEnd(38)} ${(erro.regra ?? "").padEnd(24)} ${erro.ppc} L${erro.linha}`,
      ),
    ]);
  }),
).pipe(Command.withDescription("Mede precisão e recall do resolvedor no conjunto anotado (avaliacao/resolvedor/)."));
