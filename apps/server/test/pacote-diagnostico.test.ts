// @effect-diagnostics nodeBuiltinImport:off globalJsonInEffect:off globalDate:off -- teste: arquivos de verdade na pasta temporária
/**
 * "Gerar diagnóstico": o saneamento (cada regra, e as linhas OTLP continuam JSON válido), o limite de
 * tamanho, e `diagnostico.preparar` e `diagnostico.gerar` pelo RPC do servidor de verdade, com o `.zip`
 * lido de volta (`fflate`), com e sem pasta de logs.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, describe, it, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { strFromU8, unzipSync } from "fflate";
import {
  type Ambiente,
  aplicarLimite,
  ARQUIVO_LEIA_ME,
  ARQUIVO_SISTEMA,
  cortarNaPrimeiraLinha,
  MOTIVO_ILEGIVEL,
  MOTIVO_LIMITE,
  MOTIVO_NAO_ARQUIVO,
  nomeDoPacote,
} from "../src/diagnostico/Diagnostico.ts";
import {
  LIMITE_LINHA,
  MARCADOR_EMAIL,
  MARCADOR_PASTA_TAREFA,
  MARCADOR_SEGREDO,
  MARCADOR_USUARIO,
  sanearArquivo,
  sanearLinha,
  sanearTexto,
} from "../src/diagnostico/saneamento.ts";
import { PASTA_DIAGNOSTICOS } from "../src/PastasTrabalho.ts";
import * as Servidor from "../src/servidor.ts";
import {
  bancoFixture,
  cliente,
  diretorioTemporario,
  layerDriversFalsos,
  limparTemporarios,
  novoRegistro,
  TOKEN,
} from "./apoio.ts";

afterAll(limparTemporarios);

const CONTEXTO = { pastaPessoal: "/Users/fulana", usuario: "fulana" };
const CONTEXTO_WINDOWS = { pastaPessoal: "C:\\Users\\Fulana", usuario: "Fulana" };

describe("saneamento", () => {
  it("pasta pessoal vira ~; o nome de usuário só muda dentro de um caminho", () => {
    assert.strictEqual(
      sanearTexto("abrindo /Users/fulana/Documents/Simplifica IF (usuário fulana, Fulana.)", CONTEXTO),
      "abrindo ~/Documents/Simplifica IF (usuário fulana, Fulana.)",
    );
    // O usuário noutro caminho (outra pasta pessoal) vira o marcador.
    assert.strictEqual(sanearTexto("lendo /home/fulana/.config", CONTEXTO), `lendo /home/${MARCADOR_USUARIO}/.config`);
    // Windows: com `\` ou `/` e sem diferenciar maiúsculas.
    assert.strictEqual(
      sanearTexto("C:\\Users\\Fulana\\AppData e c:/users/fulana/x", CONTEXTO_WINDOWS),
      "~\\AppData e ~/x",
    );
    // Sem pasta nem usuário (ou curtos demais), nada se troca.
    assert.strictEqual(sanearTexto("/ e ab", { pastaPessoal: "/", usuario: "a" }), "/ e ab");
  });

  it("pasta pessoal: só com fronteira depois, em NFC, e em todas as formas do Windows", () => {
    const ana = { pastaPessoal: "/Users/ana", usuario: "ana" };
    assert.strictEqual(sanearTexto("/Users/ana/x /Users/ana", ana), "~/x ~");
    assert.strictEqual(sanearTexto("/Users/anabela/x /Users/ana.b/x", ana), "/Users/anabela/x /Users/ana.b/x");
    const jose = { pastaPessoal: "C:\\Users\\José da Silva", usuario: "José da Silva" };
    const casos: ReadonlyArray<readonly [string, string]> = [
      ["em C:\\Users\\José da Silva\\Documents", "em ~\\Documents"],
      // O logfmt e o JSON escapam a barra: `\\`.
      [
        'timestamp=x level=WARN message="falhou em C:\\\\Users\\\\José da Silva\\\\AppData" codigo=AB',
        'timestamp=x level=WARN message="falhou em ~\\\\AppData" codigo=AB',
      ],
      ["C:/Users/José da Silva/x", "~/x"],
      ["file:///C:/Users/Jos%C3%A9%20da%20Silva/Documents", "file:///~/Documents"],
      ["C%3A%5CUsers%5CJos%C3%A9%20da%20Silva%5Cx", "~%5Cx"],
      // O texto em NFD (o "é" decomposto) casa com a pasta em NFC.
      [`C:\\Users\\${"José".normalize("NFD")} da Silva\\x`, "~\\x"],
      // A forma curta 8.3.
      ["C:\\Users\\JOSDAS~1\\AppData", "~\\AppData"],
      // O nome solto fica.
      ["o José da Silva abriu", "o José da Silva abriu"],
    ];
    for (const [entrada, esperado] of casos) assert.strictEqual(sanearTexto(entrada, jose), esperado, entrada);
  });

  it("o usuário `servidor`: só nos caminhos; nem o service.name nem o [servidor] do log mudam", () => {
    const servidor = { pastaPessoal: "C:\\Users\\servidor", usuario: "servidor" };
    assert.strictEqual(
      sanearLinha('2026 [servidor] level=INFO message="servidor pronto em C:\\Users\\servidor\\x"', servidor),
      '2026 [servidor] level=INFO message="servidor pronto em ~\\x"',
    );
    assert.strictEqual(sanearLinha("lendo /home/servidor/x", servidor), `lendo /home/${MARCADOR_USUARIO}/x`);
    const otlp = JSON.stringify({
      resourceSpans: [
        {
          resource: { attributes: [{ key: "service.name", value: { stringValue: "simplifica-if-servidor" } }] },
          scopeSpans: [{ spans: [{ name: "RpcServer.servidor", traceId: "abcdef0123456789abcdef0123456789" }] }],
        },
      ],
    });
    assert.strictEqual(sanearLinha(otlp, servidor), otlp);
  });

  it("pastas de tarefa: o que vem depois da raiz vira [pasta da tarefa], em todas as formas", () => {
    const contexto = {
      pastaPessoal: "C:\\Users\\Maria",
      usuario: "maria",
      raizesTarefas: ["C:\\Users\\Maria\\Documents\\Simplifica IF", "/estado/copias"],
    };
    const pasta = "C:\\Users\\Maria\\Documents\\Simplifica IF\\Parecer sobre o PAD do servidor João Pereira";
    // A linha real do servidor antes da correção na fonte, no logfmt do stderr (barras escapadas).
    const linha = `timestamp=2026-11-21T10:00:00Z level=INFO fiber=#1 message=${JSON.stringify(
      `conversa abc (claude): sessão aberta em ${pasta}`,
    )} codigo=ABCD1234`;
    assert.strictEqual(
      sanearLinha(linha, contexto),
      `timestamp=2026-11-21T10:00:00Z level=INFO fiber=#1 message="conversa abc (claude): sessão aberta em ~\\\\Documents\\\\Simplifica IF\\\\${MARCADOR_PASTA_TAREFA}" codigo=ABCD1234`,
    );
    const casos: ReadonlyArray<readonly [string, string]> = [
      // O caminho de um anexo, entre aspas, numa mensagem do Node.
      [
        `ENOENT: open '${pasta}\\anexo sigiloso.pdf' (depois)`,
        `ENOENT: open '~\\Documents\\Simplifica IF\\${MARCADOR_PASTA_TAREFA}' (depois)`,
      ],
      [
        "file:///C:/Users/Maria/Documents/Simplifica%20IF/Parecer%20X/a.docx",
        `file:///~/Documents/Simplifica%20IF/${MARCADOR_PASTA_TAREFA}`,
      ],
      [
        "cópia em /estado/copias/abc-123/2/arquivos/Processo Fulano.pdf",
        `cópia em /estado/copias/${MARCADOR_PASTA_TAREFA}`,
      ],
      // A raiz sozinha fica.
      ["estado em C:\\Users\\Maria\\Documents\\Simplifica IF", "estado em ~\\Documents\\Simplifica IF"],
    ];
    for (const [entrada, esperado] of casos) assert.strictEqual(sanearTexto(entrada, contexto), esperado, entrada);
    // No OTLP, o atributo e a pilha do evento `exception`.
    const otlp = JSON.stringify({
      attributes: [{ key: "exception.stacktrace", value: { stringValue: `Error: falhou\n    em ${pasta}\\a.docx` } }],
    });
    assert.notInclude(sanearLinha(otlp, contexto), "Parecer");
  });

  it("e-mails viram [e-mail omitido]", () => {
    assert.strictEqual(
      sanearTexto("conta joão.silva+ifpr@ifpr.edu.br logada; outra: a_b@gmail.com.", CONTEXTO),
      `conta ${MARCADOR_EMAIL} logada; outra: ${MARCADOR_EMAIL}.`,
    );
    // Nome de pacote não é e-mail.
    assert.strictEqual(sanearTexto("import @effect/vitest", CONTEXTO), "import @effect/vitest");
  });

  it("tokens e chaves viram [segredo omitido]", () => {
    const casos: ReadonlyArray<readonly [string, string]> = [
      ["authorization: Bearer abcdefghij0123456789", `authorization: Bearer ${MARCADOR_SEGREDO}`],
      ["Authorization: Token abcdefghijklmnop", `Authorization: Token ${MARCADOR_SEGREDO}`],
      ["Proxy-Authorization: Negotiate YIIabcdefgh", `Proxy-Authorization: Negotiate ${MARCADOR_SEGREDO}`],
      ["Bearer abcdefghij0123456789 depois", `Bearer ${MARCADOR_SEGREDO} depois`],
      ["Cookie: sessao=abcdef123456; outro=xyz98765", `Cookie: ${MARCADOR_SEGREDO}`],
      ["Set-Cookie: sid=abcdef123456; Path=/", `Set-Cookie: ${MARCADOR_SEGREDO}`],
      [
        "ws://127.0.0.1:5000/rpc?ingresso=xYz123abc&outro=1",
        `ws://127.0.0.1:5000/rpc?ingresso=${MARCADOR_SEGREDO}&outro=1`,
      ],
      ["GET /?ingresso%3Dabcdef123456 HTTP", `GET /?ingresso%3D${MARCADOR_SEGREDO} HTTP`],
      ["tokenDesktop=segredo-longo", `tokenDesktop=${MARCADOR_SEGREDO}`],
      ['access_token: "abc.def.ghi"', `access_token: "${MARCADOR_SEGREDO}"`],
      ["senha=hunter22 password: abcd", `senha=${MARCADOR_SEGREDO} password: ${MARCADOR_SEGREDO}`],
      [
        "pwd=hunter2 passwd=hunter3 pass: hunter4",
        `pwd=${MARCADOR_SEGREDO} passwd=${MARCADOR_SEGREDO} pass: ${MARCADOR_SEGREDO}`,
      ],
      ["x-api-key: abcd1234efgh5678", `x-api-key: ${MARCADOR_SEGREDO}`],
      // Usuário e senha numa URL, com host sem domínio, IP ou domínio.
      ["proxy http://fulano:S3nh4Forte@proxy:3128", `proxy http://${MARCADOR_SEGREDO}@proxy:3128`],
      ["proxy http://fulano:S3nh4Forte@10.0.0.1:3128", `proxy http://${MARCADOR_SEGREDO}@10.0.0.1:3128`],
      ["proxy https://fulano:S3nh4@proxy.ifpr.edu.br", `proxy https://${MARCADOR_SEGREDO}@proxy.ifpr.edu.br`],
      ["chave sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUV", `chave ${MARCADOR_SEGREDO}`],
      ["chave sk-proj-ABCDEFGHIJKLMNOPQRSTUV", `chave ${MARCADOR_SEGREDO}`],
      ["AIzaSyA1234567890abcdefghijklmnopqrs", MARCADOR_SEGREDO],
      ["ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", MARCADOR_SEGREDO],
      ["jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdefghijk", `jwt ${MARCADOR_SEGREDO}`],
    ];
    for (const [entrada, esperado] of casos) assert.strictEqual(sanearTexto(entrada, CONTEXTO), esperado, entrada);
    // "task-…" não é chave; "bypass" não é rótulo.
    assert.strictEqual(
      sanearTexto("task-abcdefghijklmnopqrstu bypass=abcdefgh", CONTEXTO),
      "task-abcdefghijklmnopqrstu bypass=abcdefgh",
    );
  });

  it("segredo numérico: senha, pin e token longo saem; a contagem de tokens fica", () => {
    assert.strictEqual(
      sanearTexto("senha=12345678 pin: 123456 token=123456789012", CONTEXTO),
      `senha=${MARCADOR_SEGREDO} pin: ${MARCADOR_SEGREDO} token=${MARCADOR_SEGREDO}`,
    );
    assert.strictEqual(
      sanearTexto("input_tokens=1234 tokens_entrada=99999999999999 max_token=4096", CONTEXTO),
      "input_tokens=1234 tokens_entrada=99999999999999 max_token=4096",
    );
  });

  it("os dados pessoais da base: CPF, RG, celular, matrícula e SIAPE", () => {
    assert.strictEqual(
      sanearTexto(
        "CPF 123.456.789-09, RG 12.345.678-9, cel (41) 99999-8888, matrícula 20231234567, SIAPE 1234567",
        CONTEXTO,
      ),
      "CPF [CPF omitido], RG [RG omitido], cel [telefone omitido], matrícula [matrícula omitida], SIAPE [SIAPE omitido]",
    );
    // Um traceId que começa como uma matrícula fica intacto.
    const traceId = "20231234567abcdef0123456789abcde";
    assert.strictEqual(sanearTexto(`trace ${traceId}`, CONTEXTO), `trace ${traceId}`);
  });

  it("linhas OTLP continuam JSON válido, com os ids intactos e os segredos e a pasta pessoal trocados", () => {
    const pedido = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: "20231234567abcdef0123456789abcde",
                  spanId: "20231234567abcde",
                  startTimeUnixNano: "1763712345123456789",
                  name: "PastasTrabalho.criar",
                  attributes: [
                    { key: "pasta", value: { stringValue: '/Users/fulana/Documents/Simplifica IF/"Aspas"\\x' } },
                    { key: "http.request.header.authorization", value: { stringValue: "abc" } },
                    { key: "conta", value: { stringValue: "fulana@ifpr.edu.br" } },
                    { key: "tamanho", value: { intValue: "42" } },
                    { key: "uso.tokens_entrada", value: { intValue: "1234" } },
                    { key: "uso.tokens_saida", value: { stringValue: "567" } },
                    { key: "gen_ai.access_token", value: { intValue: "12" } },
                    { key: "x-api-key", value: { stringValue: "abcdef" } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const saida = sanearLinha(JSON.stringify(pedido), CONTEXTO);
    const lido = JSON.parse(saida);
    const span = lido.resourceSpans[0].scopeSpans[0].spans[0];
    assert.strictEqual(span.traceId, pedido.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.traceId);
    assert.strictEqual(span.spanId, "20231234567abcde");
    assert.strictEqual(span.startTimeUnixNano, "1763712345123456789");
    assert.deepStrictEqual(span.attributes, [
      { key: "pasta", value: { stringValue: '~/Documents/Simplifica IF/"Aspas"\\x' } },
      { key: "http.request.header.authorization", value: { stringValue: MARCADOR_SEGREDO } },
      { key: "conta", value: { stringValue: MARCADOR_EMAIL } },
      { key: "tamanho", value: { intValue: "42" } },
      { key: "uso.tokens_entrada", value: { intValue: "1234" } },
      { key: "uso.tokens_saida", value: { stringValue: "567" } },
      { key: "gen_ai.access_token", value: { intValue: "12" } },
      { key: "x-api-key", value: { stringValue: MARCADOR_SEGREDO } },
    ]);
    // Sem nada a trocar, a linha fica como estava.
    const limpa = '{"a": 1, "b": "nada"}';
    assert.strictEqual(sanearLinha(limpa, CONTEXTO), limpa);
    // Todo um arquivo: cada linha continua JSON.
    const arquivo = sanearArquivo(`${JSON.stringify(pedido)}\n${JSON.stringify(pedido)}\n`, CONTEXTO);
    for (const linha of arquivo.split("\n").filter((linha) => linha !== ""))
      assert.doesNotThrow(() => JSON.parse(linha));
  });

  it("linhas muito longas são cortadas antes das regras; no JSON, só o texto longo, e a linha continua JSON", () => {
    const longa = "x".repeat(LIMITE_LINHA + 500);
    const cortada = sanearLinha(longa, CONTEXTO);
    assert.strictEqual(cortada, `${"x".repeat(LIMITE_LINHA)} … [linha cortada]`);
    const json = sanearLinha(JSON.stringify({ mensagem: longa, n: 1 }), CONTEXTO);
    const lido = JSON.parse(json);
    assert.strictEqual(lido.mensagem, `${"x".repeat(LIMITE_LINHA)} … [cortado]`);
    assert.strictEqual(lido.n, 1);
    // O segredo cortado no meio: o rótulo ainda casa e esconde o pedaço.
    const segredo = `${"a ".repeat(LIMITE_LINHA / 2 - 5)}token=${"z".repeat(100)}`;
    assert.strictEqual(
      sanearLinha(segredo, CONTEXTO),
      `${"a ".repeat(LIMITE_LINHA / 2 - 5)}token=${MARCADOR_SEGREDO} … [linha cortada]`,
    );
  });

  // Um prazo generoso: as expressões lineares saneiam isto em milissegundos; com retrocesso quadrático,
  // levariam minutos.
  it(
    "uma linha de 5 MB sem espaço, e os padrões que levariam a retrocesso, saem em tempo linear",
    { timeout: 10_000 },
    () => {
      const cinco = 5 * 1024 * 1024;
      const contexto = { ...CONTEXTO, raizesTarefas: ["/Users/fulana/Documents/Simplifica IF"] };
      assert.strictEqual(sanearLinha("a".repeat(cinco), contexto).length, LIMITE_LINHA + " … [linha cortada]".length);
      const n = LIMITE_LINHA;
      const adversarios = [
        "a_".repeat(n / 2),
        "a-".repeat(n / 2),
        "a.".repeat(n / 2),
        "a@".repeat(n / 2),
        `${"a".repeat(60)}@b.`.repeat(n / 64),
        "\\".repeat(n),
        `/Users/fulana/Documents/Simplifica IF/${"\\\\".repeat(n / 2)}`,
        "token_".repeat(n / 6),
        "cookie:".repeat(n / 7),
        "authorization: x ".repeat(n / 17),
        "9".repeat(n),
        "http://a:b".repeat(n / 10),
        "C:\\Users\\".repeat(n / 9),
      ];
      for (const linha of adversarios) {
        sanearLinha(linha, contexto);
        sanearLinha(JSON.stringify({ texto: linha.repeat(200) }), contexto);
      }
    },
  );
});

describe("pacote", () => {
  const lido = (nome: string, bytes: number) => ({ nome, descricao: nome, conteudo: new Uint8Array(bytes) });

  it("acima do limite, os .1 saem primeiro, depois os maiores", () => {
    const lidos = [lido("a.log", 40), lido("a.log.1", 30), lido("b.jsonl", 50), lido("b.jsonl.1", 10)];
    assert.deepStrictEqual(aplicarLimite(lidos, 200).fora, []);
    const so1 = aplicarLimite(lidos, 95);
    assert.deepStrictEqual(
      so1.fora.map((item) => item.nome),
      ["a.log.1", "b.jsonl.1"],
    );
    assert.deepStrictEqual(
      so1.ficam.map((item) => item.nome),
      ["a.log", "b.jsonl"],
    );
    const maiores = aplicarLimite(lidos, 45);
    assert.deepStrictEqual(
      maiores.ficam.map((item) => item.nome),
      ["a.log"],
    );
    // O sistema.json e o LEIA-ME (`fixos`) contam no limite.
    assert.deepStrictEqual(
      aplicarLimite(lidos, 200, 110).fora.map((item) => item.nome),
      ["a.log.1", "b.jsonl.1"],
    );
  });

  it("a cauda começa na primeira linha inteira", () => {
    const bytes = new TextEncoder().encode("ha metade\nlinha 2\nlinha 3\n");
    assert.strictEqual(new TextDecoder().decode(cortarNaPrimeiraLinha(bytes)), "linha 2\nlinha 3\n");
  });

  it("o nome do pacote tem a data e a hora locais", () => {
    assert.strictEqual(nomeDoPacote(new Date(2026, 10, 21, 9, 5, 7)), "diagnostico-2026-11-21-090507.zip");
  });
});

/* ================================================================== pelo RPC */

