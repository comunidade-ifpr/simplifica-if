#!/usr/bin/env node
/**
 * Aplica nos registros de base-conhecimento/institucional/ifpr/cursos/ um relatório de coleta das
 * matrizes do SUAP (`matrizes-suap/1`). Confere todos os cursos antes de gravar qualquer um; sem
 * `--apply`, só lista as mudanças.
 *
 *   node scripts/aplicar_matrizes_suap.ts <relatorio.json> [--apply]
 *
 * Códigos de saída: 0 sucesso; 1 relatório recusado, curso alterado desde a coleta ou erro de uso.
 */
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import * as Argument from "effect/cli/Argument";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import { RepositorioCursosLocal, type MudancaMatrizes, type PlanoMatrizes } from "./dados/cursos.ts";
import { RAIZ_DADOS_INSTITUCIONAIS } from "./dados/institucional.ts";
import { ESQUEMA_RELATORIO_MATRIZES, esquemaRelatorioMatrizes } from "./dominio/matriz-suap.ts";
import { validarJson } from "./esquema.ts";
import { executarPrincipal } from "./principal.ts";

/** Passos depois de gravar, os da convenção de entrada na doc de curadoria. */
const PASSOS_SEGUINTES = [
  "node scripts/gerar_base.ts",
  "node scripts/validar_base.ts",
  "pnpm kb:compilar",
  "sh testes-gabarito/banco.sh --comparar",
  "sh testes-gabarito/kb.sh --comparar",
];

