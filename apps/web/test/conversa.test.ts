/**
 * A conversa da interface (`ControleConversa`, a mesma que as telas usam) contra o `apps/server` de
 * verdade, por RPC: iniciar, o texto parcial e o final com o link `ifpr://`, as ferramentas como
 * etapas, a aprovação, interromper, nova conversa, e a leitura do link pelo `GrupoLeitura`.
 */
import { afterAll, assert, layer } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Servidor from "@simplifica-if/server";
import type { ControleConversa } from "../src/conversa/ControleConversa.ts";
import type { EstadoConversa } from "../src/conversa/estado.ts";
import { inicializar } from "../src/inicializar.ts";
import {
  diretorioTemporario,
  layerServidor,
  limparTemporarios,
  LINK_DEMONSTRACAO,
  TOKEN,
  urlServidor,
} from "./apoio.ts";

afterAll(limparTemporarios);

const pasta = diretorioTemporario("simplifica-web-pasta-");

/** Espera o estado da conversa satisfazer `condicao`. */
const esperar = (conversa: ControleConversa, condicao: (estado: EstadoConversa) => boolean) =>
  Effect.callback<EstadoConversa>((resume) => {
    const conferir = () => {
      const estado = conversa.obter();
      if (condicao(estado)) resume(Effect.succeed(estado));
    };
    const parar = conversa.observar(conferir);
    conferir();
    return Effect.sync(parar);
  }).pipe(Effect.timeout(Duration.seconds(10)));

/** O app (a `Api` e a conversa) conectado ao servidor do teste; fecha a conexão no fim. */
const app = Effect.acquireRelease(
  Effect.flatMap(Effect.service(Servidor.ServidorApp), ({ porta }) =>
    Effect.promise(() =>
      inicializar({ tipo: "navegador", fonte: "url", credenciais: { urlServidor: urlServidor(porta), token: TOKEN } }),
    ),
  ),
  (iniciado) => Effect.promise(() => iniciado.encerrar()),
);

