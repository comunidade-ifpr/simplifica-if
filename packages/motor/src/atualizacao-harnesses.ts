/**
 * Atualização silenciosa em segundo plano e limpeza de disco das CLIs gerenciadas (`agy` e `codex`).
 *
 * Usa os serviços copiados do T3 (`AntigravityInstallation`, `CodexInstallation`) sem alterá-los:
 * só atualiza o que já está instalado em modo gerenciado, exige versão dentro da faixa suportada,
 * respeita atualizações em andamento e versões retiradas, nunca falha o chamador em caso de
 * rede/disco e mantém a versão ativa mais a imediatamente anterior em disco.
 */
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { textoTecnico } from "./falhas.ts";
import { BUNDLED_ANTIGRAVITY_COMPATIBILITY, type AntigravityInstallation } from "./t3/AntigravityInstallation.ts";
import { BUNDLED_CODEX_COMPATIBILITY, type CodexInstallation } from "./t3/CodexInstallation.ts";
import { ProviderDriverKind, type ProviderInstallState } from "./t3/contracts.ts";
import { resolveProviderCompatibility } from "./t3/providerCompatibility.ts";
import { compareSemverVersions, parseSemver, satisfiesSemverRange } from "./t3/semver.ts";

/** Por que uma atualização automática de harness não rodou. */
export type MotivoIgnoradoHarness = "nao-suportado" | "nao-gerenciada" | "desligada" | "ocupado" | "fora-da-faixa";

/** Resultado estruturado da conferência/atualização silenciosa de um harness. */
export type ResultadoAtualizacaoHarness =
  | { readonly status: "atualizado"; readonly de: string; readonly para: string }
  | { readonly status: "em-dia"; readonly versao: string }
  | { readonly status: "em-andamento" }
  | { readonly status: "ignorado"; readonly motivo: MotivoIgnoradoHarness }
  | { readonly status: "falhou"; readonly detalhe: string };

/** Quantas versões antigas completas ficam em disco além da ativa. */
export const MANTER_ANTERIORES_PADRAO = 1;

/** Tempo após o qual pastas temporárias de staging abandonadas podem ser removidas. */
const PRAZO_STAGING_MS = 24 * 60 * 60 * 1000;

/** Teto total de espera por uma atualização iniciada por `start` (acima dos 45 min + 90 s do T3). */
const PRAZO_ATUALIZACAO = Duration.minutes(60);

/** Faixa conservadora adicional para o Codex em auto-update: evita salto silencioso de major (`>=1`). */
const TETO_AUTO_CODEX = "<1";

const DRIVER_ANTIGRAVITY = ProviderDriverKind.make("antigravity");
const DRIVER_CODEX = ProviderDriverKind.make("codex");

const FASES_EM_ANDAMENTO = new Set<ProviderInstallState["phase"]>(["downloading", "extracting", "verifying"]);
const FASES_FINAIS = new Set<ProviderInstallState["phase"]>(["succeeded", "failed", "cancelled"]);

const PADRAO_RELEASE_ID = /^[a-f0-9]{64}$/u;
const PADRAO_SEMVER = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/u;
const PREFIXO_REMOCAO = ".remover-";

const ActiveAntigravityJson = Schema.fromJsonString(
  Schema.Struct({ releaseId: Schema.String.check(Schema.isPattern(PADRAO_RELEASE_ID)) }),
);
const RegistroAntigravityJson = Schema.fromJsonString(
  Schema.Struct({
    releaseId: Schema.String.check(Schema.isPattern(PADRAO_RELEASE_ID)),
    version: Schema.String,
  }),
);
const ActiveCodexJson = Schema.fromJsonString(
  Schema.Struct({ version: Schema.String.check(Schema.isPattern(PADRAO_SEMVER)) }),
);
const RegistroCodexJson = Schema.fromJsonString(
  Schema.Struct({ version: Schema.String.check(Schema.isPattern(PADRAO_SEMVER)) }),
);

const decodificarActiveAntigravity = Schema.decodeUnknownOption(ActiveAntigravityJson);
const decodificarRegistroAntigravity = Schema.decodeUnknownOption(RegistroAntigravityJson);
const decodificarActiveCodex = Schema.decodeUnknownOption(ActiveCodexJson);
const decodificarRegistroCodex = Schema.decodeUnknownOption(RegistroCodexJson);

