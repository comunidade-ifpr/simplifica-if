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
      assert.deepStrictEqual(conversa.obter().erroInicio, { texto: "Escolha a pasta de trabalho da conversa." });
      // Pasta que não existe: o erro do servidor, em português.
      conversa.escolher({ provider: "claude", pastaTrabalho: `${pasta}/nao-existe` });
      yield* Effect.promise(() => conversa.iniciar());
      assert.match(conversa.obter().erroInicio?.texto ?? "", /^A pasta de trabalho precisa ser o caminho absoluto/);

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
      // A conversa antiga fica gravada, com a sessão do provider liberada.
      const { api } = contexto;
      const lista = yield* Effect.promise(() => api.chamar((cliente) => cliente["conversa.listar"]({})));
      assert.deepInclude(
        lista.find((gravada) => gravada.id === sessao),
        { estado: "liberada", titulo: "Uma resposta demorada, por favor", turnos: 2 },
      );
    }).pipe(Effect.scoped),
  );

  it.effect("recarregar a interface: a conversa volta com o histórico e com o resto da resposta em andamento", () =>
    Effect.gen(function* () {
      const primeira = (yield* app).contexto.conversa;
      primeira.escolher({ provider: "claude", pastaTrabalho: pasta });
      yield* Effect.promise(() => primeira.iniciar());
      const sessao = primeira.obter().sessao!;
      primeira.enviar("Qual é a DCN da EPT?");
      const respondida = yield* esperar(primeira, (estado) => estado.fase === "pronta" && estado.itens.length > 1);

      // Outra interface (a tela recarregada) abre a mesma conversa pelo id.
      const segunda = (yield* app).contexto.conversa;
      yield* Effect.promise(() => segunda.abrir(sessao));
      const aberta = segunda.obter();
      assert.strictEqual(aberta.fase, "pronta");
      assert.strictEqual(aberta.titulo, "Qual é a DCN da EPT?");
      assert.deepStrictEqual(
        aberta.itens.map((item) => item.tipo),
        respondida.itens.map((item) => item.tipo),
      );
      const ultima = aberta.itens.at(-1);
      assert.isTrue(ultima?.tipo === "resposta" && ultima.final && ultima.texto.includes(LINK_DEMONSTRACAO));

      // Uma resposta em andamento quando a tela recarrega: a nova tela a acompanha e a interrompe.
      segunda.enviar("Uma resposta demorada");
      yield* esperar(segunda, (estado) =>
        estado.itens.some((item) => item.tipo === "resposta" && item.texto.includes("demorar")),
      );
      const terceira = (yield* app).contexto.conversa;
      yield* Effect.promise(() => terceira.abrir(sessao));
      const acompanhando = yield* esperar(terceira, (estado) =>
        estado.itens.some((item) => item.tipo === "resposta" && item.texto.includes("demorar")),
      );
      assert.strictEqual(acompanhando.fase, "respondendo");
      yield* Effect.promise(() => terceira.interromper());
      const interrompida = yield* esperar(terceira, (estado) => estado.fase === "pronta");
      assert.deepInclude(interrompida.itens.at(-1), { tipo: "aviso", texto: "Resposta interrompida." });
      // A tela antiga também vê o fim do turno.
      yield* esperar(segunda, (estado) => estado.fase === "pronta");

      // Uma conversa que não existe.
      yield* Effect.promise(() => terceira.abrir("nao-existe"));
      assert.strictEqual(terceira.obter().fase, "configurando");
      assert.deepStrictEqual(terceira.obter().erroInicio, { texto: "Esta conversa não existe mais no app." });
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