const AUTORIZACAO = { authorization: `Bearer ${TOKEN}` };
const pastaPessoal = diretorioTemporario("simplifica-pessoal-");
const AMBIENTE: Ambiente = {
  pastaPessoal,
  usuario: "fulana",
  plataforma: "darwin",
  versaoSistema: "25.0.0",
  arquitetura: "arm64",
  node: "26.12.1",
  electron: null,
  fuso: "America/Sao_Paulo",
  idioma: "pt-BR",
};

const pastaLogs = NodePath.join(pastaPessoal, "Logs");
NodeFS.mkdirSync(pastaLogs, { recursive: true });
NodeFS.writeFileSync(
  NodePath.join(pastaLogs, "simplifica-if.log"),
  `2026-11-21 nivel=INFO msg="servidor pronto, estado em ${pastaPessoal}/estado" conta=fulana@ifpr.edu.br\n`,
);
NodeFS.writeFileSync(NodePath.join(pastaLogs, "simplifica-if.log.1"), "registro antigo\n".repeat(4000));
NodeFS.writeFileSync(
  NodePath.join(pastaLogs, "traces.jsonl"),
  `${JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: [{ traceId: "abcdef0123456789abcdef0123456789", name: `ler ${pastaPessoal}` }] }] }] })}\n`,
);

