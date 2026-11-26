/**
 * O contrato do módulo `revisao-ppc` no `GrupoApp`: os métodos do `GrupoRevisaoPpc` entram todos, com o
 * prefixo `revisaoPpc.`, e o `GrupoApp` é a soma exata dos grupos, sem colisão de nome.
 */
import { assert, describe, it } from "@effect/vitest";
import {
  GrupoApp,
  GrupoAtualizacao,
  GrupoConversa,
  GrupoDiagnostico,
  GrupoLeitura,
  GrupoPasta,
  GrupoPreferencias,
  GrupoProviders,
  GrupoRelato,
  GrupoTarefas,
} from "../../src/contratos.ts";
import { GrupoRevisaoPpc } from "../../src/modulos/revisao-ppc.ts";

describe("contrato da revisão de PPC", () => {
  it("o GrupoApp tem os métodos do módulo e é a soma exata dos dez grupos", () => {
    const metodos = [...GrupoApp.requests.keys()];
    const doModulo = [...GrupoRevisaoPpc.requests.keys()];
    assert.isTrue(doModulo.every((metodo) => metodo.startsWith("revisaoPpc.")));
    assert.includeMembers(metodos, doModulo);
    assert.includeMembers(metodos, ["revisaoPpc.revisar", "revisaoPpc.revisarArquivoNovo"]);
    const todos = [
      GrupoProviders,
      GrupoConversa,
      GrupoRelato,
      GrupoDiagnostico,
      GrupoTarefas,
      GrupoPasta,
      GrupoRevisaoPpc,
      GrupoAtualizacao,
      GrupoPreferencias,
      GrupoLeitura,
    ].flatMap((grupo) => [...grupo.requests.keys()]);
    assert.strictEqual(metodos.length, todos.length);
  });
});
