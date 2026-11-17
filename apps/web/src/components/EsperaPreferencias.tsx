/**
 * Enquanto as preferências do primeiro uso (M1.8) não chegam: o indicador de carregamento ou, se a
 * leitura falhou, o erro com "Tentar de novo". A tela nunca fica girando sem fim.
 */
import { RotateCcwIcon } from "lucide-react";
import { usePreferencias } from "../tarefas/perfil.ts";
import { AvisoErro } from "./AvisoErro.tsx";
import { Button } from "./ui/button.tsx";
import { Spinner } from "./ui/spinner.tsx";

export function EsperaPreferencias({ telaInteira = true }: { readonly telaInteira?: boolean }) {
  const { erro, recarregar } = usePreferencias();
  const conteudo =
    erro === undefined ? (
      <Spinner />
    ) : (
      <div className="flex max-w-md flex-col gap-3">
        <AvisoErro erro={{ ...erro, texto: `Não foi possível ler suas preferências. ${erro.texto}` }} />
        <Button className="self-start" variant="outline" onClick={recarregar}>
          <RotateCcwIcon /> Tentar de novo
        </Button>
      </div>
    );
  return telaInteira ? <div className="flex h-full items-center justify-center p-6">{conteudo}</div> : conteudo;
}