const raizA = NodePath.join(diretorioTemporario("simplifica-trabalhos-"), "Simplifica IF");
const camadaComLogs = Servidor.layer({
  primeiroUsoFeito: true,
  banco: bancoFixture(),
  token: Redacted.make(TOKEN),
  pastaTrabalhos: raizA,
  // Cabem o sistema.json, o LEIA-ME, o log atual e o `traces.jsonl`, não o `.1` (64 KB, nem a cauda dele).
  diagnostico: { pastaLogs, modoTraces: "caixa-preta", ambiente: AMBIENTE, limiteBytes: 40_000 },
}).pipe(Layer.provide(layerDriversFalsos(novoRegistro())), Layer.provide(NodeServices.layer));

layer(camadaComLogs, { excludeTestServices: true })("diagnóstico com logs", (it) => {
  it.effect("prévia e pacote: os logs saneados, o sistema.json e o LEIA-ME, sem passar do limite", () =>
    Effect.gen(function* () {
      const { urlRpc } = yield* Servidor.ServidorApp;
      const rpc = yield* cliente(urlRpc, AUTORIZACAO);
      yield* rpc["preferencias.usarIa"]({ provider: "codex", usar: false });

      const previa = yield* rpc["diagnostico.preparar"]({});
      assert.isTrue(previa.temLogs);
      assert.isTrue(previa.podeGerar);
      assert.deepStrictEqual(
        previa.itens.map((item) => item.nome),
        ["simplifica-if.log", "traces.jsonl", ARQUIVO_SISTEMA, ARQUIVO_LEIA_ME],
      );
      assert.deepStrictEqual(previa.foraDoPacote, [{ nome: "simplifica-if.log.1", motivo: MOTIVO_LIMITE }]);
      // A prévia mostra o fim de cada log, já saneado (o JSON resumido numa linha).
      assert.strictEqual(
        previa.itens[0]!.trecho,
        `2026-11-21 nivel=INFO msg="servidor pronto, estado em ~/estado" conta=${MARCADOR_EMAIL}`,
      );
      assert.strictEqual(previa.itens[1]!.trecho, "1 span(s): ler ~");
      assert.isUndefined(previa.itens[2]!.trecho);
      for (const item of previa.itens) assert.isAbove(item.bytes, 0);
      const sistema = JSON.parse(previa.sistema);
      assert.strictEqual(sistema.sistema.plataforma, "darwin");
      assert.strictEqual(sistema.uso.modo_traces, "caixa-preta");
      assert.strictEqual(sistema.uso.aviso_de_uso_aceito, true);
      assert.strictEqual(sistema.uso.conversas, 0);
      assert.deepInclude(sistema.ias.claude, { respondeu: true, instalada: true, versao: "0.0.0-teste" });
      // A IA desligada no app não é detectada.
      assert.deepStrictEqual(sistema.ias.codex, { estado: "desligada no app", usada_no_app: false });
      // Sem conta nem perfil.
      assert.notMatch(previa.sistema, /@|perfil|campus/);

      const gerado = yield* rpc["diagnostico.gerar"]({});
      assert.strictEqual(
        NodeFS.realpathSync(NodePath.dirname(gerado.arquivo)),
        NodeFS.realpathSync(NodePath.join(raizA, PASTA_DIAGNOSTICOS)),
      );
      assert.match(NodePath.basename(gerado.arquivo), /^diagnostico-\d{4}-\d{2}-\d{2}-\d{6}\.zip$/);
      const bytes = NodeFS.readFileSync(gerado.arquivo);
      assert.strictEqual(gerado.bytes, bytes.byteLength);
      const zip = unzipSync(new Uint8Array(bytes));
      assert.deepStrictEqual(Object.keys(zip).sort(), [
        ARQUIVO_LEIA_ME,
        "simplifica-if.log",
        ARQUIVO_SISTEMA,
        "traces.jsonl",
      ]);
      const log = strFromU8(zip["simplifica-if.log"]!);
      assert.strictEqual(
        log,
        `2026-11-21 nivel=INFO msg="servidor pronto, estado em ~/estado" conta=${MARCADOR_EMAIL}\n`,
      );
      const traces = strFromU8(zip["traces.jsonl"]!);
      const span = JSON.parse(traces.trim()).resourceSpans[0].scopeSpans[0].spans[0];
      assert.strictEqual(span.traceId, "abcdef0123456789abcdef0123456789");
      assert.strictEqual(span.name, "ler ~");
      const semData = (texto: string) => texto.replace(/"gerado_em": "[^"]*"/, "");
      assert.strictEqual(semData(strFromU8(zip[ARQUIVO_SISTEMA]!)), semData(previa.sistema));
      const leia = strFromU8(zip[ARQUIVO_LEIA_ME]!);
      assert.match(leia, /NÃO está aqui/);
      assert.include(leia, `- simplifica-if.log.1: ${MOTIVO_LIMITE}`);
      assert.match(leia, /\[pasta da tarefa\]/);
      // O pacote, com o sistema.json e o LEIA-ME, não passa do limite.
      assert.isAtMost(
        Object.values(zip).reduce((soma, conteudo) => soma + conteudo.byteLength, 0),
        40_000,
      );
      assert.match(leia, /pnpm traces --pasta/);
      // Nada da pasta pessoal nem do usuário em parte alguma.
      for (const conteudo of Object.values(zip)) assert.notInclude(strFromU8(conteudo), pastaPessoal);

      // Outro no mesmo segundo não sobrescreve.
      const outro = yield* rpc["diagnostico.gerar"]({});
      assert.notStrictEqual(outro.arquivo, gerado.arquivo);
    }),
  );
});