/** A `candidata` é mais nova que a `atual`? Segue a regra de `managedRelease.ts`. */
export function ehVersaoMaisNova(candidata: string, atual: string): boolean {
  return parseSemver(candidata) && parseSemver(atual)
    ? compareSemverVersions(candidata, atual) > 0
    : candidata !== atual;
}

/** A fase indica download, extração ou verificação em curso? */
export const ehEmAndamento = (fase: ProviderInstallState["phase"]): boolean => FASES_EM_ANDAMENTO.has(fase);

/**
 * A versão está explicitamente dentro da faixa suportada para atualização silenciosa?
 * Diferente do `isWithdrawn` do T3 (que deixa passar `"unknown"`), o auto-update só aplica versões
 * conhecidas como `"supported"` e, no Codex, abaixo de `1.0.0`.
 */
export function versaoElegivelParaAutoUpdate(provider: "antigravity" | "codex", versao: string): boolean {
  if (provider === "antigravity") {
    const aviso = resolveProviderCompatibility(BUNDLED_ANTIGRAVITY_COMPATIBILITY, DRIVER_ANTIGRAVITY, versao);
    return aviso?.status === "supported";
  }
  const aviso = resolveProviderCompatibility(BUNDLED_CODEX_COMPATIBILITY, DRIVER_CODEX, versao);
  return aviso?.status === "supported" && satisfiesSemverRange(versao, TETO_AUTO_CODEX);
}

interface InstalacaoBase {
  readonly state: Effect.Effect<ProviderInstallState>;
  readonly changes: Stream.Stream<ProviderInstallState>;
  readonly checkForUpdate: Effect.Effect<void>;
  readonly start: Effect.Effect<ProviderInstallState, { readonly message: string }>;
}

/** Aguarda o fim de uma instalação iniciada por `start` até atingir fase final ou mudar de operação. */
const aguardarConclusao = Effect.fn("AtualizacaoHarnesses.aguardarConclusao")(function* (
  instalacao: InstalacaoBase,
  inicial: ProviderInstallState,
  prazo: Duration.Input = PRAZO_ATUALIZACAO,
) {
  if (FASES_FINAIS.has(inicial.phase)) return Option.some(inicial);
  return yield* instalacao.changes.pipe(
    Stream.filter(
      (estado) =>
        FASES_FINAIS.has(estado.phase) ||
        estado.phase === "idle" ||
        (inicial.operationId !== null && estado.operationId !== inicial.operationId),
    ),
    Stream.runHead,
    Effect.flatMap((encontrado) => (Option.isSome(encontrado) ? Effect.succeed(encontrado.value) : instalacao.state)),
    Effect.timeoutOption(prazo),
  );
});

/** Executa `start`, acompanha até o fim e converte qualquer falha em resultado estruturado. */
const aplicarAtualizacao = Effect.fn("AtualizacaoHarnesses.aplicarAtualizacao")(function* (
  instalacao: InstalacaoBase,
  versaoAtual: string,
  versaoDisponivel: string,
  retirada: boolean,
  prazo?: Duration.Input,
) {
  const iniciado = yield* instalacao.start.pipe(Effect.result);
  if (iniciado._tag === "Failure") {
    return {
      status: "falhou",
      detalhe: textoTecnico(iniciado.failure.message) || "não foi possível iniciar a atualização",
    } satisfies ResultadoAtualizacaoHarness;
  }
  const concluido = yield* aguardarConclusao(instalacao, iniciado.success, prazo);
  if (Option.isNone(concluido)) {
    return {
      status: "falhou",
      detalhe: "tempo limite excedido ao aguardar a atualização",
    } satisfies ResultadoAtualizacaoHarness;
  }
  const final = concluido.value;
  if (final.phase !== "succeeded") {
    return {
      status: "falhou",
      detalhe: textoTecnico(final.message ?? "") || `a atualização terminou em ${final.phase}`,
    } satisfies ResultadoAtualizacaoHarness;
  }
  if (final.source === "local") {
    return { status: "ignorado", motivo: "nao-gerenciada" } satisfies ResultadoAtualizacaoHarness;
  }
  const novaVersao = final.installedVersion ?? versaoDisponivel;
  if (!retirada && !ehVersaoMaisNova(novaVersao, versaoAtual)) {
    return { status: "em-dia", versao: novaVersao } satisfies ResultadoAtualizacaoHarness;
  }
  return { status: "atualizado", de: versaoAtual, para: novaVersao } satisfies ResultadoAtualizacaoHarness;
});

