/**
 * Drivers de demonstração do motor, para rodar a interface contra o `apps/server` sem chamar provider
 * real (testes de navegador e `pnpm --filter @simplifica-if/web servidor:teste`). Cobrem as telas:
 *
 * - **Claude:** instalado e com login. Responde com uma ferramenta do MCP `ifpr`, texto parcial e final
 *   com um link `ifpr://` (que existe no banco de fixture). Se a mensagem fala em "escrev", pede
 *   aprovação antes; se fala em "demor", fica respondendo até ser interrompido.
 * - **Codex:** não instalado. "Instalar" baixa em etapas (`EstadoInstalacao`); depois, sem login, e
 *   "Entrar" conclui sozinho.
 * - **Antigravity:** instalado, sem login. "Entrar" fica em `aguardando` com a URL do Google por
 *   `atrasoLogin` e então conclui.
 */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Motor from "@simplifica-if/motor";
import * as Canal from "@simplifica-if/motor/Canal";

/** O link da resposta: a DCN da EPT de 2021, que o banco de fixture do MCP traz. */
export const LINK_DEMONSTRACAO = "ifpr://norma/br/cne-cp/res/2021/1";
export const URL_LOGIN_GOOGLE = "https://accounts.google.com/o/oauth2/v2/auth?demonstracao=simplifica-if";
const TOTAL_DOWNLOAD = 48 * 1_048_576;

export interface OpcoesDemonstracao {
  /** Quanto o login do Antigravity fica em `aguardando` (padrão: 2 s). */
  readonly atrasoLogin?: Duration.Input;
  /** O intervalo entre os passos da instalação e do texto (padrão: 60 ms). */
  readonly passo?: Duration.Input;
}

const respostaFinal = `A Resolução CNE/CP nº 1/2021 define as Diretrizes Curriculares Nacionais Gerais para a Educação Profissional e Tecnológica. Veja a [Res. CNE/CP nº 1/2021](${LINK_DEMONSTRACAO}).`;

