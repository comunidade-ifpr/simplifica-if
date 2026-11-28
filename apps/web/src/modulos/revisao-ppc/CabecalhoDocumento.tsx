/**
 * O cabeçalho do documento revisado: o nome do arquivo e o curso, "Corrigir no Word" (abre a cópia comentada
 * no Word e confere cada salvamento; no desktop, a revisão também vira a coluna da janela compacta, ao lado
 * do Word, e o botão fica para voltar a ela), "Ver PPC" (o texto no painel do app, para consulta rápida, com
 * a busca; o "Ver no PPC" de cada pendência também o abre), o botão das conversas da revisão ("Conversar" ou
 * o popover com as conversas) e o menu ⋯ com o resto: abrir cópia comentada (só gera/abre o `.docx` com
 * comentários, sem entrar no modo acompanhado), mostrar na pasta, acompanhar outro arquivo, enviar a versão
 * corrigida, exportar as discordâncias, revisar outro arquivo e apagar esta revisão.
 *
 * No navegador (sem o desktop), não há como abrir o Word: o botão grava a cópia e mostra onde ela está.
 */
import { BookOpenIcon, EllipsisIcon, FileTextIcon } from "lucide-react";
import type { ReactNode } from "react";
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
  conversas,
}: {
  readonly nome: string;
  /** "Técnico em Agropecuária, subsequente"; nulo sem o curso no CNCT. */
  readonly curso: string | null;
  readonly acoes: AcoesDocumento;
  readonly conversas?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="break-words text-title">{nome}</p>
        {curso === null ? null : <p className="text-muted-foreground text-small">{curso}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <Button
          onClick={acoes.aoAcompanhar ?? acoes.aoAbrirNoWord}
          disabled={acoes.acompanhando || acoes.abrindo}
          title={
            acoes.acompanharAoLado
              ? "Abre o documento no Word, confere de novo cada vez que você salvar e deixa a revisão numa coluna ao lado"
              : "Abre a cópia comentada no Word e confere de novo cada vez que você salvar"
          }
        >
          {acoes.acompanhando || acoes.abrindo ? <Spinner /> : <FileTextIcon />} Corrigir no Word
        </Button>
        <Button variant="outline" onClick={acoes.aoAbrirAoLado} title="Abrir o PPC no painel ao lado">
          <BookOpenIcon /> Ver PPC
        </Button>
        {conversas}
        <Menu>
          <MenuTrigger
            render={<Button variant="ghost" size="icon" aria-label="Mais ações do documento" title="Mais ações" />}
          >
            <EllipsisIcon />
          </MenuTrigger>
          <MenuPopup>
            <MenuItem disabled={acoes.abrindo} onClick={acoes.aoAbrirNoWord}>
              Abrir cópia comentada
            </MenuItem>
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
