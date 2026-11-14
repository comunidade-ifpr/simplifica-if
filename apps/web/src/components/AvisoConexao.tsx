/**
 * O aviso no topo das telas quando a interface não fala com o servidor local: sem servidor configurado
 * (o navegador em desenvolvimento, sem `?servidor=…&token=…`) ou depois de uma queda.
 */
import { PlugZapIcon, ServerOffIcon } from "lucide-react";
import { mensagemFalha } from "../conexao/ingresso.ts";
import { useEstadoConexao } from "../contexto.tsx";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert.tsx";

export function AvisoConexao() {
  const estado = useEstadoConexao();
  if (estado.fase === "sem-servidor") {
    return (
      <Alert variant="warning">
        <ServerOffIcon />
        <AlertTitle>O app não sabe onde está o servidor local</AlertTitle>
        <AlertDescription>
          <p>
            No aplicativo de desktop, o servidor inicia sozinho. No navegador, em desenvolvimento, inicie o servidor
            (veja o <code>apps/web/README.md</code>) e abra esta página com{" "}
            <code>?servidor=&lt;porta&gt;&amp;token=…</code>.
          </p>
        </AlertDescription>
      </Alert>
    );
  }
  if (estado.fase === "reconectando" && estado.tentativa >= 2) {
    return (
      <Alert variant="error">
        <PlugZapIcon />
        <AlertTitle>{mensagemFalha(estado.motivo)}</AlertTitle>
        <AlertDescription>
          <p>
            O app continua tentando. Se o problema persistir, feche e abra o Simplifica IF de novo.
            {estado.motivo === "origem-recusada"
              ? " Em desenvolvimento, inicie o servidor com --origem igual ao endereço desta página."
              : ""}
          </p>
        </AlertDescription>
      </Alert>
    );
  }
  return null;
}
