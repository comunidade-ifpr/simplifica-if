/**
 * A conversa da interface (`ControleConversa`, a mesma que as telas usam) contra o `apps/server` de
 * verdade, por RPC: iniciar, o texto parcial e o final com o link `ifpr://`, as ferramentas como
 * etapas, a aprovação, interromper, soltar sem encerrar, e a leitura do link pelo `GrupoLeitura`.
 */
import { afterAll, assert, layer } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Servidor from "@simplifica-if/server";
import type { Api } from "../src/conexao/api.ts";
import { ControleConversa } from "../src/conversa/ControleConversa.ts";
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
      inicializar({ tipo: "navegador", credenciais: { urlServidor: urlServidor(porta), token: TOKEN } }),
    ),
  ),
  (iniciado) => Effect.promise(() => iniciado.encerrar()),
);

/**
 * A `Api` com a queda da conexão sob comando: `derrubar` corta o acompanhamento em curso como o socket
 * que cai (o stream rejeita com `RpcClientError`), sem parar nada no servidor.
 */
const comQueda = (api: Api) => {
  let derrubar: (() => void) | undefined;
  const instavel: Api = {
    ...api,
    acompanhar: (fluxo, aoItem) => {
      let ativo = true;
      const real = api.acompanhar(fluxo, (item) => {
        if (ativo) aoItem(item);
      });
      const queda = new Promise<never>((_, rejeitar) => {
        derrubar = () => {
          ativo = false;
          real.cancelar();
          rejeitar({ _tag: "RpcClientError", message: "socket fechado" });
        };
      });
      return { fim: Promise.race([real.fim, queda]), cancelar: real.cancelar };
    },
  };
  return { api: instavel, derrubar: () => derrubar?.() };
};

