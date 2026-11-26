/** O item "recente" do módulo no Início (`routes/index.tsx`, arquivo de composição). */
import type { ListaPendencias } from "@simplifica-if/contratos-app/modulos/revisao-ppc";
import { Link } from "@tanstack/react-router";
import { FileSearchIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useApi, useEstadoConexao } from "../../contexto.tsx";
import { nomeDoArquivo } from "../../lib/texto.ts";

/** A revisão de PPC mais recente, para continuar de onde parou. */
export function UltimaRevisao() {
  const api = useApi();
  const conectado = useEstadoConexao().fase === "conectada";
  const [lista, setLista] = useState<ListaPendencias | null>(null);
  useEffect(() => {
    if (!conectado) return;
    let vale = true;
    api
      .chamar((cliente) => cliente["revisaoPpc.listas"]({}))
      .then(
        (listas) => vale && setLista(listas[0] ?? null),
        () => undefined,
      );
    return () => {
      vale = false;
    };
  }, [api, conectado]);
  if (lista === null) return null;
  return (
    <Link
      to="/revisao-ppc"
      search={{ id: lista.id }}
      className="flex items-center gap-1.5 rounded-md px-2 py-1.5 font-medium text-sm hover:bg-accent"
    >
      <FileSearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">Revisão do PPC: {nomeDoArquivo(lista.arquivoOriginal)}</span>
    </Link>
  );
}
