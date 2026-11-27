import { expect, it } from "vite-plus/test";
import type { Api } from "../conexao/api.ts";
import type { EstadoConexao } from "../conexao/Conexao.ts";
import { memoriaDa } from "./carga.ts";

/** Uma `Api` de mentira, só com o estado da conexão, que o teste muda. */
function apiDeTeste() {
  let fase: EstadoConexao = { fase: "conectada" };
  const avisos = new Set<() => void>();
  const api = {
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
    mudar: (nova: EstadoConexao) => {
      fase = nova;
      for (const aviso of avisos) aviso();
    },
  };
}

it("a memória dos leitores é uma por conexão: os dois leitores a dividem, e ela se esquece quando a conexão cai", async () => {
  const teste = apiDeTeste();
  let leituras = 0;
  const ler = () => Promise.resolve(++leituras);
  const memoria = memoriaDa(teste.api);
  // a tela e o painel pegam a mesma memória: a segunda leitura do mesmo documento não vai ao servidor
  expect(memoriaDa(teste.api)).toBe(memoria);
  await memoria.obter("documento:ifpr://norma/a", ler).promessa;
  expect(memoriaDa(teste.api).obter("documento:ifpr://norma/a", ler).estado).toEqual({ fase: "lido", valor: 1 });
  expect(leituras).toBe(1);
  // outra conexão, outra memória
  expect(memoriaDa(apiDeTeste().api)).not.toBe(memoria);

  // o servidor reiniciou (talvez com outra base): esquece, e a próxima leitura vai à conexão nova
  teste.mudar({ fase: "reconectando", tentativa: 1, motivo: "queda" } as unknown as EstadoConexao);
  teste.mudar({ fase: "conectada" });
  await memoria.obter("documento:ifpr://norma/a", ler).promessa;
  expect(leituras).toBe(2);
});

it("esquecer por prefixo tira só as leituras do documento que saiu", async () => {
  const memoria = memoriaDa(apiDeTeste().api);
  let leituras = 0;
  const ler = () => Promise.resolve(++leituras);
  await memoria.obter("revisao-ppc:x/1", ler).promessa;
  await memoria.obter("revisao-ppc:xy/1", ler).promessa;
  memoria.esquecerPrefixo("revisao-ppc:x/");
  expect(memoria.obter("revisao-ppc:x/1", ler).estado.fase).toBe("carregando");
  expect(memoria.obter("revisao-ppc:xy/1", ler).estado).toEqual({ fase: "lido", valor: 2 });
});
