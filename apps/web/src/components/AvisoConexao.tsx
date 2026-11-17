/**
 * O aviso no topo das telas quando a interface não fala com o servidor local: sem servidor configurado
 * (o navegador em desenvolvimento, sem `?servidor=…&token=…`) ou depois de uma queda. O texto é o da
 * pessoa (M1.14); o técnico, com o que fazer em desenvolvimento, fica em "Detalhes técnicos".
 */
import { PlugZapIcon, ServerOffIcon } from "lucide-react";
import { detalheFalha, mensagemFalha } from "../conexao/ingresso.ts";
import { useEstadoConexao } from "../contexto.tsx";
import { DetalhesTecnicos } from "./AvisoErro.tsx";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert.tsx";

export function AvisoConexao() {
  const estado = useEstadoConexao();
  if (estado.fase === "sem-servidor") {
    return (
      <Alert variant="warning">
        <ServerOffIcon />
        <AlertTitle>{mensagemFalha("sem-servidor")}</AlertTitle>
        <AlertDescription>
          <p>Feche e abra o Simplifica IF de novo. Se continuar, avise a equipe do Simplifica IF.</p>
          <DetalhesTecnicos detalhe={detalheFalha("sem-servidor")} />
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
          <p>O app continua tentando. Se não voltar em alguns segundos, feche e abra o Simplifica IF de novo.</p>
          <DetalhesTecnicos detalhe={detalheFalha(estado.motivo)} />
        </AlertDescription>
      </Alert>
    );
  }
  return null;
}
