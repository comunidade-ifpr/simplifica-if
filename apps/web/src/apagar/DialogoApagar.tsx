/**
 * O diálogo único de apagar (uma conversa, uma revisão de PPC): o que sai do app, o que fica no
 * computador e, quando houver, a escolha de mandar a pasta da tarefa à Lixeira. As frases vêm de
 * `textos.ts`; quem abre o diálogo faz o apagamento em `aoConfirmar`. Se algo ficou para trás (o
 * registro do provider, a pasta que a Lixeira recusou), o diálogo o diz antes de fechar.
 *
 * Apagar não se desfaz: não há "Desfazer" depois, e o diálogo diz o que fica para a pessoa saber onde
 * achar os arquivos dela.
 */
import { Trash2Icon } from "lucide-react";
import { useId, useState } from "react";
import { AvisoErro } from "../components/AvisoErro.tsx";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "../components/ui/alert-dialog.tsx";
import { Button } from "../components/ui/button.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { explicarErro, type MensagemErro } from "../conexao/erros.ts";
import type { TextosApagar } from "./textos.ts";

export function DialogoApagar({
  aberto,
  textos,
  erroPrevia,
  aoConfirmar,
  aoFechar,
}: {
  readonly aberto: boolean;
  /** Nulos enquanto a prévia carrega. */
  readonly textos: TextosApagar | null;
  /** A prévia não carregou. */
  readonly erroPrevia?: MensagemErro | undefined;
  /**
   * Apaga; recebe se a pessoa escolheu mandar a pasta à Lixeira e devolve a nota do que ficou para trás
   * (nula: tudo certo, e o diálogo fecha). Uma falha fica no diálogo.
   */
  readonly aoConfirmar: (pastaParaLixeira: boolean) => Promise<string | null>;
  readonly aoFechar: () => void;
}) {
  const [lixeira, setLixeira] = useState(false);
  const [apagando, setApagando] = useState(false);
  const [erro, setErro] = useState<MensagemErro | undefined>(undefined);
  const [nota, setNota] = useState<string | null>(null);
  const idOpcao = useId();

  const confirmar = async () => {
    setApagando(true);
    setErro(undefined);
    try {
      const depois = await aoConfirmar(lixeira);
      if (depois === null) aoFechar();
      else setNota(depois);
    } catch (motivo) {
      setErro(explicarErro(motivo));
    } finally {
      setApagando(false);
    }
  };

  return (
    <AlertDialog
      open={aberto}
      onOpenChange={(abrir) => {
        // Enquanto apaga, o diálogo não fecha: o resultado aparece nele.
        if (!abrir && !apagando) aoFechar();
      }}
      onOpenChangeComplete={(abriu) => {
        if (abriu) return;
        setLixeira(false);
        setErro(undefined);
        setNota(null);
      }}
    >
      <AlertDialogContent>
        {nota !== null ? (
          <>
            <AlertDialogTitle className="font-semibold text-heading">Apagado</AlertDialogTitle>
            <AlertDialogDescription className="text-small">{nota}</AlertDialogDescription>
            <div className="flex justify-end">
              <AlertDialogClose render={<Button variant="outline" />}>Fechar</AlertDialogClose>
            </div>
          </>
        ) : textos === null && erroPrevia !== undefined ? (
          <>
            <AlertDialogTitle className="font-semibold text-heading">Não foi possível apagar agora</AlertDialogTitle>
            <AvisoErro erro={erroPrevia} />
            <div className="flex justify-end">
              <AlertDialogClose render={<Button variant="outline" />}>Fechar</AlertDialogClose>
            </div>
          </>
        ) : textos === null ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Spinner size="sm" /> Conferindo o que será apagado…
          </p>
        ) : (
          <>
            <AlertDialogTitle className="font-semibold text-heading">{textos.titulo}</AlertDialogTitle>
            <AlertDialogDescription render={<div />} className="flex flex-col gap-3 text-small">
              {textos.aviso === null ? null : <p className="font-medium">{textos.aviso}</p>}
              <section aria-label="Sai do app" className="flex flex-col gap-1">
                <p className="font-semibold">Sai do app, sem volta:</p>
                <ul className="list-disc pl-5">
                  {textos.saiDoApp.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
              <section aria-label="Fica no seu computador" className="flex flex-col gap-1">
                <p className="font-semibold">Fica no seu computador:</p>
                <ul className="list-disc pl-5">
                  {textos.ficaNoComputador.map((item) => (
                    <li key={item.texto}>
                      {item.texto}
                      {item.caminho === undefined ? null : (
                        <span className="block break-all text-muted-foreground text-micro">{item.caminho}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            </AlertDialogDescription>
            {textos.opcaoPasta === null ? null : (
              <label htmlFor={idOpcao} className="flex cursor-pointer items-start gap-2 text-small">
                <input
                  id={idOpcao}
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-destructive"
                  checked={lixeira}
                  disabled={apagando}
                  onChange={(evento) => setLixeira(evento.currentTarget.checked)}
                />
                <span>{textos.opcaoPasta}</span>
              </label>
            )}
            {erro === undefined ? null : <AvisoErro erro={erro} />}
            <div className="flex flex-wrap justify-end gap-2">
              <AlertDialogClose render={<Button variant="ghost" disabled={apagando} />}>Cancelar</AlertDialogClose>
              <Button variant="destructive" disabled={apagando} onClick={() => void confirmar()}>
                {apagando ? <Spinner /> : <Trash2Icon />} {textos.confirmar}
              </Button>
            </div>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
