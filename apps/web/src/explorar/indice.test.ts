import type { DadosIndice } from "@simplifica-if/contratos-app";
import { expect, it } from "vite-plus/test";
import type { Api } from "../conexao/api.ts";
import type { EstadoConexao } from "../conexao/Conexao.ts";
import { carregarIndice, indiceGuardado } from "./indice.ts";

/** Uma `Api` de mentira: conta as leituras do índice e deixa mudar a fase da conexão. */
function apiDeTeste() {
  let fase: EstadoConexao = { fase: "conectada" };
  const avisos = new Set<() => void>();
  let leituras = 0;
  const dados = { normas: [], cursos: [], ppcs: [], campi: [], cnct: [], processos: [], reunioes: [] };
  const api = {
    chamar: () => {
      leituras++;
      return Promise.resolve({ dados: dados as DadosIndice });
    },
    estado: {
      obter: () => fase,
      observar: (aviso: () => void) => {
        avisos.add(aviso);
        return () => avisos.delete(aviso);
      },
    },
  } as unknown as Api;
  return {
    api,
    leituras: () => leituras,
    mudar: (nova: EstadoConexao) => {
      fase = nova;
      for (const aviso of avisos) aviso();
    },
  };
}

it("o índice guardado vale para a conexão: cai a conexão, ele é esquecido e lido de novo", async () => {
  const teste = apiDeTeste();
  await carregarIndice(teste.api).promessa;
  expect(indiceGuardado(teste.api)?.fase).toBe("lido");
  // a mesma conexão não lê de novo
  await carregarIndice(teste.api).promessa;
  expect(teste.leituras()).toBe(1);
  // o servidor reiniciou (talvez com outra base): esquece
  teste.mudar({ fase: "reconectando", tentativa: 1, motivo: "queda" } as unknown as EstadoConexao);
  expect(indiceGuardado(teste.api)).toBeUndefined();
  teste.mudar({ fase: "conectada" });
  await carregarIndice(teste.api).promessa;
  expect(teste.leituras()).toBe(2);
});