/**
 * Confere e aplica atualização silenciosa da instalação gerenciada do Antigravity (`agy`).
 * Ignora executáveis customizados (`binario`) ou ausentes; só aplica versões dentro da faixa
 * suportada (`>=1.5.1 <2`); se a versão instalada foi retirada, tenta substituí-la.
 */
export const atualizarAntigravity = Effect.fn("AtualizacaoHarnesses.atualizarAntigravity")(function* (
  instalacao: Pick<AntigravityInstallation["Service"], "resolve" | "state" | "changes" | "checkForUpdate" | "start">,
  opcoes: {
    readonly binario?: string;
    readonly ambiente?: NodeJS.ProcessEnv;
    readonly prazo?: Duration.Input;
  } = {},
): Effect.fn.Return<ResultadoAtualizacaoHarness> {
  if ((opcoes.binario ?? "").trim() !== "") {
    return { status: "ignorado", motivo: "nao-gerenciada" };
  }
  const estadoInicial = yield* instalacao.state;
  const resolvida = yield* instalacao.resolve("", opcoes.ambiente).pipe(Effect.option);
  let versaoAtual: string | null;
  let retirada = false;
  if (Option.isSome(resolvida)) {
    if (resolvida.value.source !== "managed") {
      return { status: "ignorado", motivo: "nao-gerenciada" };
    }
    versaoAtual = resolvida.value.version ?? estadoInicial.installedVersion;
  } else if (estadoInicial.installedVersion !== null) {
    // Há uma cópia gerenciada em disco, mas `resolve` a recusou (ex.: versão retirada).
    versaoAtual = estadoInicial.installedVersion;
    retirada = true;
  } else {
    return { status: "ignorado", motivo: "nao-gerenciada" };
  }
  if (versaoAtual === null) {
    return { status: "ignorado", motivo: "nao-gerenciada" };
  }
  if (ehEmAndamento(estadoInicial.phase)) {
    return { status: "em-andamento" };
  }
  yield* instalacao.checkForUpdate;
  const estadoApos = yield* instalacao.state;
  if (ehEmAndamento(estadoApos.phase)) {
    return { status: "em-andamento" };
  }
  const versaoDisponivel = estadoApos.version;
  if (versaoDisponivel === null) {
    return retirada
      ? { status: "falhou", detalhe: "nenhuma versão elegível disponível para substituir a versão retirada" }
      : { status: "em-dia", versao: versaoAtual };
  }
  if (!versaoElegivelParaAutoUpdate("antigravity", versaoDisponivel)) {
    return { status: "ignorado", motivo: "fora-da-faixa" };
  }
  if (!retirada && !ehVersaoMaisNova(versaoDisponivel, versaoAtual)) {
    return { status: "em-dia", versao: versaoAtual };
  }
  if (retirada && versaoDisponivel === versaoAtual) {
    return { status: "falhou", detalhe: "nenhuma versão elegível disponível para substituir a versão retirada" };
  }
  return yield* aplicarAtualizacao(instalacao, versaoAtual, versaoDisponivel, retirada, opcoes.prazo).pipe(
    Effect.catchCauseIf(
      (causa) => !Cause.hasInterruptsOnly(causa),
      () =>
        Effect.succeed({
          status: "falhou",
          detalhe: "erro inesperado ao atualizar o Antigravity",
        } satisfies ResultadoAtualizacaoHarness),
    ),
  );
});

/**
 * Confere e aplica atualização silenciosa da instalação gerenciada do Codex.
 * Ignora instalações locais no PATH e máquinas onde o Codex não está instalado; só aplica versões
 * dentro da faixa suportada (`>=0.156.0 <1`).
 */
