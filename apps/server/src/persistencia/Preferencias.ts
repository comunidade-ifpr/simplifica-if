/**
 * As preferências deste computador (M1.8, primeiro uso): o perfil (campus, cargo e função), o aviso
 * de uso aceito, as boas-vindas concluídas, as IAs que a pessoa deixou de usar no app, o aviso do
 * sistema (ligado se nunca foi desligado) e onde a pessoa estava ao fechar o app (a continuidade). Uma linha por
 * chave na tabela `preferencias` do banco das conversas, com o valor em JSON.
 *
 * Nada daqui vai à IA nem sai do computador. O valor gravado passa pelo schema na leitura: um valor que
 * não decodifica (de uma versão futura, ou estragado) conta como ausente, e a pessoa refaz o passo.
 */
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import {
  AvisoNaoAceito,
  Continuidade,
  Perfil,
  Preferencias as PreferenciasApp,
  type Provider,
} from "@simplifica-if/contratos-app";
import { descarregar } from "./Banco.ts";

const CHAVES = {
  perfil: "perfil",
  aviso: "aviso_aceito_em",
  boasVindas: "boas_vindas_em",
  iasDesligadas: "ias_desligadas",
  avisosDoSistema: "avisos_do_sistema",
  continuidade: "continuidade",
} as const;

const PerfilJson = Schema.fromJsonString(Perfil);
const DataJson = Schema.fromJsonString(Schema.String);
const IasJson = Schema.fromJsonString(PreferenciasApp.fields.iasDesligadas);
const LigadoJson = Schema.fromJsonString(Schema.Boolean);
const ContinuidadeJson = Schema.fromJsonString(Continuidade);

export class Preferencias extends Context.Service<
  Preferencias,
  {
    readonly ler: Effect.Effect<PreferenciasApp>;
    readonly gravarPerfil: (perfil: Perfil) => Effect.Effect<PreferenciasApp>;
    readonly apagarPerfil: Effect.Effect<PreferenciasApp>;
    readonly aceitarAviso: Effect.Effect<PreferenciasApp>;
    /** Marca as boas-vindas como feitas (concluídas ou puladas); a primeira data fica. */
    readonly concluirBoasVindas: Effect.Effect<PreferenciasApp>;
    readonly usarIa: (provider: Provider, usar: boolean) => Effect.Effect<PreferenciasApp>;
    readonly avisarNoSistema: (ligar: boolean) => Effect.Effect<PreferenciasApp>;
    /** Guarda a última rota e o painel, no lugar dos de antes. */
    readonly guardarContinuidade: (continuidade: Continuidade) => Effect.Effect<void>;
    /** Falha com `AvisoNaoAceito` enquanto a pessoa não aceitou o aviso de uso (nada vai à IA antes). */
    readonly exigirAviso: Effect.Effect<void, AvisoNaoAceito>;
  }
>()("@simplifica-if/server/persistencia/Preferencias") {}

