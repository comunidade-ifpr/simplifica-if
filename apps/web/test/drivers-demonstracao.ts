// @effect-diagnostics nodeBuiltinImport:off -- driver de teste: grava o relatório na pasta da tarefa
/**
 * Drivers de demonstração do motor, para rodar a interface contra o `apps/server` sem chamar provider
 * real (testes de navegador e `pnpm --filter @simplifica-if/web servidor:teste`). Cobrem as telas:
 *
 * - **Claude:** instalado e com login. Responde com uma ferramenta do MCP `ifpr`, texto parcial e final
 *   com um link `ifpr://` (que existe no banco de fixture). Se a mensagem fala em "escrev", pede
 *   aprovação antes; se fala em "demor", fica respondendo até ser interrompido; se fala em "leitor",
 *   a resposta cita um dispositivo (`LINK_DISPOSITIVO`) e uma seção de PPC (`LINK_SECAO_PPC`), para o
 *   leitor `ifpr://` (M1.6).
 * - **Codex:** não instalado. "Instalar" baixa em etapas (`EstadoInstalacao`); depois, sem login, e
 *   "Entrar" conclui sozinho.
 * - **Antigravity:** instalado, sem login. "Entrar" fica em `aguardando` com a URL do Google por
 *   `atrasoLogin` e então conclui.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
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
export const URL_LOGIN_OPENAI = "https://auth.openai.com/oauth/authorize?demonstracao=simplifica-if";
const TOTAL_DOWNLOAD = 48 * 1_048_576;

export interface OpcoesDemonstracao {
  /** Quanto o login do Antigravity fica em `aguardando` (padrão: 2 s). */
  readonly atrasoLogin?: Duration.Input;
  /** O intervalo entre os passos da instalação e do texto (padrão: 60 ms). */
  readonly passo?: Duration.Input;
  /**
   * O Claude Code está instalado e com login só quando isto diz que sim: simula a pessoa instalando pelo
   * instalador oficial enquanto o app espera o "Já fiz, conferir" (M1.8). Sem a opção, sempre está.
   */
  readonly claudePresente?: () => boolean;
}

/** Um inciso da DCN da EPT de 2026 e uma seção do PPC de Enfermagem, do banco de fixture. */
export const LINK_DISPOSITIVO = "ifpr://norma/br/cne-cp/res/2026/2#art28-xviii";
export const LINK_SECAO_PPC = "ifpr://ppc/curitiba/tecnico-em-enfermagem#avaliacao-1";

const respostaLeitor = `O PPC precisa prever o acompanhamento de egressos ([Res. CNE/CP nº 2/2026, art. 28, XVIII](${LINK_DISPOSITIVO})). Veja como o [PPC de Enfermagem](${LINK_SECAO_PPC}) trata a avaliação.`;

const respostaExterna = `Esta norma não está na base do IFPR. Em fonte externa oficial, veja a [Lei nº 7.498/1986](https://www.planalto.gov.br/ccivil_03/leis/l7498.htm).`;

const respostaFinal = `A Resolução CNE/CP nº 1/2021 define as Diretrizes Curriculares Nacionais Gerais para a Educação Profissional e Tecnológica. Veja a [Res. CNE/CP nº 1/2021](${LINK_DEMONSTRACAO}).`;

/**
 * Os modelos que o Claude de demonstração lista: o padrão da conta e outro, com raciocínio
 * aprofundado, e um sem.
 */
export const MODELOS_CLAUDE: ReadonlyArray<Motor.ModeloProvider> = [
  { id: "sonnet", nome: "Sonnet", padrao: true, esforcoAprofundado: "high" },
  { id: "opus", nome: "Opus", esforcoAprofundado: "xhigh" },
  { id: "haiku", nome: "Haiku" },
];

