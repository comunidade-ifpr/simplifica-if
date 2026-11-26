// @effect-diagnostics nodeBuiltinImport:off globalJsonInEffect:off -- teste: arquivos de verdade na pasta temporária
/**
 * "Isto está errado" (M1.12), pelo RPC do servidor de verdade com o driver falso (`test/apoio.ts`):
 * `relato.preparar` (a pergunta e a resposta do turno, as fontes, as versões e o destino da política,
 * nunca a pasta da tarefa) e `relato.registrar` (o registro local e o `.md` em `Relatos de erro`, fora
 * da pasta da tarefa, sem sobrescrever).
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, it, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { PASTA_RELATOS } from "../src/PastasTrabalho.ts";
import { textoDoTurno } from "../src/Relatos.ts";
import * as Servidor from "../src/servidor.ts";
import {
  bancoFixture,
  cliente,
  diretorioTemporario,
  layerDriversFalsos,
  limparTemporarios,
  novoRegistro,
  TOKEN,
  turnoRpc,
} from "./apoio.ts";

afterAll(limparTemporarios);

const AUTORIZACAO = { authorization: `Bearer ${TOKEN}` };
const raiz = NodePath.join(diretorioTemporario("simplifica-trabalhos-"), "Simplifica IF");
const fora = diretorioTemporario("simplifica-fora-");

const camada = Servidor.layer({
  primeiroUsoFeito: true,
  banco: bancoFixture(),
  token: Redacted.make(TOKEN),
  pastaTrabalhos: raiz,
  pastaSkills: NodePath.resolve(import.meta.dirname, "../../../catalogo/skills"),
  pastaTarefas: NodePath.resolve(import.meta.dirname, "../../../catalogo/tarefas"),
  relatos: { curadoria: { repositorio: "exemplo/simplifica-if", rotulos: ["relato-do-app"] } },
}).pipe(Layer.provide(layerDriversFalsos(novoRegistro())), Layer.provide(NodeServices.layer));

it("textoDoTurno: a mensagem da pessoa e os TextoFinal do turno", () => {
  const { pergunta, resposta } = textoDoTurno(
    [
      { _tag: "Mensagem", turno: 1, ordem: 1, texto: "primeira" },
      { _tag: "EventoTurno", turno: 1, ordem: 2, evento: { _tag: "TextoFinal", texto: "um" } },
      { _tag: "Mensagem", turno: 2, ordem: 3, texto: "segunda" },
      { _tag: "EventoTurno", turno: 2, ordem: 4, evento: { _tag: "TextoFinal", texto: "dois" } },
      { _tag: "EventoTurno", turno: 2, ordem: 5, evento: { _tag: "FimTurno", motivo: "concluido" } },
      { _tag: "EventoTurno", turno: 2, ordem: 6, evento: { _tag: "TextoFinal", texto: "três" } },
    ],
    2,
  );
  assert.strictEqual(pergunta, "segunda");
  assert.strictEqual(resposta, "dois\n\ntrês");
});

layer(camada, { excludeTestServices: true })("relato", (it) => {
  it.effect("relato: o rascunho do turno, o arquivo em Relatos de erro e o registro", () =>
    Effect.gen(function* () {
      const { urlRpc } = yield* Servidor.ServidorApp;
      const rpc = yield* cliente(urlRpc, AUTORIZACAO);
      const { pasta } = yield* rpc["pasta.criar"]({ titulo: "Relato" });
      NodeFS.writeFileSync(NodePath.join(pasta, "anexo-secreto.md"), "CONTEUDO DO ANEXO\n");
      const { sessao } = yield* rpc["conversa.iniciar"]({
        provider: "claude",
        pastaTrabalho: pasta,
        tarefa: "conferir-fundamentacao-normativa",
      });
      yield* turnoRpc(
        rpc,
        sessao,
        "O estágio? ifpr://norma/br/cne-cp/res/2021/1#art20 e https://www.planalto.gov.br/ccivil_03/leis/l7498.htm.",
      );

      const rascunho = yield* rpc["relato.preparar"]({ sessao, turno: 1 });
      assert.strictEqual(
        rascunho.pergunta,
        "O estágio? ifpr://norma/br/cne-cp/res/2021/1#art20 e https://www.planalto.gov.br/ccivil_03/leis/l7498.htm.",
      );
      // O driver falso ecoa o que recebeu (com a indicação da skill, que só vai à IA).
      assert.match(
        rascunho.resposta,
        /^Resposta a: [\s\S]*O estágio\? ifpr:\/\/norma\/br\/cne-cp\/res\/2021\/1#art20 e https:\/\/www\.planalto\.gov\.br\/ccivil_03\/leis\/l7498\.htm\.$/,
      );
      assert.deepStrictEqual(rascunho.citacoes, ["ifpr://norma/br/cne-cp/res/2021/1#art20"]);
      assert.deepStrictEqual(rascunho.fontesExternas, ["https://www.planalto.gov.br/ccivil_03/leis/l7498.htm"]);
      assert.deepInclude(rascunho.versoes, { provider: "claude", versaoProvider: "0.0.0-teste", app: "0.0.0" });
      assert.strictEqual(rascunho.versoes.tarefa?.id, "conferir-fundamentacao-normativa");
      assert.strictEqual(rascunho.versoes.tarefa?.skill?.nome, "verificar-fundamentacao-normativa");
      assert.strictEqual(rascunho.repositorio, "exemplo/simplifica-if");
      assert.isTrue(rascunho.podeSalvar);
      // O pacote nunca traz a pasta da tarefa nem os anexos.
      assert.notMatch(JSON.stringify(rascunho), /CONTEUDO DO ANEXO|anexo-secreto/);

      const semResposta = yield* Effect.exit(rpc["relato.preparar"]({ sessao, turno: 5 }));
      assert.match(JSON.stringify(semResposta), /não tem resposta da IA/);
      const desconhecida = yield* Effect.exit(rpc["relato.preparar"]({ sessao: "nao-existe", turno: 1 }));
      assert.match(JSON.stringify(desconhecida), /SessaoDesconhecida/);

      const relato = { sessao, turno: 1, titulo: "Isto está errado: art. 20", corpo: "## O que está errado\n\nX\n" };
      const salvo = yield* rpc["relato.registrar"]({ ...relato, via: "arquivo" });
      assert.isNotNull(salvo.arquivo);
      // Fora da pasta da tarefa (a IA não lê): em Documentos/Simplifica IF/Relatos de erro.
      assert.strictEqual(
        NodeFS.realpathSync(NodePath.dirname(salvo.arquivo!)),
        NodePath.join(NodePath.dirname(pasta), PASTA_RELATOS),
      );
      assert.match(NodePath.basename(salvo.arquivo!), /^Relato - \d{4}-\d{2}-\d{2} \(mensagem 1\)\.md$/);
      assert.deepStrictEqual(
        NodeFS.readdirSync(pasta).filter((nome) => !nome.startsWith(".")),
        ["anexo-secreto.md"],
      );
      assert.strictEqual(
        NodeFS.readFileSync(salvo.arquivo!, "utf8"),
        "# Isto está errado: art. 20\n\n## O que está errado\n\nX\n",
      );
      const deNovo = yield* rpc["relato.registrar"]({ ...relato, via: "arquivo" });
      assert.match(deNovo.arquivo!, / \(2\)\.md$/);
      const turnoInvalido = yield* Effect.exit(rpc["relato.registrar"]({ ...relato, turno: 0.5, via: "arquivo" }));
      assert.match(JSON.stringify(turnoInvalido), /não existe na conversa/);
      // Nenhuma tarefa ganha o nome da pasta dos relatos.
      const homonima = yield* rpc["pasta.criar"]({ titulo: PASTA_RELATOS });
      assert.strictEqual(NodePath.basename(homonima.pasta), `${PASTA_RELATOS} (2)`);
      const copiado = yield* rpc["relato.registrar"]({ ...relato, via: "copia" });
      assert.isNull(copiado.arquivo);
      assert.isAbove(copiado.id, deNovo.id);

      // A conversa com pasta escolhida à mão também salva, em Relatos de erro, com o nome da pasta dela.
      const avulsa = yield* rpc["conversa.iniciar"]({ provider: "claude", pastaTrabalho: fora });
      yield* turnoRpc(rpc, avulsa.sessao, "oi");
      assert.isTrue((yield* rpc["relato.preparar"]({ sessao: avulsa.sessao, turno: 1 })).podeSalvar);
      const daAvulsa = yield* rpc["relato.registrar"]({ ...relato, sessao: avulsa.sessao, via: "arquivo" });
      assert.strictEqual(
        NodeFS.realpathSync(NodePath.dirname(daAvulsa.arquivo!)),
        NodePath.join(NodePath.dirname(pasta), PASTA_RELATOS),
      );
      assert.isTrue(NodePath.basename(daAvulsa.arquivo!).startsWith(NodePath.basename(fora)));
    }).pipe(Effect.scoped),
  );
});
