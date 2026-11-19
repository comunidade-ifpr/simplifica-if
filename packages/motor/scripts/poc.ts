#!/usr/bin/env node
// @effect-diagnostics globalJsonInEffect:off globalConsole:off -- harness: imprime eventos já decodificados e escreve os pedaços de texto no stdout
/**
 * Harness da prova de conceito do motor (M1.0).
 *
 *   pnpm motor:poc --provider claude "<pergunta>"
 *   pnpm motor:poc --provider codex --aprovacao          # ida e volta de aprovação: nega, depois permite
 *   pnpm motor:poc --detectar                            # instalação e login dos três providers
 *   pnpm motor:poc --provider antigravity --gravar /tmp/x.jsonl "<pergunta>"
 *   pnpm motor:poc --instalar antigravity                # instalação gerenciada (a do T3)
 *   pnpm motor:poc --entrar antigravity                  # login no perfil próprio: imprime a URL
 *   pnpm motor:poc --provider codex --mcp http "<pergunta>"  # o servidor ifpr por HTTP local
 *
 * A pasta de estado (instalações e perfil do Antigravity) é `SIMPLIFICA_ESTADO` ou, no macOS,
 * `~/Library/Application Support/simplifica-if-poc`.
 *
 * Cada sessão roda numa pasta temporária vazia (apagada no fim), com o `simplifica-mcp` deste
 * checkout (`tmp/kb.sqlite`) como servidor `ifpr`: por stdio (padrão), um processo aberto pelo
 * provider, ou, com `--mcp http`, o servidor HTTP local de `@simplifica-if/mcp/http` neste processo. Imprime os eventos e, no fim, o resumo: tempo até
 * o primeiro texto, tempo total, ferramentas chamadas e tokens.
 *
 * `--gravar` grava as mensagens nativas do provider em JSONL, sem e-mails, tokens nem a pasta do
 * usuário: é de onde saem as fixtures de `test/fixtures/`.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as Argument from "effect/cli/Argument";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import * as Drivers from "../src/drivers/index.ts";
import { NIVEIS_ESFORCO } from "../src/estados-provider.ts";
import * as Motor from "../src/Motor.ts";
import * as HostProcess from "../src/t3/HostProcess.ts";
import { fixPath } from "../src/t3/os-jank.ts";
import { sanitizar } from "../src/sanitizar.ts";
import { servidorIfprHttp } from "./mcp-http.ts";

const RAIZ = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");
const PERGUNTA_PADRAO = "Qual a carga horária mínima do Técnico em Enfermagem no CNCT? Cite a fonte.";
const PEDIDO_APROVACAO =
  "Crie nesta pasta de trabalho um arquivo chamado teste.txt com o conteúdo `ok`, usando a sua ferramenta de escrever arquivos. Não use outra pasta.";
const NOVA_TENTATIVA = "Tente de novo criar o arquivo teste.txt nesta pasta; desta vez eu vou permitir.";

interface Resumo {
  inicio: number;
  primeiroTexto?: number;
  primeiroParcial?: number;
  parciais: number;
  ferramentas: Array<string>;
  entrada: number;
  saida: number;
  cache: number;
  texto: string;
  pedidos: number;
}

const formatar = (evento: Motor.Evento): string => {
  switch (evento._tag) {
    case "TextoParcial":
      return "";
    case "TextoFinal":
      return `\n[texto final] ${evento.texto}`;
    case "FerramentaIniciada":
      return `[ferramenta →] ${evento.nome} ${JSON.stringify(evento.entrada).slice(0, 200)}`;
    case "FerramentaConcluida":
      return `[ferramenta ←] ${evento.nome}${evento.falhou ? " (falhou)" : ""}: ${evento.resumo.slice(0, 160)}`;
    case "PedidoAprovacao":
      return `[aprovação?] ${evento.ferramenta}: ${evento.descricao} ${JSON.stringify(evento.entrada).slice(0, 160)}`;
    case "UsoTokens":
      return `[tokens] entrada ${evento.entrada}, saída ${evento.saida}, cache ${evento.cacheLeitura ?? "-"}${evento.custoUsd === undefined ? "" : `, US$ ${evento.custoUsd.toFixed(4)}`}`;
    case "Erro":
      return `[erro] ${evento.mensagem}`;
    case "FimTurno":
      return `[fim do turno] ${evento.motivo}`;
  }
};

/** Roda um turno, imprime os eventos e responde aos pedidos de aprovação na ordem de `respostas`. */
const turno = Effect.fn("poc.turno")(function* (
  sessao: string,
  texto: string,
  resumo: Resumo,
  respostas: Array<Motor.Decisao>,
) {
  const motor = yield* Motor.Motor;
  yield* Console.log(`\n>>> ${texto}\n`);
  yield* motor.enviarMensagem(sessao, texto).pipe(
    Stream.runForEach((evento) =>
      Effect.gen(function* () {
        const agora = yield* Clock.currentTimeMillis;
        if ((evento._tag === "TextoParcial" || evento._tag === "TextoFinal") && resumo.primeiroTexto === undefined) {
          resumo.primeiroTexto = agora;
        }
        if (evento._tag === "TextoParcial") {
          resumo.primeiroParcial ??= agora;
          resumo.parciais++;
          process.stdout.write(evento.texto);
        }
        const linha = formatar(evento);
        if (linha !== "") yield* Console.log(`${linha}  (+${((agora - resumo.inicio) / 1000).toFixed(1)} s)`);
        if (evento._tag === "TextoFinal") resumo.texto += `${evento.texto}\n`;
        if (evento._tag === "FerramentaIniciada") resumo.ferramentas.push(evento.nome);
        if (evento._tag === "UsoTokens") {
          resumo.entrada += evento.entrada;
          resumo.saida += evento.saida;
          resumo.cache += evento.cacheLeitura ?? 0;
        }
        if (evento._tag === "PedidoAprovacao") {
          resumo.pedidos++;
          const decisao = respostas.shift() ?? "negar";
          yield* Console.log(`[harness] responde "${decisao}" ao pedido ${evento.id}`);
          yield* motor.responderAprovacao(sessao, evento.id, decisao);
        }
      }),
    ),
  );
});