export const layer = (opcoes: OpcoesDemonstracao = {}) => {
  const atrasoLogin = Duration.fromInputUnsafe(opcoes.atrasoLogin ?? "2 seconds");
  const passo = Duration.fromInputUnsafe(opcoes.passo ?? "60 millis");
  const estado: Record<Motor.Provider, { instalado: boolean; autenticado: boolean }> = {
    claude: { instalado: true, autenticado: true },
    codex: { instalado: false, autenticado: false },
    antigravity: { instalado: true, autenticado: false },
  };

  const detectar = (provider: Motor.Provider) =>
    Effect.sync((): Motor.DeteccaoProvider => {
      if (provider === "claude" && opcoes.claudePresente !== undefined) {
        const presente = opcoes.claudePresente();
        estado.claude = { instalado: presente, autenticado: presente };
      }
      return {
        provider,
        instalado: estado[provider].instalado,
        autenticado: estado[provider].autenticado,
        ...(estado[provider].instalado ? { versao: provider === "claude" ? "2.1.30" : "1.5.9" } : {}),
        ...(estado[provider].autenticado && provider === "claude"
          ? { plano: "max", metodo: "claude.ai", modelos: MODELOS_CLAUDE }
          : {}),
        ...(estado[provider].instalado ? {} : { mensagem: "O app instala a própria cópia." }),
      };
    });

  const iniciar = (provider: Motor.Provider) => (config: Motor.ConfigSessao) =>
    Effect.gen(function* () {
      const canal = yield* Canal.make;
      const escopo = yield* Effect.scope;
      let resposta: Fiber.Fiber<void> | undefined;

      /** Uma chamada da ferramenta `etapa` (o indicador de etapas da tarefa). */
      const etapa = (id: string, progresso?: { feito: number; total: number }) =>
        Effect.gen(function* () {
          const chamada = `etapa-${id}-${progresso?.feito ?? 0}`;
          yield* canal.emitir({
            _tag: "FerramentaIniciada",
            id: chamada,
            nome: "ifpr.etapa",
            entrada: { id, ...(progresso === undefined ? {} : { progresso }) },
          });
          yield* canal.emitir({
            _tag: "FerramentaConcluida",
            id: chamada,
            nome: "ifpr.etapa",
            resumo: "Etapa registrada no app.",
            falhou: false,
          });
        });

      // O primeiro turno de uma tarefa (o servidor indica a skill): as etapas da
      // `verificar-fundamentacao-normativa` e o relatório gravado na pasta, com aprovação.
      const tarefa = Effect.gen(function* () {
        yield* etapa("alegacoes");
        yield* etapa("fontes", { feito: 1, total: 2 });
        yield* etapa("fontes", { feito: 2, total: 2 });
        yield* etapa("classificar");
        const decisao = yield* canal.pedirAprovacao({
          id: "a-relatorio",
          ferramenta: "Write",
          descricao: "Gravar relatorio.md na pasta da tarefa",
          entrada: { caminho: "relatorio.md" },
        });
        if (decisao === "permitir") {
          NodeFS.writeFileSync(
            NodePath.join(config.pastaTrabalho, "relatorio.md"),
            "# Relatório\n\nUma alegação confirmada.\n",
          );
        }
        yield* etapa("relatorio");
      });

      const responder = (texto: string) =>
        Effect.gen(function* () {
          if (texto.startsWith("Siga a skill")) yield* tarefa;
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
          // A conta no limite de uso (M1.14): o texto do app-server do Codex, que o motor classifica e a
          // tela traduz pelo tipo.
          if (/limite de uso/i.test(texto)) {
            yield* canal.emitir(
              Motor.erroDoTurno(
                "You've hit your usage limit. Upgrade to Pro (https://openai.com/chatgpt/pricing) or try again later.",
              ),
            );
            yield* canal.emitir({ _tag: "FimTurno", motivo: "failed" });
            return;
          }
          if (/demor/i.test(texto)) {
            yield* canal.emitir({ _tag: "TextoParcial", texto: "Esta resposta vai demorar" });
            return yield* Effect.never;
          }
          if (/fonte externa/i.test(texto)) {
            yield* canal.emitir({
              _tag: "FerramentaIniciada",
              id: "t-web-busca",
              nome: "WebSearch",
              entrada: { query: "Lei 7498 1986 exercicio profissional enfermagem" },
            });
            yield* canal.emitir({
              _tag: "FerramentaConcluida",
              id: "t-web-busca",
              nome: "WebSearch",
              resumo: "Search results for Lei 7498/1986",
              falhou: false,
            });
            yield* canal.emitir({
              _tag: "FerramentaIniciada",
              id: "t-web-pagina",
              nome: "WebFetch",
              entrada: { url: "https://www.planalto.gov.br/ccivil_03/leis/l7498.htm" },
            });
            yield* canal.emitir({
              _tag: "FerramentaConcluida",
              id: "t-web-pagina",
              nome: "WebFetch",
              resumo: "Fetched page content from planalto.gov.br",
              falhou: false,
            });
          }
          const final = /fonte externa/i.test(texto)
            ? respostaExterna
            : /leitor/i.test(texto)
              ? respostaLeitor
              : respostaFinal;
          for (const pedaco of final.match(/.{1,40}/g) ?? []) {
            yield* canal.emitir({ _tag: "TextoParcial", texto: pedaco });
            yield* Effect.sleep(passo);
          }
          yield* canal.emitir({ _tag: "TextoFinal", texto: final });
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
      { provider, fase: "aguardando", url: provider === "codex" ? URL_LOGIN_OPENAI : URL_LOGIN_GOOGLE },
    ]).pipe(
      Stream.concat(
        Stream.fromEffect(
          Effect.sleep(atrasoLogin).pipe(
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
    // Como os drivers reais, apaga o registro da conversa ao apagá-la no app (aqui não há o que apagar).
    esquecer: () => Effect.succeed(true),
    // Como os drivers reais: o app instala e faz o login do Codex e do Antigravity; o Claude é à mão.
    ...(provider === "claude" ? {} : { instalar: instalar(provider), entrar: entrar(provider) }),
  });

  return Layer.succeed(
    Motor.Drivers,
    Motor.Drivers.of({ claude: driver("claude"), codex: driver("codex"), antigravity: driver("antigravity") }),
  );
};
