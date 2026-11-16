// @effect-diagnostics nodeBuiltinImport:off -- teste real: caminhos do checkout e pasta temporária
/**
 * As skills do app numa conversa real com o Claude, pela assinatura do usuário. Só roda com
 * `SIMPLIFICA_POC_REAL=1` (e `tmp/kb.sqlite` compilado):
 *
 *   SIMPLIFICA_POC_REAL=1 pnpm --filter @simplifica-if/server test skills-real
 *
 * As `Conversas` do servidor, no próprio processo, sobre o driver real do Claude e o `CatalogoSkills`
 * do `.agents/skills` do checkout, numa pasta de trabalho temporária. Uma pergunta curta que só a skill
 * `verificar-fundamentacao-normativa` responde (os rótulos de classificação dela): a IA precisa ler o
 * `SKILL.md` que o motor gravou em `.simplifica/skills/`, sem pedido de aprovação (a leitura dentro da
 * pasta de trabalho passa pela política). Só o Claude: o teste é o mínimo para conferir a entrega.
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as McpHttp from "@simplifica-if/mcp/http";
import * as Motor from "@simplifica-if/motor";
import * as Drivers from "@simplifica-if/motor/drivers";
import * as CatalogoSkills from "../src/CatalogoSkills.ts";
import * as Conversas from "../src/Conversas.ts";
import * as Banco from "../src/persistencia/Banco.ts";
import * as Historico from "../src/persistencia/Historico.ts";

const REAL = process.env.SIMPLIFICA_POC_REAL === "1";
const RAIZ = NodePath.resolve(import.meta.dirname, "../../..");
const PASTA_ESTADO =
  process.env.SIMPLIFICA_ESTADO ??
  NodePath.join(
    NodeOS.homedir(),
    process.platform === "darwin" ? "Library/Application Support/simplifica-if-poc" : ".simplifica-if-poc",
  );

const camada = Conversas.layer().pipe(
  Layer.provideMerge(Motor.layer),
  Layer.provide(Historico.layer),
  Layer.provide(CatalogoSkills.layer(NodePath.join(RAIZ, ".agents", "skills"))),
  Layer.provide(Banco.layerMemoria),
  Layer.provide(McpHttp.layer({ banco: NodePath.join(RAIZ, "tmp", "kb.sqlite") })),
  Layer.provide(Drivers.layerNode({ ambiente: process.env, pastaEstado: PASTA_ESTADO })),
  Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

const PERGUNTA =
  "Quais são os rótulos de classificação que a skill verificar-fundamentacao-normativa usa para cada alegação? " +
  "Responda só com a lista dos rótulos, exatamente como estão na skill.";

describe.skipIf(!REAL)("skills do app numa conversa real", () => {
  it.live(
    "claude: lê o SKILL.md de verificar-fundamentacao-normativa sem pedir aprovação",
    () =>
      Effect.gen(function* () {
        const pasta = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "simplifica-skills-real-"));
        const conversas = yield* Conversas.Conversas;
        const inicio = yield* Clock.currentTimeMillis;
        const id = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta });
        const eventos = [...(yield* Stream.runCollect(conversas.enviar(id, PERGUNTA)))];
        const tempo = (yield* Clock.currentTimeMillis) - inicio;

        const ferramentas = eventos.flatMap((evento) =>
          evento._tag === "FerramentaIniciada" ? [`${evento.nome} ${JSON.stringify(evento.entrada)}`] : [],
        );
        const pedidos = eventos.filter((evento) => evento._tag === "PedidoAprovacao");
        const texto = eventos.flatMap((evento) => (evento._tag === "TextoFinal" ? [evento.texto] : [])).join("\n");
        process.stderr.write(
          `[claude] skills: ${tempo} ms; ferramentas: ${ferramentas.join(" | ")}; pedidos: ${pedidos.length}\n${texto}\n`,
        );

        assert.isTrue(
          ferramentas.some((linha) => linha.includes("verificar-fundamentacao-normativa/SKILL.md")),
          "a IA leu o SKILL.md da skill",
        );
        assert.strictEqual(pedidos.length, 0);
        assert.include(texto, "CONFIRMADA COM RESSALVA");
        assert.include(texto, "FONTE AUSENTE OU NÃO CONSULTADA");
        NodeFS.rmSync(pasta, { recursive: true, force: true });
      }).pipe(Effect.provide(camada)),
    240_000,
  );
});
