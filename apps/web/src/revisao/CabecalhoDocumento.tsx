/**
 * O cabeçalho do documento revisado: o nome do arquivo e o curso, "Abrir no Word" (regrava a cópia
 * comentada com a situação atual e a abre) e o menu ⋯ com o resto: mostrar na pasta, enviar a versão
 * corrigida, exportar as discordâncias, revisar outro arquivo e apagar esta revisão.
 *
 * No navegador (sem o desktop), não há como abrir o Word: o botão grava a cópia e mostra onde ela está.
 */
import { EllipsisIcon, FileTextIcon } from "lucide-react";
import { Button } from "../components/ui/button.tsx";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../components/ui/menu.tsx";
import { Spinner } from "../components/ui/spinner.tsx";

export interface AcoesDocumento {
  readonly aoAbrirNoWord: () => void;
  readonly abrindo: boolean;
  /** Só no desktop. */
  readonly aoMostrarNaPasta: (() => void) | undefined;
  readonly aoEnviarCorrigida: () => void;
  /** Só quando há discordância registrada contra a conferência automática. */
  readonly aoExportar: (() => void) | undefined;
  readonly aoRevisarOutro: () => void;
  readonly aoApagar: () => void;
}

export function CabecalhoDocumento({
  nome,
  curso,
  acoes,
}: {
  readonly nome: string;
  /** "Técnico em Agropecuária, subsequente"; nulo sem o curso no CNCT. */
  readonly curso: string | null;
  readonly acoes: AcoesDocumento;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="break-words text-title">{nome}</p>
        {curso === null ? null : <p className="text-muted-foreground text-small">{curso}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button onClick={acoes.aoAbrirNoWord} disabled={acoes.abrindo}>
          {acoes.abrindo ? <Spinner /> : <FileTextIcon />} Abrir no Word
        </Button>
        <Menu>
          <MenuTrigger
            render={<Button variant="ghost" size="icon" aria-label="Mais ações do documento" title="Mais ações" />}
          >
            <EllipsisIcon />
          </MenuTrigger>
          <MenuPopup>
            {acoes.aoMostrarNaPasta === undefined ? null : (
              <MenuItem onClick={acoes.aoMostrarNaPasta}>Mostrar na pasta</MenuItem>
            )}
            <MenuItem onClick={acoes.aoEnviarCorrigida}>Enviar a versão corrigida</MenuItem>
            {acoes.aoExportar === undefined ? null : (
              <MenuItem onClick={acoes.aoExportar}>Exportar discordâncias</MenuItem>
            )}
            <MenuItem onClick={acoes.aoRevisarOutro}>Revisar outro arquivo</MenuItem>
            <MenuSeparator />
            <MenuItem onClick={acoes.aoApagar} className="text-destructive-foreground">
              Apagar esta revisão
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
    </div>
  );
}
