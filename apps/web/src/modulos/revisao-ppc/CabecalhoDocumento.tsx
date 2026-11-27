/**
 * O cabeçalho do documento revisado: o nome do arquivo e o curso, "Abrir no Word" (regrava a cópia
 * comentada com a situação atual e a abre; com a revisão acompanhando um arquivo, abre esse), "Acompanhar
 * no Word" (a cópia comentada abre no Word, e cada salvamento é conferido; no desktop, a revisão também vira
 * a coluna da janela compacta, ao lado do Word, e o botão fica para voltar a ela) e o menu ⋯ com o resto: abrir o
 * PPC ao lado (o texto no painel do app, para consulta rápida, com a busca; o "Ver no PPC" de cada
 * pendência também o abre), mostrar na pasta, acompanhar outro arquivo, enviar a versão corrigida,
 * exportar as discordâncias, revisar outro arquivo e apagar esta revisão.
 *
 * No navegador (sem o desktop), não há como abrir o Word: o botão grava a cópia e mostra onde ela está.
 */
import { EllipsisIcon, EyeIcon, FileTextIcon } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../../components/ui/menu.tsx";
import { Spinner } from "../../components/ui/spinner.tsx";

export interface AcoesDocumento {
  /** O texto do PPC no painel de leitura, desde o começo. */
  readonly aoAbrirAoLado: () => void;
  readonly aoAbrirNoWord: () => void;
  readonly abrindo: boolean;
  /** "Acompanhar no Word"; indefinido com a revisão já acompanhando um arquivo, fora do desktop. */
  readonly aoAcompanhar: (() => void) | undefined;
  readonly acompanhando: boolean;
  /** "Acompanhar no Word" também liga a janela compacta, ao lado do Word (só no desktop). */
  readonly acompanharAoLado: boolean;
  /** Outro `.docx`, escolhido no diálogo, passa a ser o acompanhado. Só no desktop. */
  readonly aoAcompanharOutro: (() => void) | undefined;
  /** Só no desktop. */
  readonly aoMostrarNaPasta: (() => void) | undefined;
  /** Indefinido com a leitura com IA em andamento: a versão corrigida espera a pausa. */
  readonly aoEnviarCorrigida: (() => void) | undefined;
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
        {acoes.aoAcompanhar === undefined ? null : (
          <Button
            variant="outline"
            onClick={acoes.aoAcompanhar}
            disabled={acoes.acompanhando}
            title={
              acoes.acompanharAoLado
                ? "Abre o documento no Word, confere de novo cada vez que você salvar e deixa a revisão numa coluna ao lado"
                : "Abre a cópia comentada no Word e confere de novo cada vez que você salvar"
            }
          >
            {acoes.acompanhando ? <Spinner /> : <EyeIcon />} Acompanhar no Word
          </Button>
        )}
        <Menu>
          <MenuTrigger
            render={<Button variant="ghost" size="icon" aria-label="Mais ações do documento" title="Mais ações" />}
          >
            <EllipsisIcon />
          </MenuTrigger>
          <MenuPopup>
            <MenuItem onClick={acoes.aoAbrirAoLado}>Abrir o PPC ao lado</MenuItem>
            {acoes.aoMostrarNaPasta === undefined ? null : (
              <MenuItem onClick={acoes.aoMostrarNaPasta}>Mostrar na pasta</MenuItem>
            )}
            {acoes.aoAcompanharOutro === undefined ? null : (
              <MenuItem onClick={acoes.aoAcompanharOutro}>Acompanhar outro arquivo…</MenuItem>
            )}
            <MenuItem disabled={acoes.aoEnviarCorrigida === undefined} onClick={acoes.aoEnviarCorrigida}>
              Enviar a versão corrigida
              {acoes.aoEnviarCorrigida === undefined ? " (pause a conferência com IA antes)" : ""}
            </MenuItem>
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
