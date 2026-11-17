// @effect-diagnostics nodeBuiltinImport:off globalJsonInEffect:off -- teste: arquivos de verdade na pasta temporária
/**
 * "Isto está errado" (M1.12) e o aviso ao anexar (M1.13), pelo RPC do servidor de verdade com o driver
 * falso (`test/apoio.ts`):
 *
 * - `pasta.conferirAnexo`: o detector no `Worker` sobre `.md` e `.docx` liberados pelo desktop, só com
 *   formas mascaradas na resposta; PDF "não conferido"; arquivo não liberado recusado.
 * - `relato.preparar`: a pergunta e a resposta do turno, as fontes, as versões e o destino da política;
 *   `relato.registrar`: o `.md` na pasta da tarefa sem sobrescrever e o registro local.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, it, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import { CAMINHO_LIBERAR_ARQUIVO } from "@simplifica-if/contratos-app";
import { comParagrafoFinal, montarDocx, par } from "@simplifica-if/docx/testes/sintetico";
import { textoDoTurno } from "../src/Relatos.ts";
import * as Servidor from "../src/servidor.ts";
import {
  bancoFixture,
  cliente,
  diretorioTemporario,
  layerDriversFalsos,
  limparTemporarios,
  novoRegistro,
  pedirHttp,
  TOKEN,
} from "./apoio.ts";

afterAll(limparTemporarios);

const TOKEN_DESKTOP = "token-do-processo-principal-0123456789abcdef";
const AUTORIZACAO = { authorization: `Bearer ${TOKEN}` };
const raiz = NodePath.join(diretorioTemporario("simplifica-trabalhos-"), "Simplifica IF");
const fora = diretorioTemporario("simplifica-fora-");

const camada = Servidor.layer({
  primeiroUsoFeito: true,
  banco: bancoFixture(),
  token: Redacted.make(TOKEN),
  tokenDesktop: Redacted.make(TOKEN_DESKTOP),
  pastaTrabalhos: raiz,
  pastaSkills: NodePath.resolve(import.meta.dirname, "../../../.agents/skills"),
  relatos: { curadoria: { repositorio: "exemplo/simplifica-if", rotulos: ["relato-do-app"] } },
}).pipe(Layer.provide(layerDriversFalsos(novoRegistro())), Layer.provide(NodeServices.layer));

const liberar = (urlRpc: string, arquivo: string) =>
  pedirHttp(urlRpc.replace(/\/rpc$/, CAMINHO_LIBERAR_ARQUIVO), {
    metodo: "POST",
    cabecalhos: { authorization: `Bearer ${TOKEN_DESKTOP}`, "content-type": "application/json" },
    corpo: JSON.stringify({ arquivo }),
  });

it("textoDoTurno: a mensagem da pessoa e os TextoFinal do turno", () => {
  const { pergunta, resposta } = textoDoTurno(
    [
      { _tag: "Mensagem", turno: 1, ordem: 1, texto: "primeira" },
      { _tag: "EventoTurno", turno: 1, ordem: 2, evento: { _tag: "TextoFinal", texto: "um" } },
      { _tag: "Mensagem", turno: 2, ordem: 3, texto: "segunda" },
      { _tag: "EventoTurno", turno: 2, ordem: 4, evento: { _tag: "TextoFinal", texto: "dois" } },
      { _tag: "EventoTurno", turno: 2, ordem: 5, evento: { _tag: "FimTurno", motivo: "end_turn" } },
      { _tag: "EventoTurno", turno: 2, ordem: 6, evento: { _tag: "TextoFinal", texto: "três" } },
    ],
    2,
  );
  assert.strictEqual(pergunta, "segunda");
  assert.strictEqual(resposta, "dois\n\ntrês");
});

layer(camada, { excludeTestServices: true })("relato e aviso ao anexar", (it) => {
  it.effect("conferirAnexo: CPF no .md, celular no .docx, PDF não conferido, recusa sem liberação", () =>
    Effect.gen(function* () {
      const { urlRpc } = yield* Servidor.ServidorApp;
      const rpc = yield* cliente(urlRpc, AUTORIZACAO);

      const md = NodePath.join(fora, "lista.md");
      NodeFS.writeFileSync(md, "# Lista\n\nFulana, CPF 529.982.247-25\nContato: coordenacao@ifpr.edu.br\n");
      const semLiberar = yield* Effect.exit(rpc["pasta.conferirAnexo"]({ arquivo: md }));
      assert.isTrue(Exit.isFailure(semLiberar));
      assert.match(JSON.stringify(semLiberar), /Anexar arquivo/);

      yield* liberar(urlRpc, md);
      const doMd = yield* rpc["pasta.conferirAnexo"]({ arquivo: md });
      assert.deepStrictEqual(doMd, {
        arquivo: md,
        situacao: "conferido",
        total: 1,
        porTipo: { cpf: 1, rg: 0, telefone: 0, email: 0 },
        exemplos: [{ tipo: "cpf", onde: "linha 3", trecho: "Fulana, CPF 529.***.***-**" }],
      });
      // O dado inteiro não volta à interface.
      assert.notMatch(JSON.stringify(doMd), /982\.247/);

      const docx = NodePath.join(fora, "parecer.docx");
      NodeFS.writeFileSync(docx, montarDocx({ corpo: comParagrafoFinal(par("Celular da aluna: (41) 99876-5432")) }));
      yield* liberar(urlRpc, docx);
      const doDocx = yield* rpc["pasta.conferirAnexo"]({ arquivo: docx });
      assert.deepInclude(doDocx, { situacao: "conferido", total: 1 });

      const pdf = NodePath.join(fora, "ppc.pdf");
      NodeFS.writeFileSync(pdf, "%PDF-1.7\n");
      yield* liberar(urlRpc, pdf);
      assert.deepStrictEqual(yield* rpc["pasta.conferirAnexo"]({ arquivo: pdf }), {
        arquivo: pdf,
        situacao: "nao-conferido",
        motivo: "O app ainda não lê PDF para procurar dados pessoais.",
      });

      const quebrado = NodePath.join(fora, "quebrado.docx");
      NodeFS.writeFileSync(quebrado, "isto não é um zip");
      yield* liberar(urlRpc, quebrado);
      assert.deepInclude(yield* rpc["pasta.conferirAnexo"]({ arquivo: quebrado }), { situacao: "nao-conferido" });
    }).pipe(Effect.scoped),
  );

  it.effect("relato: o rascunho do turno, o arquivo na pasta da tarefa e o registro", () =>
    Effect.gen(function* () {
      const { urlRpc } = yield* Servidor.ServidorApp;
      const rpc = yield* cliente(urlRpc, AUTORIZACAO);
      const { pasta } = yield* rpc["pasta.criar"]({ titulo: "Relato" });
      NodeFS.writeFileSync(NodePath.join(pasta, "anexo-secreto.md"), "CONTEUDO DO ANEXO\n");
      const { sessao } = yield* rpc["conversa.iniciar"]({
        provider: "claude",
        pastaTrabalho: pasta,
        tarefa: "verificar-fundamentacao-normativa",
      });
      yield* rpc["conversa.enviar"]({ sessao, texto: "O estágio? ifpr://norma/br/cne-cp/res/2021/1#art20." }).pipe(
        Stream.runDrain,
      );

      const rascunho = yield* rpc["relato.preparar"]({ sessao, turno: 1 });
      assert.strictEqual(rascunho.pergunta, "O estágio? ifpr://norma/br/cne-cp/res/2021/1#art20.");
      // O driver falso ecoa o que recebeu (com a indicação da skill, que só vai à IA).
      assert.match(
        rascunho.resposta,
        /^Resposta a: [\s\S]*O estágio\? ifpr:\/\/norma\/br\/cne-cp\/res\/2021\/1#art20\.$/,
      );
      assert.deepStrictEqual(rascunho.citacoes, ["ifpr://norma/br/cne-cp/res/2021/1#art20"]);
      assert.deepInclude(rascunho.versoes, { provider: "claude", versaoProvider: "0.0.0-teste", app: "0.0.0" });
      assert.strictEqual(rascunho.versoes.tarefa?.nome, "verificar-fundamentacao-normativa");
      assert.strictEqual(rascunho.repositorio, "exemplo/simplifica-if");
      assert.isTrue(rascunho.temPasta);
      // O pacote nunca traz a pasta da tarefa nem os anexos.
      assert.notMatch(JSON.stringify(rascunho), /CONTEUDO DO ANEXO|anexo-secreto/);

      const semResposta = yield* Effect.exit(rpc["relato.preparar"]({ sessao, turno: 5 }));
      assert.match(JSON.stringify(semResposta), /não tem resposta da IA/);
      const desconhecida = yield* Effect.exit(rpc["relato.preparar"]({ sessao: "nao-existe", turno: 1 }));
      assert.match(JSON.stringify(desconhecida), /SessaoDesconhecida/);

      const relato = { sessao, turno: 1, titulo: "Isto está errado: art. 20", corpo: "## O que está errado\n\nX\n" };
      const salvo = yield* rpc["relato.registrar"]({ ...relato, via: "arquivo" });
      assert.isNotNull(salvo.arquivo);
      assert.strictEqual(NodePath.dirname(salvo.arquivo!), pasta);
      assert.match(NodePath.basename(salvo.arquivo!), /^Relato de erro - \d{4}-\d{2}-\d{2} \(mensagem 1\)\.md$/);
      assert.strictEqual(
        NodeFS.readFileSync(salvo.arquivo!, "utf8"),
        "# Isto está errado: art. 20\n\n## O que está errado\n\nX\n",
      );
      const deNovo = yield* rpc["relato.registrar"]({ ...relato, via: "arquivo" });
      assert.match(deNovo.arquivo!, / \(2\)\.md$/);
      const turnoInvalido = yield* Effect.exit(rpc["relato.registrar"]({ ...relato, turno: 0.5, via: "arquivo" }));
      assert.match(JSON.stringify(turnoInvalido), /não existe na conversa/);
      const copiado = yield* rpc["relato.registrar"]({ ...relato, via: "copia" });
      assert.isNull(copiado.arquivo);
      assert.isAbove(copiado.id, deNovo.id);

      // Numa conversa sem pasta de tarefa do app, não há onde salvar.
      const avulsa = yield* rpc["conversa.iniciar"]({ provider: "claude", pastaTrabalho: fora });
      yield* rpc["conversa.enviar"]({ sessao: avulsa.sessao, texto: "oi" }).pipe(Stream.runDrain);
      assert.isFalse((yield* rpc["relato.preparar"]({ sessao: avulsa.sessao, turno: 1 })).temPasta);
      const recusa = yield* Effect.exit(rpc["relato.registrar"]({ ...relato, sessao: avulsa.sessao, via: "arquivo" }));
      assert.match(JSON.stringify(recusa), /Copiar o relato/);
    }).pipe(Effect.scoped),
  );
});