/* A cauda de um log grande, um "log" que é pasta e um que não se lê. */
const pastaLogsGrandes = NodePath.join(diretorioTemporario("simplifica-logs-grandes-"), "Logs");
NodeFS.mkdirSync(pastaLogsGrandes, { recursive: true });
const linhasGrandes = Array.from({ length: 20_000 }, (_, i) => `linha ${String(i).padStart(6, "0")} de registro`);
NodeFS.writeFileSync(NodePath.join(pastaLogsGrandes, "simplifica-if.log"), `${linhasGrandes.join("\n")}\n`);
NodeFS.mkdirSync(NodePath.join(pastaLogsGrandes, "traces.jsonl"));
const ilegivel = NodePath.join(pastaLogsGrandes, "logs-otlp.jsonl");
NodeFS.writeFileSync(ilegivel, "{}\n");
NodeFS.chmodSync(ilegivel, 0o000);
const limiteGrandes = 100_000;
const camadaLogsGrandes = Servidor.layer({
  primeiroUsoFeito: true,
  banco: bancoFixture(),
  token: Redacted.make(TOKEN),
  pastaTrabalhos: NodePath.join(diretorioTemporario("simplifica-trabalhos-"), "Simplifica IF"),
  diagnostico: { pastaLogs: pastaLogsGrandes, ambiente: AMBIENTE, limiteBytes: limiteGrandes },
}).pipe(Layer.provide(layerDriversFalsos(novoRegistro())), Layer.provide(NodeServices.layer));