layer(layerServidor(), { excludeTestServices: true })("conversa pela interface", (it) => {
  it.effect("inicia, recebe texto parcial e final, ferramentas e o link ifpr://, e responde à aprovação", () =>
    Effect.gen(function* () {
      const { contexto } = yield* app;
      const { api } = contexto;
      const conversa = contexto.conversas.novo("claude").controle;

      // Pasta que não existe: o erro do servidor, em português.
      yield* Effect.promise(() =>
        conversa
          .comecarTarefa({
            ia: { provider: "claude" },
            pasta: `${pasta}/nao-existe`,
            pedido: "Oi",
          })
          .catch(() => undefined),
      );
      assert.match(conversa.obter().erroInicio?.texto ?? "", /^A pasta da tarefa precisa ser o caminho completo/);

      yield* Effect.promise(() =>
        conversa.comecarTarefa({
          ia: { provider: "claude" },
          pasta,
          pedido: "Pode escrever um resumo da DCN?",
        }),
      );
      assert.isDefined(conversa.obter().sessao);

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
        ["pessoa", "resposta", "ferramenta", "aprovacao", "resposta", "resposta"],
      );
      assert.deepInclude(fim.itens[3], { situacao: "permitida" });
      // Cada bloco de texto é uma resposta: o de antes da ferramenta, o da aprovação e o do link.
      assert.deepInclude(fim.itens[1], { texto: "Vou consultar a base.", final: true });
      assert.deepInclude(fim.itens[4], { texto: "Escrevi o resumo.md.", final: true });
      const resposta = fim.itens[5];
      assert.isTrue(resposta?.tipo === "resposta" && resposta.final && resposta.texto.includes(LINK_DEMONSTRACAO));
      assert.deepStrictEqual(fim.uso, { entrada: 1234, saida: 56 });

      // O painel de leitura: o link da resposta, lido da base pelo RPC.
      const id = LINK_DEMONSTRACAO.replace("ifpr://norma/", "");
      const ficha = yield* Effect.promise(() => api.chamar((cliente) => cliente.fichaNorma({ id })));
      assert.include(JSON.stringify(ficha), "Diretrizes");
    }).pipe(Effect.scoped),
  );

  it.effect("interrompe a resposta em andamento; soltar a conversa não encerra a sessão", () =>
    Effect.gen(function* () {
      const { contexto } = yield* app;
      const conversa = contexto.conversas.novo("antigravity").controle;
      const sessao = yield* Effect.promise(() =>
        conversa.comecarTarefa({
          ia: { provider: "antigravity" },
          pasta,
          pedido: "Uma resposta demorada, por favor",
        }),
      );
      yield* esperar(conversa, (estado) =>
        estado.itens.some((item) => item.tipo === "resposta" && item.texto.includes("demorar")),
      );
      yield* Effect.promise(() => conversa.interromper());
      const interrompida = yield* esperar(conversa, (estado) => estado.fase === "pronta");
      assert.deepInclude(interrompida.itens.at(-1), { tipo: "aviso", texto: "Resposta interrompida." });

      // A sessão continua: outro turno funciona.
      conversa.enviar("E agora?");
      yield* esperar(conversa, (estado) => estado.fase === "pronta" && estado.itens.length > interrompida.itens.length);

      // Ninguém mais a mostra: a interface para de acompanhá-la, e a sessão do provider fica aberta no servidor.
      conversa.parar();
      const { api } = contexto;
      const lista = yield* Effect.promise(() => api.chamar((cliente) => cliente["conversa.listar"]({})));
      assert.deepInclude(
        lista.find((gravada) => gravada.id === sessao),
        { estado: "pronta", titulo: "Uma resposta demorada, por favor", turnos: 2 },
      );
    }).pipe(Effect.scoped),
  );

  it.effect("recarregar a interface: a conversa volta com o histórico e com o resto da resposta em andamento", () =>
    Effect.gen(function* () {
      const primeira = (yield* app).contexto.conversas.novo("claude").controle;
      const sessao = yield* Effect.promise(() =>
        primeira.comecarTarefa({
          ia: { provider: "claude" },
          pasta,
          pedido: "Qual é a DCN da EPT?",
        }),
      );
      const respondida = yield* esperar(primeira, (estado) => estado.fase === "pronta" && estado.itens.length > 1);

      // Outra interface (a tela recarregada) abre a mesma conversa pelo id.
      const segunda = new ControleConversa((yield* app).contexto.api);
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
      void segunda.enviar("Uma resposta demorada");
      yield* esperar(segunda, (estado) =>
        estado.itens.some((item) => item.tipo === "resposta" && item.texto.includes("demorar")),
      );
      const terceira = new ControleConversa((yield* app).contexto.api);
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

  it.effect("a conexão que cai no meio da resposta: a interface retoma de onde parou, sem perder nem repetir", () =>
    Effect.gen(function* () {
      const { contexto } = yield* app;
      const { api, derrubar } = comQueda(contexto.api);
      const conversa = new ControleConversa(api);
      yield* Effect.promise(() =>
        conversa.comecarTarefa({
          ia: { provider: "claude" },
          pasta,
          pedido: "Uma resposta demorada",
        }),
      );
      yield* esperar(conversa, (estado) =>
        estado.itens.some((item) => item.tipo === "resposta" && item.texto.includes("demorar")),
      );
      derrubar();
      // O turno segue no servidor; a interface volta a acompanhá-lo e o interrompe.
      yield* Effect.promise(() => conversa.interromper());
      const fim = yield* esperar(conversa, (estado) => estado.fase === "pronta");
      assert.isFalse(fim.itens.some((item) => item.tipo === "aviso" && item.gravidade === "erro"));
      // A resposta aberta na queda voltou pelo texto acumulado do servidor, uma vez só.
      const abertas = fim.itens.filter((item) => item.tipo === "resposta" && item.texto.includes("demorar"));
      assert.deepStrictEqual(
        abertas.map((item) => (item.tipo === "resposta" ? [item.texto, item.final] : [])),
        [["Esta resposta vai demorar", true]],
      );
      assert.deepInclude(fim.itens.at(-1), { tipo: "aviso", texto: "Resposta interrompida." });
      assert.strictEqual(fim.estadoServidor, "pronta");
    }).pipe(Effect.scoped),
  );

  it.effect("o turno que falha com a sessão viva deixa a conversa pronta, não caída", () =>
    Effect.gen(function* () {
      const { contexto } = yield* app;
      const conversa = contexto.conversas.novo("codex").controle;
      yield* Effect.promise(() =>
        conversa.comecarTarefa({
          ia: { provider: "codex" },
          pasta,
          pedido: "Estourei o limite de uso?",
        }),
      );
      const fim = yield* esperar(
        conversa,
        (estado) => estado.fase === "pronta" && estado.itens.some((item) => item.tipo === "limite"),
      );
      assert.deepInclude(fim.itens.at(-1), { tipo: "limite", provider: "codex" });
      // A sessão do provider continua aberta: o servidor diz `pronta`, e a interface não fala em queda.
      assert.strictEqual(fim.estadoServidor, "pronta");
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
