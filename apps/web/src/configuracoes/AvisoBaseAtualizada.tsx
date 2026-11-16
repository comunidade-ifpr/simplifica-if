/**
 * O aviso "Base atualizada" (M1.10): depois que o servidor abre com uma base nova, a lista de novidades
 * da versão (de `base-conhecimento/novidades.yaml`, levada pelo manifesto). Some quando a pessoa
 * fecha; o servidor guarda que ela viu. Componente isolado, montado na moldura das telas.
 */
import type { EstadoAtualizacao } from "@simplifica-if/contratos-app";
import { XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { useApi } from "../contexto.tsx";
import { rotuloNovidade, versaoComoData } from "./textos.ts";

export function AvisoBaseAtualizada() {
  const api = useApi();
  const [novidades, setNovidades] = useState<EstadoAtualizacao["novidades"]>(null);
  useEffect(() => {
    let ativo = true;
    api
      .chamar((cliente) => cliente["atualizacao.estado"]({}))
      .then((estado) => ativo && setNovidades(estado.novidades))
      .catch(() => undefined);
    return () => {
      ativo = false;
    };
  }, [api]);
  if (novidades === null) return null;
  const fechar = () => {
    setNovidades(null);
    void api.chamar((cliente) => cliente["atualizacao.novidadesVistas"]({})).catch(() => undefined);
  };
  return (
    <Alert variant="info">
      <AlertTitle className="flex items-center justify-between gap-2">
        Base atualizada: {versaoComoData(novidades.versao)}
        <Button size="icon-xs" variant="ghost" aria-label="Fechar o aviso" onClick={fechar}>
          <XIcon />
        </Button>
      </AlertTitle>
      <AlertDescription>
        {novidades.itens.length === 0 ? (
          <p>A base foi atualizada. As respostas passam a citar esta versão.</p>
        ) : (
          <ul className="list-disc pl-5">
            {novidades.itens.map((item) => (
              <li key={`${item.tipo}|${item.titulo}`}>
                <span className="font-medium">{rotuloNovidade(item)}:</span> {item.titulo}
                {item.detalhe === undefined ? null : <span className="text-muted-foreground"> ({item.detalhe})</span>}
              </li>
            ))}
          </ul>
        )}
      </AlertDescription>
    </Alert>
  );
}