export const atualizarCodex = Effect.fn("AtualizacaoHarnesses.atualizarCodex")(function* (
  instalacao: Pick<CodexInstallation["Service"], "resolve" | "state" | "changes" | "checkForUpdate" | "start">,
  opcoes: { readonly prazo?: Duration.Input } = {},
): Effect.fn.Return<ResultadoAtualizacaoHarness> {
  const estadoInicial = yield* instalacao.state;
  const resolvida = yield* instalacao.resolve().pipe(Effect.option);
  let versaoAtual: string;
  let retirada = false;
  if (Option.isSome(resolvida)) {
    if (resolvida.value.source !== "managed") {
      return { status: "ignorado", motivo: "nao-gerenciada" };
    }
    versaoAtual = resolvida.value.version;
  } else if (estadoInicial.source === "managed" && estadoInicial.installedVersion !== null) {
    versaoAtual = estadoInicial.installedVersion;
    retirada = true;
  } else {
    return { status: "ignorado", motivo: "nao-gerenciada" };
  }
  if (ehEmAndamento(estadoInicial.phase)) {
    return { status: "em-andamento" };
  }
  yield* instalacao.checkForUpdate;
  const estadoApos = yield* instalacao.state;
  if (estadoApos.source === "local") {
    return { status: "ignorado", motivo: "nao-gerenciada" };
  }
  if (ehEmAndamento(estadoApos.phase)) {
    return { status: "em-andamento" };
  }
  const versaoDisponivel = estadoApos.version;
  if (versaoDisponivel === null) {
    return retirada
      ? { status: "falhou", detalhe: "nenhuma versão elegível disponível para substituir a versão retirada" }
      : { status: "em-dia", versao: versaoAtual };
  }
  if (!versaoElegivelParaAutoUpdate("codex", versaoDisponivel)) {
    return { status: "ignorado", motivo: "fora-da-faixa" };
  }
  if (!retirada && !ehVersaoMaisNova(versaoDisponivel, versaoAtual)) {
    return { status: "em-dia", versao: versaoAtual };
  }
  if (retirada && versaoDisponivel === versaoAtual) {
    return { status: "falhou", detalhe: "nenhuma versão elegível disponível para substituir a versão retirada" };
  }
  return yield* aplicarAtualizacao(instalacao, versaoAtual, versaoDisponivel, retirada, opcoes.prazo).pipe(
    Effect.catchCauseIf(
      (causa) => !Cause.hasInterruptsOnly(causa),
      () =>
        Effect.succeed({
          status: "falhou",
          detalhe: "erro inesperado ao atualizar o Codex",
        } satisfies ResultadoAtualizacaoHarness),
    ),
  );
});

interface CandidataLimpeza {
  readonly nome: string;
  readonly caminho: string;
  readonly versao: string;
  readonly mtimeMs: number;
}

/**
 * Ordena da mais nova para a mais antiga: versões semver válidas sempre ficam antes de rótulos
 * legados não-semver (ex.: `agy_acp_server_1.1.1`), depois semver decrescente e, no empate, mtime
 * decrescente.
 */
const ordenarMaisNovasPrimeiro = (a: CandidataLimpeza, b: CandidataLimpeza): number => {
  const semverA = parseSemver(a.versao) !== null;
  const semverB = parseSemver(b.versao) !== null;
  if (semverA && semverB) {
    const comparacao = compareSemverVersions(b.versao, a.versao);
    return comparacao !== 0 ? comparacao : b.mtimeMs - a.mtimeMs;
  }
  if (semverA !== semverB) return semverA ? -1 : 1;
  return b.mtimeMs - a.mtimeMs;
};

/** Remove pastas temporárias de staging abandonadas há mais de 24 horas (e `.remover-*` pendentes). */
const limparStagingAntigo = Effect.fn("AtualizacaoHarnesses.limparStagingAntigo")(function* (
  pasta: string,
  prefixos: ReadonlyArray<string>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const entradas = yield* fs.readDirectory(pasta).pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
  const agora = yield* Clock.currentTimeMillis;
  for (const entrada of entradas) {
    const ehRemocaoPendente = entrada.startsWith(PREFIXO_REMOCAO);
    if (!ehRemocaoPendente && !prefixos.some((prefixo) => entrada.startsWith(prefixo))) continue;
    const alvo = path.join(pasta, entrada);
    const info = yield* fs.lstat(alvo).pipe(Effect.option);
    if (Option.isNone(info) || info.value.type !== "Directory") continue;
    if (!ehRemocaoPendente) {
      const modificado = Option.match(info.value.mtime, {
        onNone: () => agora,
        onSome: (data) => data.getTime(),
      });
      if (agora - modificado < PRAZO_STAGING_MS) continue;
    }
    yield* fs.remove(alvo, { recursive: true, force: true }).pipe(Effect.ignore);
  }
});