export class RelatorioNaoLido extends Schema.TaggedError<RelatorioNaoLido>()("RelatorioNaoLido", {
  caminho: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Relatório ${this.caminho} não pôde ser lido como JSON.`;
  }
}

export class EsquemaDesconhecido extends Schema.TaggedError<EsquemaDesconhecido>()("EsquemaDesconhecido", {
  caminho: Schema.String,
  esquema: Schema.String,
}) {
  override get message(): string {
    return `Relatório ${this.caminho}: esquema ${this.esquema} desconhecido; este comando aplica ${ESQUEMA_RELATORIO_MATRIZES}.`;
  }
}

export class RelatorioForaDoFormato extends Schema.TaggedError<RelatorioForaDoFormato>()("RelatorioForaDoFormato", {
  caminho: Schema.String,
  problemas: Schema.String,
}) {
  override get message(): string {
    return this.problemas;
  }
}

export class RelatorioComFalhas extends Schema.TaggedError<RelatorioComFalhas>()("RelatorioComFalhas", {
  caminho: Schema.String,
  falhas: Schema.Int,
}) {
  override get message(): string {
    return (
      `Relatório ${this.caminho} tem ${this.falhas} falha(s) de coleta; resolva-as e colete de novo antes de ` +
      "aplicar. Nada foi gravado."
    );
  }
}

export class CursosNaoConferem extends Schema.TaggedError<CursosNaoConferem>()("CursosNaoConferem", {
  divergencias: Schema.Array(Schema.String),
}) {
  override get message(): string {
    return `Cursos do relatório não conferem com os registros (alterados desde a coleta?); nada foi gravado:\n- ${this.divergencias.join("\n- ")}`;
  }
}

export class BaseInstitucionalInvalida extends Schema.TaggedError<BaseInstitucionalInvalida>()(
  "BaseInstitucionalInvalida",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Os registros de institucional/ifpr/ não carregam; rode node scripts/validar_base.ts.";
  }
}

export class GravacaoNaoConfirmada extends Schema.TaggedError<GravacaoNaoConfirmada>()("GravacaoNaoConfirmada", {
  cursos: Schema.Array(Schema.String),
}) {
  override get message(): string {
    return `A releitura não confirma a gravação de: ${this.cursos.join(", ")}`;
  }
}

const decodificarJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

/** O `esquema` declarado no relatório, antes da validação inteira, para a recusa dizer qual veio. */
function esquemaDeclarado(valor: unknown): string {
  if (typeof valor !== "object" || valor === null || !("esquema" in valor)) return "(ausente)";
  return typeof valor.esquema === "string" ? valor.esquema : JSON.stringify(valor.esquema);
}

/** Lê e valida o relatório: JSON, `esquema` conhecido, formato e nenhuma falha de coleta. */
export const lerRelatorio = Effect.fn("aplicar_matrizes_suap.lerRelatorio")(function* (caminho: string) {
  const fs = yield* FileSystem.FileSystem;
  const texto = yield* fs.readFileString(caminho);
  const valor = yield* decodificarJson(texto).pipe(
    Effect.mapError((cause) => new RelatorioNaoLido({ caminho, cause })),
  );
  const esquema = esquemaDeclarado(valor);
  if (esquema !== ESQUEMA_RELATORIO_MATRIZES) return yield* new EsquemaDesconhecido({ caminho, esquema });
  const relatorio = yield* Effect.try({
    try: () => validarJson(esquemaRelatorioMatrizes, valor, `Relatório ${caminho}`),
    catch: (erro) => new RelatorioForaDoFormato({ caminho, problemas: (erro as Error).message }),
  });
  if (relatorio.erros.length) return yield* new RelatorioComFalhas({ caminho, falhas: relatorio.erros.length });
  return relatorio;
});

const texto = (valor: unknown) => (valor === undefined ? "(ausente)" : String(valor));

function linhasMudanca({ curso_id, suap_id, antes, depois, campos }: MudancaMatrizes): string[] {
  if (!antes) return [`${curso_id} (SUAP ${suap_id}): matrizes novas, ${depois.situacao}`];
  const linhas = [`${curso_id} (SUAP ${suap_id}):`];
  for (const campo of campos) {
    if (campo === "situacao" || campo === "carga_horaria_comum_h") {
      linhas.push(`  ${campo}: ${texto(antes[campo])} → ${texto(depois[campo])}`);
    } else if (campo === "urls") {
      linhas.push(`  urls: ${(antes.urls ?? []).join(" ")} → ${(depois.urls ?? []).join(" ")}`);
    } else {
      linhas.push("  resumo:", ...(depois.resumo ?? "").split("\n").map((linha) => `    ${linha}`));
    }
  }
  return linhas;
}

/** O resultado da aplicação: o plano e se ele foi gravado. */
export interface ResultadoAplicacao {
  readonly plano: PlanoMatrizes;
  readonly gravado: boolean;
}

/**
 * Lê o relatório, confere todos os cursos contra os registros de `raiz` e, com `apply`, grava só os
 * que mudam. Qualquer curso divergente recusa o relatório inteiro, sem gravar nenhum.
 */
export const aplicarRelatorio = Effect.fn("aplicar_matrizes_suap.aplicar")(function* (
  caminho: string,
  opcoes: { readonly apply: boolean; readonly raiz?: string },
) {
  const relatorio = yield* lerRelatorio(caminho);
  const repositorio = new RepositorioCursosLocal(opcoes.raiz ?? RAIZ_DADOS_INSTITUCIONAIS);
  const plano = yield* Effect.try({
    try: () => repositorio.planejarMatrizes(relatorio),
    catch: (cause) => new BaseInstitucionalInvalida({ cause }),
  });
  if (plano.divergencias.length) return yield* new CursosNaoConferem({ divergencias: plano.divergencias });

  yield* Console.log(
    `Relatório ${relatorio.esquema}, coletado em ${relatorio.coletado_em}: ${relatorio.cursos.length} cursos.`,
  );
  for (const mudanca of plano.mudancas) {
    for (const linha of linhasMudanca(mudanca)) yield* Console.log(linha);
  }
  yield* Console.log(`Com mudança: ${plano.mudancas.length}; sem mudança: ${plano.semMudanca}.`);
  if (!opcoes.apply) {
    yield* Console.log("Nada foi gravado; rode com --apply para gravar as mudanças.");
    return { plano, gravado: false } satisfies ResultadoAplicacao;
  }
  if (!plano.mudancas.length) {
    yield* Console.log("Nenhum registro mudou; nada foi gravado.");
    return { plano, gravado: false } satisfies ResultadoAplicacao;
  }
  const naoConfirmados = yield* Effect.try({
    try: () => repositorio.gravarMatrizes(plano.mudancas),
    catch: (cause) => new BaseInstitucionalInvalida({ cause }),
  });
  if (naoConfirmados.length) return yield* new GravacaoNaoConfirmada({ cursos: naoConfirmados });
  yield* Console.log(`Gravados ${plano.mudancas.length} registros em institucional/ifpr/cursos/. Depois, rode:`);
  for (const passo of PASSOS_SEGUINTES) yield* Console.log(`  ${passo}`);
  return { plano, gravado: true } satisfies ResultadoAplicacao;
});

export const comando = Command.make(
  "aplicar_matrizes_suap",
  {
    relatorio: Argument.String("relatorio.json").pipe(
      Argument.withDescription(`relatório de coleta das matrizes (${ESQUEMA_RELATORIO_MATRIZES})`),
    ),
    apply: Flag.Boolean("apply").pipe(
      Flag.withDescription("grava as mudanças nos registros (sem a flag, só as lista)"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn("aplicar_matrizes_suap")(function* ({ relatorio, apply }) {
    yield* aplicarRelatorio(relatorio, { apply });
  }),
).pipe(
  Command.withDescription(
    "Confere um relatório de coleta das matrizes do SUAP contra os registros de institucional/ifpr/cursos/ e, " +
      "com --apply, grava suap.matrizes dos cursos que mudam. Um curso alterado desde a coleta recusa o relatório inteiro.",
  ),
);

if (import.meta.main) {
  executarPrincipal("aplicar_matrizes_suap", Command.run(comando, { version: "1.0.0" }));
}