const poc = Command.make(
  "motor-poc",
  {
    provider: Flag.Literals("provider", ["claude", "codex", "antigravity"]).pipe(Flag.optional),
    pergunta: Argument.String("pergunta").pipe(Argument.withDefault(PERGUNTA_PADRAO)),
    aprovacao: Flag.Boolean("aprovacao").pipe(
      Flag.withDescription("pede para criar teste.txt na pasta temporária; nega o 1º pedido e permite o 2º"),
      Flag.withDefault(false),
    ),
    detectar: Flag.Boolean("detectar").pipe(Flag.withDescription("só detecta os providers"), Flag.withDefault(false)),
    gravar: Flag.String("gravar").pipe(
      Flag.withDescription("grava as mensagens nativas (sanitizadas) neste JSONL"),
      Flag.optional,
    ),
    modelo: Flag.String("modelo").pipe(Flag.optional),
    esforco: Flag.Literals("esforco", NIVEIS_ESFORCO).pipe(Flag.optional),
    mcp: Flag.Literals("mcp", ["stdio", "http"]).pipe(
      Flag.withDescription(
        "transporte do servidor ifpr: stdio (um processo por sessão) ou http (local, neste processo)",
      ),
      Flag.withDefault("http"),
    ),
    instalar: Flag.Literals("instalar", ["codex", "antigravity"]).pipe(
      Flag.withDescription("instala a CLI gerenciada (a do T3) na pasta de estado"),
      Flag.optional,
    ),
    entrar: Flag.Literals("entrar", ["antigravity"]).pipe(
      Flag.withDescription("login no perfil próprio do app; imprime a URL para abrir no navegador"),
      Flag.optional,
    ),
  },
  (opcoes) =>
    Effect.gen(function* () {
      const motor = yield* Motor.Motor;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      if (Option.isSome(opcoes.instalar)) {
        yield* motor
          .instalar(opcoes.instalar.value)
          .pipe(Stream.runForEach((estado) => Console.log(`[instalação] ${JSON.stringify(estado)}`)));
        return;
      }
      if (Option.isSome(opcoes.entrar)) {
        yield* motor
          .entrar(opcoes.entrar.value)
          .pipe(
            Stream.runForEach((estado) =>
              Console.log(
                estado.fase === "aguardando" && estado.url
                  ? `[login] abra no navegador e entre com a conta Google:\n${estado.url}`
                  : `[login] ${estado.fase}${estado.mensagem ? `: ${estado.mensagem}` : ""}`,
              ),
            ),
          );
        return;
      }
      if (opcoes.detectar || Option.isNone(opcoes.provider)) {
        for (const provider of ["claude", "codex", "antigravity"] as const) {
          yield* Console.log(JSON.stringify(yield* motor.detectar(provider)));
        }
        return;
      }
      const provider = opcoes.provider.value;
      const estado = yield* motor.detectar(provider);
      yield* Console.log(`detecção: ${JSON.stringify(estado)}`);

      const banco = path.join(RAIZ, "tmp", "kb.sqlite");
      if (!(yield* fs.exists(banco))) return yield* Console.error(`falta ${banco}: rode pnpm kb:compilar`);
      const pasta = yield* fs.makeTempDirectoryScoped({ prefix: "simplifica-poc-" });
      const pastaReal = yield* fs.realPath(pasta);

      const servidorIfpr: Motor.ServidorMcp =
        opcoes.mcp === "http"
          ? yield* servidorIfprHttp({ banco, pastaTrabalho: pastaReal })
          : {
              tipo: "stdio",
              nome: "ifpr",
              comando: process.execPath,
              argumentos: [path.join(RAIZ, "packages", "mcp", "src", "cli.ts"), "--banco", banco],
              preAprovado: true,
            };

      const inicio = yield* Clock.currentTimeMillis;
      const sessao = yield* motor.iniciarSessao({
        provider,
        pastaTrabalho: pastaReal,
        servidoresMcp: [servidorIfpr],
        ...(Option.isSome(opcoes.modelo) ? { modelo: opcoes.modelo.value } : {}),
        ...(Option.isSome(opcoes.esforco) ? { esforco: opcoes.esforco.value } : {}),
      });
      yield* Console.log(`sessão ${sessao} em ${pastaReal}`);
      const resumo: Resumo = {
        inicio,
        parciais: 0,
        ferramentas: [],
        entrada: 0,
        saida: 0,
        cache: 0,
        texto: "",
        pedidos: 0,
      };

      if (opcoes.aprovacao) {
        const respostas: Array<Motor.Decisao> = ["negar", "permitir"];
        yield* turno(sessao, PEDIDO_APROVACAO, resumo, respostas);
        if (respostas.length > 0) yield* turno(sessao, NOVA_TENTATIVA, resumo, respostas);
        const arquivo = path.join(pastaReal, "teste.txt");
        const existe = yield* fs.exists(arquivo);
        const conteudo = existe ? yield* fs.readFileString(arquivo) : "";
        yield* Console.log(
          `\n[aprovação] pedidos: ${resumo.pedidos}; teste.txt ${existe ? `criado (${JSON.stringify(conteudo.trim())})` : "não criado"}`,
        );
      } else {
        yield* turno(sessao, opcoes.pergunta, resumo, []);
      }
      yield* motor.encerrar(sessao);

      const fim = yield* Clock.currentTimeMillis;
      const segundos = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
      yield* Console.log(
        [
          "\n=== resumo ===",
          `provider: ${provider} (MCP ${opcoes.mcp})`,
          `tempo até o primeiro texto: ${resumo.primeiroTexto === undefined ? "—" : segundos(resumo.primeiroTexto - inicio)}`,
          `primeiro texto parcial: ${resumo.primeiroParcial === undefined ? "—" : `${segundos(resumo.primeiroParcial - inicio)} (${resumo.parciais} pedaços)`}`,
          `tempo total: ${segundos(fim - inicio)}`,
          `ferramentas: ${resumo.ferramentas.length === 0 ? "nenhuma" : resumo.ferramentas.join(", ")}`,
          `tokens: entrada ${resumo.entrada}, saída ${resumo.saida}, cache ${resumo.cache}`,
          `cita ifpr://: ${/ifpr:\/\/\S+/.test(resumo.texto) ? "sim" : "não"}`,
        ].join("\n"),
      );
    }).pipe(Effect.scoped),
);

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const argv = process.argv.slice(2);
  const indice = argv.indexOf("--gravar");
  const destino = indice >= 0 ? argv[indice + 1] : undefined;
  const linhas: Array<string> = [];
  const inicio = performance.now();
  const gravar = (direcao: "entrada" | "saida", mensagem: unknown) => {
    const ms = Math.round(performance.now() - inicio);
    linhas.push(JSON.stringify(sanitizar({ ms, direcao, mensagem }, { home: process.env.HOME ?? "" })));
  };
  // Como o servidor do T3 (`os-jank.ts`): um app aberto pelo Finder herda um PATH mínimo, sem
  // ~/.local/bin; o fixPath o completa com o PATH do shell de login antes de procurar as CLIs.
  yield* fixPath();
  // Pasta de estado do app (instalações gerenciadas, perfil do Antigravity): fora do repositório,
  // porque guarda o token do Antigravity.
  const path = yield* Path.Path;
  const home = yield* HostProcess.HomeDirectory;
  const padrao =
    (yield* HostProcess.Platform) === "darwin"
      ? path.join(home, "Library", "Application Support", "simplifica-if-poc")
      : path.join(home, ".simplifica-if-poc");
  const pastaEstado = yield* Config.String("SIMPLIFICA_ESTADO").pipe(Config.withDefault(padrao));
  // Ponte stdio → HTTP do MCP para o Antigravity, que no 1.5.9 não anuncia MCP por HTTP (T3).
  const ponteMcp = {
    comando: process.execPath,
    argumentos: [path.join(RAIZ, "packages", "motor", "scripts", "ponte-mcp.ts")],
  };
  const drivers = Drivers.layerNode({ ambiente: process.env, pastaEstado, ponteMcp });
  yield* Command.run(poc, { version: "0.1.0" }).pipe(
    Effect.provide(Motor.layer.pipe(Layer.provide(drivers))),
    Effect.provideService(Motor.Gravador, gravar),
    Effect.ensuring(
      destino === undefined
        ? Effect.void
        : Effect.suspend(() => fs.writeFileString(destino, `${linhas.join("\n")}\n`)).pipe(Effect.orDie),
    ),
  );
});

program.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