layer(layerServidor(), { excludeTestServices: true })("conversa pela interface", (it) => {
  it.effect("inicia, recebe texto parcial e final, ferramentas e o link ifpr://, e responde à aprovação", () =>
    Effect.gen(function* () {
      const { contexto } = yield* app;
      const { conversa, api } = contexto;

      // Sem pasta, não inicia.
      yield* Effect.promise(() => conversa.iniciar());
      assert.strictEqual(conversa.obter().erroInicio, "Escolha a pasta de trabalho da conversa.");
      // Pasta que não existe: o erro do servidor, em português.
      conversa.escolher({ provider: "claude", pastaTrabalho: `${pasta}/nao-existe` });
      yield* Effect.promise(() => conversa.iniciar());
      assert.match(conversa.obter().erroInicio ?? "", /^A pasta de trabalho precisa ser o caminho absoluto/);

      conversa.escolher({ pastaTrabalho: pasta });
      yield* Effect.promise(() => conversa.iniciar());
      assert.strictEqual(conversa.obter().fase, "pronta");
      assert.isDefined(conversa.obter().sessao);

      conversa.enviar("Pode escrever um resumo da DCN?");
      const pedido = yield* esperar(conversa, (estado) =>
        estado.itens.some((item) => item.tipo === "aprovacao" && item.situacao === "pendente"),
      );
      assert.strictEqual(pedido.fase, "respondendo");
      const ferramenta = pedido.itens.find((item) => item.tipo === "ferramenta");
      assert.deepInclude(ferramenta, { nome: "ifpr.buscar_norma", situacao: "concluida" });
      const aprovacao = pedido.itens.find((item) => item.tipo === "aprovacao");
      assert.strictEqual(aprovacao?.id, "a1");

      yield* Effect.promise(() => conversa.responder("a1", "permitir"));
      const fim = yield* esperar(conversa, (estado) => estado.fase === "pronta");
      assert.deepStrictEqual(
        fim.itens.map((item) => item.tipo),
        ["pessoa", "resposta", "ferramenta", "aprovacao", "resposta"],
      );
      assert.deepInclude(fim.itens[3], { situacao: "permitida" });
      // O parcial "Vou consultar a base." virou o texto final do primeiro bloco; o segundo traz o link.
      assert.deepInclude(fim.itens[1], { texto: "Escrevi o resumo.md.", final: true });
      const resposta = fim.itens[4];
      assert.isTrue(resposta?.tipo === "resposta" && resposta.final && resposta.texto.includes(LINK_DEMONSTRACAO));
      assert.deepStrictEqual(fim.uso, { entrada: 1234, saida: 56 });

      // O painel de leitura: o link da resposta, lido da base pelo RPC.
      const lido = yield* Effect.promise(() => api.chamar((cliente) => cliente.lerLink({ link: LINK_DEMONSTRACAO })));
      assert.strictEqual(lido.tipo, "norma");
      assert.include(lido.texto, "Diretrizes");
    }).pipe(Effect.scoped),
  );

  it.effect("interrompe a resposta em andamento e começa uma nova conversa", () =>
    Effect.gen(function* () {
      const { contexto } = yield* app;
      const { conversa } = contexto;
      conversa.escolher({ provider: "antigravity", pastaTrabalho: pasta });
      yield* Effect.promise(() => conversa.iniciar());
      const sessao = conversa.obter().sessao;

      conversa.enviar("Uma resposta demorada, por favor");
      yield* esperar(conversa, (estado) =>
        estado.itens.some((item) => item.tipo === "resposta" && item.texto.includes("demorar")),
      );
      yield* Effect.promise(() => conversa.interromper());
      const interrompida = yield* esperar(conversa, (estado) => estado.fase === "pronta");
      assert.deepInclude(interrompida.itens.at(-1), { tipo: "aviso", texto: "Resposta interrompida." });

      // A sessão continua: outro turno funciona.
      conversa.enviar("E agora?");
      yield* esperar(conversa, (estado) => estado.fase === "pronta" && estado.itens.length > interrompida.itens.length);

      conversa.nova();
      assert.strictEqual(conversa.obter().fase, "configurando");
      assert.strictEqual(conversa.obter().provider, "antigravity");
      assert.strictEqual(conversa.obter().pastaTrabalho, pasta);
      assert.isUndefined(conversa.obter().sessao);
      // A sessão antiga foi encerrada no servidor.
      const { api } = contexto;
      const encerrada = yield* Effect.promise(() =>
        api
          .chamar((cliente) => cliente["conversa.encerrar"]({ sessao: sessao! }))
          .then(
            () => "encerrou",
            (erro: unknown) => (erro as { _tag: string })._tag,
          ),
      );
      assert.strictEqual(encerrada, "SessaoDesconhecida");
    }).pipe(Effect.scoped),
  );

  it.effect("instala e entra pelo RPC, com o progresso e a URL de login", () =>
    Effect.gen(function* () {
      const { contexto } = yield* app;
      const { api } = contexto;
      const fases: Array<string> = [];
      const instalacao = api.acompanhar(
        (cliente) => cliente["providers.instalar"]({ provider: "codex" }),
        (estado) => fases.push(estado.fase),
      );
      assert.strictEqual(yield* Effect.promise(() => instalacao.fim), "concluido");
      assert.deepStrictEqual(fases, [
        "baixando",
        "baixando",
        "baixando",
        "baixando",
        "baixando",
        "extraindo",
        "verificando",
        "concluida",
      ]);

      const urls: Array<string> = [];
      const login = api.acompanhar(
        (cliente) => cliente["providers.entrar"]({ provider: "antigravity" }),
        (estado) => estado.url !== undefined && urls.push(estado.url),
      );
      assert.strictEqual(yield* Effect.promise(() => login.fim), "concluido");
      assert.lengthOf(urls, 1);
      assert.match(urls[0]!, /^https:\/\/accounts\.google\.com\//);

      const depois = yield* Effect.promise(() =>
        api.chamar((cliente) => cliente["providers.detectar"]({ provider: "antigravity" })),
      );
      assert.isTrue(depois.autenticado);
      assert.deepInclude(depois, { podeInstalar: true, podeEntrar: true });
      const claude = yield* Effect.promise(() =>
        api.chamar((cliente) => cliente["providers.detectar"]({ provider: "claude" })),
      );
      assert.deepInclude(claude, { podeInstalar: false, podeEntrar: false });

      // O Claude não tem instalação gerenciada: o erro tipado, em português.
      const recusa = yield* Effect.promise(() =>
        api
          .acompanhar(
            (cliente) => cliente["providers.instalar"]({ provider: "claude" }),
            () => {},
          )
          .fim.then(
            () => undefined,
            (erro: unknown) => erro,
          ),
      );
      assert.strictEqual((recusa as { _tag: string })._tag, "OperacaoNaoSuportada");
    }).pipe(Effect.scoped),
  );
});
