/**
 * O que a revisão diz à continuidade do app (`continuidade/conferir.ts`) ao reabrir: a rota
 * `/revisao-ppc?id=…`, os links `ifpr://revisao-ppc/<lista>/…` do Ler e a origem `revisao-ppc:<lista>` da conversa
 * ao lado voltam só se a revisão ainda existe. A que foi apagada sai com "Esta revisão foi apagada".
 */
import type { Api } from "../../conexao/api.ts";
import type { ConferenciaModulo } from "../../continuidade/conferir.ts";

const LINK = /^ifpr:\/\/revisao-ppc\/([^/#]+)\//;
const ORIGEM = /^revisao-ppc:(.+)$/;

export function continuidadeDaRevisao(api: Api): () => Promise<ConferenciaModulo> {
  return async () => {
    const listas = await api.chamar((cliente) => cliente["revisaoPpc.listas"]({}));
    const existe = (id: string | undefined) => listas.some((lista) => lista.id === id);
    return {
      // A entrada da revisão (sem `id`, ou vazio) não volta, e não há o que avisar.
      rota: (pathname, busca) =>
        pathname === "/revisao-ppc" && typeof busca.id === "string" && busca.id !== "" ? existe(busca.id) : undefined,
      link: (link) => {
        const m = LINK.exec(link);
        return m === null ? undefined : existe(m[1]);
      },
      origem: (chave) => {
        const m = ORIGEM.exec(chave);
        return m === null ? undefined : existe(m[1]);
      },
      aviso: "Esta revisão foi apagada",
    };
  };
}
