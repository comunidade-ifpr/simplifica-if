import type { JanelaDesktop, PonteDesktop } from "@simplifica-if/contratos-app/ponte";

const JANELA_PADRAO: JanelaDesktop = {
  plataforma: "darwin",
  telaCheia: async () => false,
  aoMudarTelaCheia: () => () => {},
  temaDoApp: async () => {},
};

/** Os métodos do núcleo, sem efeito. */
const PADRAO: Partial<PonteDesktop> = {
  conexao: () => Promise.reject(new Error("sem servidor")),
  abrirExterno: async () => {},
  escolherAnexo: async () => null,
  anexarSoltos: async (arquivos) => arquivos.map(() => null),
  abrirArquivoTarefa: async () => {},
  mostrarArquivoTarefa: async () => {},
  pastaParaLixeira: async () => {},
  reiniciarServidor: async () => {},
  registrarErro: async () => {},
  janela: JANELA_PADRAO,
};

/**
 * Uma `PonteDesktop` completa para testes, com os métodos pedidos sobrescritos. Os métodos que um módulo
 * junta à ponte (`apps/desktop/src/modulos/<nome>/preload.ts`) e o teste não passa respondem `null`, como
 * o diálogo cancelado: este apoio do núcleo não os conhece pelo nome.
 */
export function ponteTeste(parcial: Partial<PonteDesktop> = {}): PonteDesktop {
  const ponte: Partial<PonteDesktop> = { ...PADRAO, ...parcial };
  return new Proxy(ponte, {
    get: (alvo, chave) => (chave in alvo ? Reflect.get(alvo, chave) : async () => null),
  }) as PonteDesktop;
}