const agora = Effect.map(DateTime.now, DateTime.formatIso);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const gravar = Effect.fn("Preferencias.gravar")(function* <S extends Schema.Codec<unknown, string>>(
    chave: string,
    schema: S,
    valor: S["Type"],
  ) {
    const texto = yield* Schema.encodeEffect(schema)(valor);
    const data = yield* agora;
    yield* sql`
      INSERT INTO preferencias (chave, valor, atualizada_em) VALUES (${chave}, ${texto}, ${data})
      ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor, atualizada_em = excluded.atualizada_em
    `;
  });

  const ler = Effect.gen(function* () {
    const linhas = yield* sql<{ chave: string; valor: string }>`SELECT chave, valor FROM preferencias`;
    const valores = new Map(linhas.map((linha) => [linha.chave, linha.valor]));
    const decodificar = <S extends Schema.Codec<unknown, string>>(
      schema: S,
      chave: string,
    ): Option.Option<S["Type"]> => {
      const valor = valores.get(chave);
      return valor === undefined ? Option.none() : Schema.decodeOption(schema)(valor);
    };
    const perfil = decodificar(PerfilJson, CHAVES.perfil);
    const aviso = decodificar(DataJson, CHAVES.aviso);
    const boasVindas = decodificar(DataJson, CHAVES.boasVindas);
    const continuidade = decodificar(ContinuidadeJson, CHAVES.continuidade);
    return {
      ...(Option.isSome(perfil) ? { perfil: perfil.value } : {}),
      ...(Option.isSome(aviso) ? { avisoAceitoEm: aviso.value } : {}),
      ...(Option.isSome(boasVindas) ? { boasVindasEm: boasVindas.value } : {}),
      iasDesligadas: Option.getOrElse(decodificar(IasJson, CHAVES.iasDesligadas), () => []),
      avisosDoSistema: Option.getOrElse(decodificar(LigadoJson, CHAVES.avisosDoSistema), () => true),
      ...(Option.isSome(continuidade) ? { continuidade: continuidade.value } : {}),
    } satisfies PreferenciasApp;
  }).pipe(Effect.orDie, Effect.withSpan("Preferencias.ler"));

  /** A data de agora, só se a chave ainda não tem uma. */
  const dataUmaVez = Effect.fn("Preferencias.dataUmaVez")(function* (chave: string) {
    const [existente] = yield* sql<{ valor: string }>`SELECT valor FROM preferencias WHERE chave = ${chave}`;
    if (existente === undefined) yield* gravar(chave, DataJson, yield* agora);
  });

  const gravarPerfil = Effect.fn("Preferencias.gravarPerfil")(function* (perfil: Perfil) {
    yield* gravar(CHAVES.perfil, PerfilJson, perfil);
    return yield* ler;
  }, Effect.orDie);

  /**
   * Apagar o perfil apaga de fato: o banco abre com `secure_delete`, que zera o conteúdo das páginas
   * liberadas, e `Banco.descarregar` esvazia o `-wal`.
   */
  const apagarPerfil = Effect.gen(function* () {
    yield* sql`DELETE FROM preferencias WHERE chave = ${CHAVES.perfil}`;
    yield* descarregar(sql);
    return yield* ler;
  }).pipe(Effect.orDie, Effect.withSpan("Preferencias.apagarPerfil"));

  const usarIa = Effect.fn("Preferencias.usarIa")(function* (provider: Provider, usar: boolean) {
    const atuais = (yield* ler).iasDesligadas.filter((outro) => outro !== provider);
    yield* gravar(CHAVES.iasDesligadas, IasJson, usar ? atuais : [...atuais, provider]);
    return yield* ler;
  }, Effect.orDie);

  const avisarNoSistema = Effect.fn("Preferencias.avisarNoSistema")(function* (ligar: boolean) {
    yield* gravar(CHAVES.avisosDoSistema, LigadoJson, ligar);
    return yield* ler;
  }, Effect.orDie);

  const guardarContinuidade = Effect.fn("Preferencias.guardarContinuidade")(function* (continuidade: Continuidade) {
    yield* gravar(CHAVES.continuidade, ContinuidadeJson, continuidade);
  }, Effect.orDie);

  return Preferencias.of({
    ler,
    gravarPerfil,
    apagarPerfil,
    aceitarAviso: dataUmaVez(CHAVES.aviso).pipe(Effect.andThen(ler), Effect.orDie),
    concluirBoasVindas: dataUmaVez(CHAVES.boasVindas).pipe(Effect.andThen(ler), Effect.orDie),
    usarIa,
    avisarNoSistema,
    guardarContinuidade,
    exigirAviso: ler.pipe(
      Effect.flatMap((atuais) =>
        atuais.avisoAceitoEm === undefined ? Effect.fail(new AvisoNaoAceito()) : Effect.void,
      ),
    ),
  });
});

/** Pede o `SqlClient` do banco das conversas. */
export const layer = Layer.effect(Preferencias, make);

/**
 * Para os testes que não passam pelo primeiro uso: o aviso aceito e as boas-vindas feitas, antes de a
 * interface conectar.
 */
export const layerPrimeiroUsoFeito = Layer.effect(
  Preferencias,
  Effect.gen(function* () {
    const servico = yield* make;
    yield* servico.aceitarAviso;
    yield* servico.concluirBoasVindas;
    return servico;
  }),
);
