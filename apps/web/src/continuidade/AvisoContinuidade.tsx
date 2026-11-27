/**
 * O aviso, no topo das telas, do que não voltou ao reabrir o app por ter deixado de existir ("Esta revisão
 * foi apagada"), até a pessoa fechá-lo.
 */
import { HistoryIcon, XIcon } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { useApp, useContinuidade } from "../contexto.tsx";

export function AvisoContinuidade() {
  const { avisos } = useContinuidade();
  const { continuidade } = useApp();
  if (avisos.length === 0) return null;
  return (
    <Alert variant="info" role="status">
      <HistoryIcon />
      <AlertTitle>{avisos.join(". ")}</AlertTitle>
      <AlertDescription>
        <p>O app voltou onde você estava, sem o que deixou de existir.</p>
      </AlertDescription>
      <AlertAction>
        <Button variant="ghost" size="icon-sm" aria-label="Fechar o aviso" onClick={continuidade.fecharAvisos}>
          <XIcon />
        </Button>
      </AlertAction>
    </Alert>
  );
}