/**
 * Remove as versões excedentes (além de `manterAnteriores`), revalidando `podeRemover` antes de
 * cada remoção para fechar janelas de corrida com instalações concorrentes. Renomeia para
 * `.remover-<nome>` antes do `remove` recursivo para não deixar pasta parcialmente apagada órfã
 * caso um executável esteja travado (Windows).
 */
const removerExcedentes = Effect.fn("AtualizacaoHarnesses.removerExcedentes")(function* (
  pastaBase: string,
  candidatas: ReadonlyArray<CandidataLimpeza>,
  manterAnteriores: number,
  podeRemover: Effect.Effect<boolean>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const ordenadas = [...candidatas].sort(ordenarMaisNovasPrimeiro);
  const paraRemover = ordenadas.slice(Math.max(0, manterAnteriores));
  let removidas = 0;
  for (const alvo of paraRemover) {
    if (!(yield* podeRemover)) break;
    const stagingRemocao = path.join(pastaBase, `${PREFIXO_REMOCAO}${alvo.nome}`);
    const renomeado = yield* fs.rename(alvo.caminho, stagingRemocao).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
    if (!renomeado) continue;
    yield* fs.remove(stagingRemocao, { recursive: true, force: true }).pipe(Effect.ignore);
    removidas += 1;
  }
  return removidas;
});

/**
 * Remove versões antigas completas do Antigravity em `<managedDirectory>/versions`, mantendo a
 * versão ativa em `active.json` e até `manterAnteriores` versões anteriores (padrão: 1). Também
 * limpa pastas temporárias `.install-*`, `active.json.*` (>24h) e `.remover-*` órfãs.
 */
export const limparVersoesAntigasAntigravity = Effect.fn("AtualizacaoHarnesses.limparVersoesAntigasAntigravity")(
  function* (
    managedDirectory: string,
    opcoes: {
      readonly manterAnteriores?: number;
      readonly emAndamento?: Effect.Effect<boolean>;
    } = {},
  ): Effect.fn.Return<number, never, FileSystem.FileSystem | Path.Path> {
    const estaEmAndamento = opcoes.emAndamento ?? Effect.succeed(false);
    if (yield* estaEmAndamento) return 0;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const pastaVersoes = path.join(managedDirectory, "versions");

    // Limpa staging vencido mesmo antes de haver um `active.json` válido (ex.: falha na 1ª instalação).
    yield* limparStagingAntigo(managedDirectory, ["active.json."]);
    yield* limparStagingAntigo(pastaVersoes, [".install-"]);

    const lerAtivo = Effect.gen(function* () {
      const textoAtivo = yield* fs.readFileString(path.join(managedDirectory, "active.json")).pipe(Effect.option);
      return Option.isSome(textoAtivo) ? decodificarActiveAntigravity(textoAtivo.value) : Option.none();
    });
    const ativo = yield* lerAtivo;
    if (Option.isNone(ativo)) return 0;

    // Só remove versões antigas se a pasta da versão ativa realmente existe e está completa.
    const pastaAtiva = path.join(pastaVersoes, ativo.value.releaseId);
    const infoAtiva = yield* fs.lstat(pastaAtiva).pipe(Effect.option);
    if (Option.isNone(infoAtiva) || infoAtiva.value.type !== "Directory") return 0;
    const regAtivoTexto = yield* fs.readFileString(path.join(pastaAtiva, ".install-complete.json")).pipe(Effect.option);
    const regAtivo = Option.isSome(regAtivoTexto) ? decodificarRegistroAntigravity(regAtivoTexto.value) : Option.none();
    if (Option.isNone(regAtivo) || regAtivo.value.releaseId !== ativo.value.releaseId) return 0;

    const entradas = yield* fs.readDirectory(pastaVersoes).pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
    const candidatas: Array<CandidataLimpeza> = [];
    for (const entrada of entradas) {
      if (entrada === ativo.value.releaseId || !PADRAO_RELEASE_ID.test(entrada)) continue;
      const caminho = path.join(pastaVersoes, entrada);
      const info = yield* fs.lstat(caminho).pipe(Effect.option);
      if (Option.isNone(info) || info.value.type !== "Directory") continue;
      const textoRegistro = yield* fs.readFileString(path.join(caminho, ".install-complete.json")).pipe(Effect.option);
      if (Option.isNone(textoRegistro)) continue;
      const registro = decodificarRegistroAntigravity(textoRegistro.value);
      if (Option.isNone(registro) || registro.value.releaseId !== entrada) continue;
      const mtimeMs = Option.match(info.value.mtime, {
        onNone: () => 0,
        onSome: (data) => data.getTime(),
      });
      candidatas.push({ nome: entrada, caminho, versao: registro.value.version, mtimeMs });
    }
    const podeRemover = Effect.gen(function* () {
      if (yield* estaEmAndamento) return false;
      const ativoAgora = yield* lerAtivo;
      return Option.isSome(ativoAgora) && ativoAgora.value.releaseId === ativo.value.releaseId;
    });
    return yield* removerExcedentes(
      pastaVersoes,
      candidatas,
      opcoes.manterAnteriores ?? MANTER_ANTERIORES_PADRAO,
      podeRemover,
    );
  },
);

