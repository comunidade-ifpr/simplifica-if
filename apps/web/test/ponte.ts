import type { JanelaDesktop, PonteDesktop } from "@simplifica-if/contratos-app/ponte";

const JANELA_PADRAO: JanelaDesktop = {
  plataforma: "darwin",
  telaCheia: async () => false,
  aoMudarTelaCheia: () => () => {},
  temaDoApp: async () => {},
};

/** Uma `PonteDesktop` completa para testes, com os métodos pedidos sobrescritos. */
export function ponteTeste(parcial: Partial<PonteDesktop> = {}): PonteDesktop {
  return {
    conexao: () => Promise.reject(new Error("sem servidor")),
    abrirExterno: async () => {},
    escolherDocx: async () => null,
    soltarDocx: async () => null,
    abrirDocumento: async () => {},
    mostrarNaPasta: async () => {},
    escolherAnexo: async () => null,
    anexarSoltos: async (arquivos) => arquivos.map(() => null),
    abrirArquivoTarefa: async () => {},
    mostrarArquivoTarefa: async () => {},
    pastaParaLixeira: async () => {},
    reiniciarServidor: async () => {},
    registrarErro: async () => {},
    janela: JANELA_PADRAO,
    ...parcial,
  };
}
