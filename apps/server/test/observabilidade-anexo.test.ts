// @effect-diagnostics nodeBuiltinImport:off globalJsonInEffect:off -- teste: arquivos de verdade na pasta temporária
/**
 * O caminho do anexo não chega aos traces nem aos logs: com a exportação `completo`, um anexo cujo
 * original some antes da cópia falha em todos os spans (RPC, handler, `PastasTrabalho.anexar`) sem que
 * o caminho, o nome do arquivo ou a pasta de origem apareçam em `traces.jsonl` ou `logs-otlp.jsonl`.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { ARQUIVO_LOGS, ARQUIVO_TRACES } from "../src/observabilidade/ArquivoOtlp.ts";
import * as Observabilidade from "../src/observabilidade/Observabilidade.ts";
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

type PedidoOtlp = Record<string, Array<Record<string, Array<Record<string, Array<unknown>>>>>>;

/** Os spans (ou os registros de log) de um arquivo OTLP/JSON, um pedido de exportação por linha. */
const registrosDe = (texto: string, recurso: string, escopo: string, itens: string): Array<unknown> =>
  texto
    .split("\n")
    .filter((linha) => linha !== "")
    .flatMap((linha) => {
      const pedido = JSON.parse(linha) as PedidoOtlp;
      return pedido[recurso]!.flatMap((r) => r[escopo]!).flatMap((s) => s[itens]!);
    });

const PASTA_DE_ORIGEM = "Pasta Sigilosa da Pessoa";
const NOME_DO_ANEXO = "Processo Disciplinar Fulano.pdf";

/**
 * Sobe o servidor com a exportação `completo` numa pasta temporária, tenta anexar `original` (que
 * `preparar` deixa no estado da falha) e devolve os spans e os registros de log gravados.
 */
const anexarComFalha = (preparar: (original: string) => void) =>
  Effect.gen(function* () {
    const logs = diretorioTemporario("simplifica-observabilidade-");
    const origem = NodePath.join(diretorioTemporario("simplifica-fora-"), PASTA_DE_ORIGEM);
    NodeFS.mkdirSync(origem);
    const original = NodePath.join(origem, NOME_DO_ANEXO);
    preparar(original);

    const servidor = Servidor.layer({
      primeiroUsoFeito: true,
      banco: bancoFixture(),
      token: Redacted.make(TOKEN),
      pastaTrabalhos: NodePath.join(diretorioTemporario("simplifica-trabalhos-"), "Simplifica IF"),
    }).pipe(Layer.provide(layerDriversFalsos(novoRegistro())));

    yield* Effect.gen(function* () {
      const { urlRpc } = yield* Servidor.ServidorApp;
      const rpc = yield* cliente(urlRpc, { authorization: `Bearer ${TOKEN}` });
      const { pasta } = yield* rpc["pasta.criar"]({ titulo: "Tarefa" });
      const anexo = yield* Effect.exit(rpc["pasta.anexar"]({ pasta, arquivo: original }));
      assert.isTrue(Exit.isFailure(anexo));
    }).pipe(
      Effect.scoped,
      Effect.provide(servidor),
      Effect.andThen(Observabilidade.descarregar),
      Effect.provide(Observabilidade.layer({ pastaLogs: logs, modo: "completo", versao: "0.0.0" })),
    );

    const ler = (nome: string) =>
      NodeFS.existsSync(NodePath.join(logs, nome)) ? NodeFS.readFileSync(NodePath.join(logs, nome), "utf8") : "";
    const spans = registrosDe(ler(ARQUIVO_TRACES), "resourceSpans", "scopeSpans", "spans").map((s) =>
      JSON.stringify(s),
    );
    const registros = registrosDe(ler(ARQUIVO_LOGS), "resourceLogs", "scopeLogs", "logRecords").map((r) =>
      JSON.stringify(r),
    );
    // Os spans e os registros que citam o anexo: o caminho, a pasta de origem ou o nome do arquivo.
    const proibidos = [original, origem, PASTA_DE_ORIGEM, NOME_DO_ANEXO, "Processo Disciplinar"];
    const vazamentos = [...spans, ...registros].filter((linha) => proibidos.some((p) => linha.includes(p)));
    return { spans, registros, vazamentos };
  });

describe("observabilidade do anexo", () => {
  it.effect("o original que some antes da cópia não deixa caminho nem nome em traces.jsonl e logs-otlp.jsonl", () =>
    Effect.gen(function* () {
      // Sem o arquivo: o `lstat` do original falha com o caminho na mensagem do Node.
      const { spans, registros, vazamentos } = yield* anexarComFalha(() => {});
      // O span do anexo foi gravado com o erro, e o log do RPC também: o teste olha o lugar certo.
      const anexar = spans.find((s) => s.includes('"name":"PastasTrabalho.anexar"'));
      assert.include(anexar, "O arquivo não foi encontrado ou não pode ser lido.");
      assert.include(anexar, "PlatformError NotFound em FileSystem.lstat (lstat)");
      assert.isTrue(registros.some((r) => r.includes("RPC pasta.anexar falhou")));
      assert.deepStrictEqual(vazamentos, []);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("o original que não pode ser lido na cópia também não deixa caminho nem nome", () =>
    Effect.gen(function* () {
      // O `lstat` passa e a leitura falha, dentro de `PastasTrabalho.copiarSemSobrescrever`.
      const { spans, vazamentos } = yield* anexarComFalha((original) => {
        NodeFS.writeFileSync(original, "%PDF-1.4\n");
        NodeFS.chmodSync(original, 0o000);
      });
      const copia = spans.find((s) => s.includes('"name":"PastasTrabalho.copiarSemSobrescrever"'));
      assert.include(copia, "Não foi possível ler o arquivo original.");
      assert.include(copia, "PlatformError PermissionDenied");
      assert.deepStrictEqual(vazamentos, []);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