/**
 * Remove versões antigas completas do Codex em `<managedDirectory>/<versão>`, mantendo a versão
 * ativa em `active.json` e até `manterAnteriores` versões anteriores (padrão: 1). Também limpa
 * pastas temporárias `.install-*`, `.active-*` (>24h) e `.remover-*` órfãs.
 */
export const limparVersoesAntigasCodex = Effect.fn("AtualizacaoHarnesses.limparVersoesAntigasCodex")(function* (
  managedDirectory: string,
  opcoes: {
    readonly manterAnteriores?: number;
    readonly emAndamento?: Effect.Effect<boolean>;
  } = {},
): Effect.fn.Return<number, never, FileSystem.FileSystem | Path.Path> {
  const estaEmAndamento = opcoes.emAndamento ?? Effect.succeed(false);
  if (yield* estaEmAndamento) return 0;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  yield* limparStagingAntigo(managedDirectory, [".install-", ".active-"]);

  const lerAtivo = Effect.gen(function* () {
    const textoAtivo = yield* fs.readFileString(path.join(managedDirectory, "active.json")).pipe(Effect.option);
    return Option.isSome(textoAtivo) ? decodificarActiveCodex(textoAtivo.value) : Option.none();
  });
  const ativo = yield* lerAtivo;
  if (Option.isNone(ativo)) return 0;

  // Só remove versões antigas se a pasta da versão ativa realmente existe e está completa.
  const pastaAtiva = path.join(managedDirectory, ativo.value.version);
  const infoAtiva = yield* fs.lstat(pastaAtiva).pipe(Effect.option);
  if (Option.isNone(infoAtiva) || infoAtiva.value.type !== "Directory") return 0;
  const regAtivoTexto = yield* fs.readFileString(path.join(pastaAtiva, ".install-complete.json")).pipe(Effect.option);
  const regAtivo = Option.isSome(regAtivoTexto) ? decodificarRegistroCodex(regAtivoTexto.value) : Option.none();
  if (Option.isNone(regAtivo) || regAtivo.value.version !== ativo.value.version) return 0;

  const entradas = yield* fs
    .readDirectory(managedDirectory)
    .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
  const candidatas: Array<CandidataLimpeza> = [];
  for (const entrada of entradas) {
    if (entrada === ativo.value.version || !PADRAO_SEMVER.test(entrada)) continue;
    const caminho = path.join(managedDirectory, entrada);
    const info = yield* fs.lstat(caminho).pipe(Effect.option);
    if (Option.isNone(info) || info.value.type !== "Directory") continue;
    const textoRegistro = yield* fs.readFileString(path.join(caminho, ".install-complete.json")).pipe(Effect.option);
    if (Option.isNone(textoRegistro)) continue;
    const registro = decodificarRegistroCodex(textoRegistro.value);
    if (Option.isNone(registro) || registro.value.version !== entrada) continue;
    const mtimeMs = Option.match(info.value.mtime, {
      onNone: () => 0,
      onSome: (data) => data.getTime(),
    });
    candidatas.push({ nome: entrada, caminho, versao: registro.value.version, mtimeMs });
  }
  const podeRemover = Effect.gen(function* () {
    if (yield* estaEmAndamento) return false;
    const ativoAgora = yield* lerAtivo;
    return Option.isSome(ativoAgora) && ativoAgora.value.version === ativo.value.version;
  });
  return yield* removerExcedentes(
    managedDirectory,
    candidatas,
    opcoes.manterAnteriores ?? MANTER_ANTERIORES_PADRAO,
    podeRemover,
  );
});