layer(camadaLogsGrandes, { excludeTestServices: true })("diagnóstico com log grande e ilegível", (it) => {
  it.effect("o log grande entra pela cauda; o que não é arquivo e o que não se lê ficam de fora, com o motivo", () =>
    Effect.gen(function* () {
      const { urlRpc } = yield* Servidor.ServidorApp;
      const rpc = yield* cliente(urlRpc, AUTORIZACAO);
      const previa = yield* rpc["diagnostico.preparar"]({});
      const log = previa.itens.find((item) => item.nome === "simplifica-if.log");
      assert.isDefined(log);
      assert.match(log!.descricao, /Só o fim do arquivo/);
      assert.isBelow(log!.bytes, limiteGrandes);
      assert.isAbove(log!.bytes, limiteGrandes / 2);
      assert.strictEqual(log!.trecho?.split("\n").at(-1), linhasGrandes.at(-1));
      // Executado como root, o arquivo sem permissão ainda se lê.
      const semPermissao = process.getuid?.() === 0 ? [] : [{ nome: "logs-otlp.jsonl", motivo: MOTIVO_ILEGIVEL }];
      assert.deepStrictEqual(previa.foraDoPacote, [
        { nome: "traces.jsonl", motivo: MOTIVO_NAO_ARQUIVO },
        ...semPermissao,
      ]);

      const gerado = yield* rpc["diagnostico.gerar"]({});
      const zip = unzipSync(new Uint8Array(NodeFS.readFileSync(gerado.arquivo)));
      const texto = strFromU8(zip["simplifica-if.log"]!);
      // Começa numa linha inteira e termina na última.
      assert.match(texto, /^linha \d{6} de registro\n/);
      assert.notInclude(texto, linhasGrandes[0]!);
      assert.isTrue(texto.endsWith(`${linhasGrandes.at(-1)}\n`));
      const leia = strFromU8(zip[ARQUIVO_LEIA_ME]!);
      assert.include(leia, `- traces.jsonl: ${MOTIVO_NAO_ARQUIVO}`);
      assert.include(leia, "Só o fim do arquivo");
      assert.isAtMost(
        Object.values(zip).reduce((soma, conteudo) => soma + conteudo.byteLength, 0),
        limiteGrandes,
      );
    }),
  );
});

