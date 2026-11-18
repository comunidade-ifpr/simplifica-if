/**
 * "Isto está errado" (M1.12), no servidor: o rascunho do relato de um turno e o registro local.
 *
 * - `preparar`: junta, da conversa gravada, a pergunta do turno (a mensagem da pessoa, sem a indicação
 *   da skill, que só vai ao provider), a resposta (os `TextoFinal` do turno), os links `ifpr://` dela,
 *   as versões (app e base do `Atualizador`, a tarefa do `CatalogoSkills`, a IA da conversa e a versão
 *   da CLI, se a detecção responder em `prazoDeteccao`) e o destino da política de fábrica
 *   (`curadoria.repositorio`). Nunca lê a pasta da tarefa nem os anexos.
 * - `registrar`: grava o relato aprovado (título e corpo, como a pessoa os viu) na tabela `relatos`
 *   e, com `via: "arquivo"`, o `.md` em `Documentos/Simplifica IF/Relatos de erro/`, fora da pasta da
 *   tarefa (a IA não o lê nos próximos turnos). Nada sai do computador por aqui; a interface registra
 *   antes de abrir a issue no navegador.
 */
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import {
  citacoesDe,
  FalhaRelato,
  type ItemConversa,
  type RascunhoRelato,
  type RelatoRegistrado,
  type ViaRelato,
} from "@simplifica-if/contratos-app";
import * as Motor from "@simplifica-if/motor";
import { CURADORIA_FABRICA } from "@simplifica-if/motor/politica-curadoria";
import * as Atualizador from "./Atualizador.ts";
import * as CatalogoSkills from "./CatalogoSkills.ts";
import * as PastasTrabalho from "./PastasTrabalho.ts";
import * as Historico from "./persistencia/Historico.ts";

export interface OpcoesRelatos {
  /** O destino dos relatos; o padrão é o da política de fábrica (`null` até o repositório abrir). */
  readonly curadoria?: { readonly repositorio: string | null; readonly rotulos: ReadonlyArray<string> };
  /** Quanto esperar pela versão da CLI do provider (o relato sai sem ela se passar). */
  readonly prazoDeteccao?: Duration.Duration;
}

export interface EntradaRegistro {
  readonly sessao: string;
  readonly turno: number;
  readonly via: ViaRelato;
  readonly titulo: string;
  readonly corpo: string;
}

export class Relatos extends Context.Service<
  Relatos,
  {
    readonly preparar: (
      sessao: string,
      turno: number,
    ) => Effect.Effect<RascunhoRelato, Motor.SessaoDesconhecida | FalhaRelato>;
    readonly registrar: (
      entrada: EntradaRegistro,
    ) => Effect.Effect<RelatoRegistrado, Motor.SessaoDesconhecida | FalhaRelato>;
  }
>()("@simplifica-if/server/Relatos") {}

/** A pergunta e a resposta de um turno, como a conversa gravada as guarda. */
export function textoDoTurno(
  itens: ReadonlyArray<ItemConversa>,
  turno: number,
): { readonly pergunta: string; readonly resposta: string } {
  const doTurno = itens.filter((item) => item.turno === turno);
  const pergunta = doTurno.flatMap((item) => (item._tag === "Mensagem" ? [item.texto] : [])).join("\n\n");
  const resposta = doTurno
    .flatMap((item) => (item._tag === "EventoTurno" && item.evento._tag === "TextoFinal" ? [item.evento.texto] : []))
    .join("\n\n");
  return { pergunta, resposta };
}

/** Um limite generoso para o corpo do relato (o que a interface monta da conversa gravada). */
const MAXIMO_CORPO = 200_000;

export const make = Effect.fn("Relatos.make")(function* (opcoes: OpcoesRelatos = {}) {
  const historico = yield* Historico.Historico;
  const atualizador = yield* Atualizador.Atualizador;
  const catalogo = yield* CatalogoSkills.CatalogoSkills;
  const motor = yield* Motor.Motor;
  const pastas = yield* PastasTrabalho.PastasTrabalho;
  const curadoria = opcoes.curadoria ?? CURADORIA_FABRICA;
  const prazo = opcoes.prazoDeteccao ?? Duration.seconds(4);

  const buscar = (sessao: string) =>
    historico.buscar(sessao).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(new Motor.SessaoDesconhecida({ id: sessao })),
          onSome: Effect.succeed,
        }),
      ),
    );

  const preparar = Effect.fn("Relatos.preparar")(function* (sessao: string, turno: number) {
    const registro = yield* buscar(sessao);
    const { pergunta, resposta } = textoDoTurno(yield* historico.itens(sessao), turno);
    if (resposta.trim() === "")
      return yield* new FalhaRelato({ motivo: "Esta mensagem não tem resposta da IA para relatar." });
    const estado = yield* atualizador.estado;
    const skill =
      registro.tarefa === undefined ? undefined : catalogo.resumos.find((resumo) => resumo.nome === registro.tarefa);
    const deteccao = yield* motor.detectar(registro.provider).pipe(Effect.timeoutOption(prazo));
    return {
      sessao,
      turno,
      pergunta,
      resposta,
      citacoes: [...citacoesDe(resposta)],
      versoes: {
        app: estado.versaoApp,
        base: estado.base.versao,
        baseCommit: estado.base.commit,
        tarefa:
          skill === undefined
            ? null
            : { nome: skill.nome, titulo: skill.titulo, versao: catalogo.versoes[skill.nome] ?? "0.0.0" },
        provider: registro.provider,
        versaoProvider: Option.getOrUndefined(deteccao)?.versao ?? null,
        modelo: registro.modelo ?? null,
      },
      repositorio: curadoria.repositorio,
      rotulos: [...curadoria.rotulos],
      podeSalvar: pastas.raiz !== "",
    } satisfies RascunhoRelato;
  });

  const registrar = Effect.fn("Relatos.registrar")(function* (entrada: EntradaRegistro) {
    const registro = yield* buscar(entrada.sessao);
    if (!Number.isInteger(entrada.turno) || entrada.turno < 1)
      return yield* new FalhaRelato({ motivo: "Esta mensagem não existe na conversa." });
    if (entrada.corpo.length > MAXIMO_CORPO || entrada.titulo.length > 500)
      return yield* new FalhaRelato({
        motivo: "O relato é grande demais. Retire trechos da resposta e tente de novo.",
      });
    let arquivo: string | null = null;
    if (entrada.via === "arquivo") {
      const dia = DateTime.formatIsoDateUtc(yield* DateTime.now);
      // O nome diz de que tarefa é (a pasta da conversa), e o arquivo fica em "Relatos de erro".
      const tarefa = registro.pastaTrabalho.split(/[\\/]/).findLast((parte) => parte !== "") ?? "Conversa";
      arquivo = yield* pastas
        .gravarRelato(`${tarefa} - ${dia} (mensagem ${entrada.turno}).md`, `# ${entrada.titulo}\n\n${entrada.corpo}`)
        .pipe(Effect.mapError((falha) => new FalhaRelato({ motivo: falha.motivo })));
    }
    const id = yield* historico.registrarRelato({
      conversa: entrada.sessao,
      turno: entrada.turno,
      via: entrada.via,
      titulo: entrada.titulo,
      corpo: entrada.corpo,
      arquivo,
    });
    return { id, arquivo } satisfies RelatoRegistrado;
  });

  return Relatos.of({ preparar, registrar });
});

/** Pede o `Historico`, o `Atualizador`, o `CatalogoSkills`, o `Motor` e as `PastasTrabalho`. */
export const layer = (opcoes: OpcoesRelatos = {}) => Layer.effect(Relatos, make(opcoes));