export const layer = (opcoes: OpcoesDemonstracao = {}) => {
  const atrasoLogin = Duration.fromInputUnsafe(opcoes.atrasoLogin ?? "2 seconds");
  const passo = Duration.fromInputUnsafe(opcoes.passo ?? "60 millis");
  const estado: Record<Motor.Provider, { instalado: boolean; autenticado: boolean }> = {
    claude: { instalado: true, autenticado: true },
    codex: { instalado: false, autenticado: false },
    antigravity: { instalado: true, autenticado: false },
  };

  const detectar = (provider: Motor.Provider) =>
    Effect.sync((): Motor.DeteccaoProvider => ({
      provider,
      instalado: estado[provider].instalado,
      autenticado: estado[provider].autenticado,
      ...(estado[provider].instalado ? { versao: provider === "claude" ? "2.1.30" : "1.5.9" } : {}),
      ...(estado[provider].autenticado && provider === "claude" ? { plano: "max", metodo: "claude.ai" } : {}),
      ...(estado[provider].instalado ? {} : { mensagem: "O app instala a própria cópia." }),
    }));

  const iniciar = (provider: Motor.Provider) => (_config: Motor.ConfigSessao) =>
    Effect.gen(function* () {
      const canal = yield* Canal.make;
      const escopo = yield* Effect.scope;
      let resposta: Fiber.Fiber<void> | undefined;

      const responder = (texto: string) =>
        Effect.gen(function* () {
          // Como nos providers reais, cada bloco de texto se fecha num `TextoFinal` antes da ferramenta.
          yield* canal.emitir({ _tag: "TextoParcial", texto: "Vou consultar a base." });
          yield* canal.emitir({ _tag: "TextoFinal", texto: "Vou consultar a base." });
          yield* canal.emitir({
            _tag: "FerramentaIniciada",
            id: "t1",
            nome: "ifpr.buscar_norma",
            entrada: { consulta: texto },
          });
          yield* Effect.sleep(passo);
          yield* canal.emitir({
            _tag: "FerramentaConcluida",
            id: "t1",
            nome: "ifpr.buscar_norma",
            resumo: "Res. CNE/CP nº 1/2021: Diretrizes Curriculares Nacionais Gerais para a EPT",
            falhou: false,
          });
          if (/escrev/i.test(texto)) {
            const decisao = yield* canal.pedirAprovacao({
              id: "a1",
              ferramenta: "escrever_arquivo",
              descricao: "Escrever resumo.md na pasta de trabalho",
              entrada: { caminho: "resumo.md" },
            });
            yield* canal.emitir({
              _tag: "TextoFinal",
              texto: decisao === "permitir" ? "Escrevi o resumo.md." : "Tudo bem, não escrevi o arquivo.",
            });
          }
          if (/demor/i.test(texto)) {
            yield* canal.emitir({ _tag: "TextoParcial", texto: "Esta resposta vai demorar" });
            return yield* Effect.never;
          }
          for (const pedaco of respostaFinal.match(/.{1,40}/g) ?? []) {
            yield* canal.emitir({ _tag: "TextoParcial", texto: pedaco });
            yield* Effect.sleep(passo);
          }
          yield* canal.emitir({ _tag: "TextoFinal", texto: respostaFinal });
          yield* canal.emitir({ _tag: "UsoTokens", entrada: 1234, saida: 56 });
          yield* canal.emitir({ _tag: "FimTurno", motivo: provider === "codex" ? "completed" : "end_turn" });
        });

      return {
        enviar: (texto) =>
          canal.turno(
            Effect.forkIn(responder(texto), escopo).pipe(
              Effect.tap((fibra) => Effect.sync(() => (resposta = fibra))),
              Effect.asVoid,
            ),
          ),
        responder: canal.responder,
        interromper: Effect.gen(function* () {
          if (resposta !== undefined) yield* Fiber.interrupt(resposta);
          resposta = undefined;
          yield* canal.emitir({ _tag: "FimTurno", motivo: "interrupted" });
        }),
      } satisfies Motor.SessaoDriver;
    });

  const instalar = (provider: Motor.Provider): Stream.Stream<Motor.EstadoInstalacao> =>
    Stream.fromIterable([0, 0.25, 0.5, 0.75, 1]).pipe(
      Stream.mapEffect((fracao) =>
        Effect.as(Effect.sleep(passo), {
          provider,
          fase: "baixando" as const,
          baixados: Math.round(TOTAL_DOWNLOAD * fracao),
          total: TOTAL_DOWNLOAD,
          versao: "0.130.0",
        }),
      ),
      Stream.concat(
        Stream.fromIterable<Motor.EstadoInstalacao>([
          { provider, fase: "extraindo", baixados: TOTAL_DOWNLOAD, total: TOTAL_DOWNLOAD },
          { provider, fase: "verificando", baixados: TOTAL_DOWNLOAD, total: TOTAL_DOWNLOAD },
        ]),
      ),
      Stream.concat(
        Stream.fromEffect(
          Effect.sync((): Motor.EstadoInstalacao => {
            estado[provider].instalado = true;
            return {
              provider,
              fase: "concluida",
              baixados: TOTAL_DOWNLOAD,
              total: TOTAL_DOWNLOAD,
              versaoInstalada: "0.130.0",
              origem: "gerenciada",
            };
          }),
        ),
      ),
    );

  const entrar = (provider: Motor.Provider): Stream.Stream<Motor.EstadoLogin> =>
    Stream.fromIterable<Motor.EstadoLogin>([
      { provider, fase: "iniciando" },
      { provider, fase: "aguardando", url: URL_LOGIN_GOOGLE },
    ]).pipe(
      Stream.concat(
        Stream.fromEffect(
          Effect.sleep(provider === "antigravity" ? atrasoLogin : passo).pipe(
            Effect.andThen(
              Effect.sync((): Motor.EstadoLogin => {
                estado[provider].autenticado = true;
                return { provider, fase: "concluido" };
              }),
            ),
          ),
        ),
      ),
    );

  const driver = (provider: Motor.Provider): Motor.Driver => ({
    detectar: detectar(provider),
    iniciar: iniciar(provider),
    // Como os drivers reais: o app instala o Codex e o Antigravity, e só faz o login do Antigravity.
    ...(provider === "claude" ? {} : { instalar: instalar(provider) }),
    ...(provider === "antigravity" ? { entrar: entrar(provider) } : {}),
  });

  return Layer.succeed(
    Motor.Drivers,
    Motor.Drivers.of({ claude: driver("claude"), codex: driver("codex"), antigravity: driver("antigravity") }),
  );
};