const raizB = NodePath.join(diretorioTemporario("simplifica-trabalhos-"), "Simplifica IF");
const camadaSemLogs = Servidor.layer({
  primeiroUsoFeito: true,
  banco: bancoFixture(),
  token: Redacted.make(TOKEN),
  pastaTrabalhos: raizB,
}).pipe(Layer.provide(layerDriversFalsos(novoRegistro())), Layer.provide(NodeServices.layer));

layer(camadaSemLogs, { excludeTestServices: true })("diagnóstico sem pasta de logs", (it) => {
  it.effect("o pacote leva só o sistema.json e o LEIA-ME, que diz que não havia registros", () =>
    Effect.gen(function* () {
      const { urlRpc } = yield* Servidor.ServidorApp;
      const rpc = yield* cliente(urlRpc, AUTORIZACAO);
      const previa = yield* rpc["diagnostico.preparar"]({});
      assert.isFalse(previa.temLogs);
      assert.deepStrictEqual(
        previa.itens.map((item) => item.nome),
        [ARQUIVO_SISTEMA, ARQUIVO_LEIA_ME],
      );
      const gerado = yield* rpc["diagnostico.gerar"]({});
      const zip = unzipSync(new Uint8Array(NodeFS.readFileSync(gerado.arquivo)));
      assert.deepStrictEqual(Object.keys(zip).sort(), [ARQUIVO_LEIA_ME, ARQUIVO_SISTEMA]);
      assert.match(strFromU8(zip[ARQUIVO_LEIA_ME]!), /Não havia registros do app/);
    }),
  );
});
