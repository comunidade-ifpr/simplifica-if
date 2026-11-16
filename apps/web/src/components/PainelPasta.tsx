/**
 * A pasta de trabalho da conversa (M1.9): os arquivos que entraram ("Você trouxe") e os que a conversa
 * criou ou mudou, com "Abrir" e "Mostrar na pasta" (só no app, e o processo principal só aceita
 * arquivos das pastas de tarefa), "Anexar arquivo…" e "Desfazer o que a IA fez nesta pasta", que
 * pede confirmação e diz o que vai mudar.
 */
import type { ArquivoPasta, PastaConversa } from "@simplifica-if/contratos-app";
import { ExternalLinkIcon, FileIcon, FolderOpenIcon, PaperclipIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { explicarErro, type MensagemErro } from "../conexao/erros.ts";
import { useApi } from "../contexto.tsx";
import { ponteDesktop } from "../ponte-desktop.ts";
import { nomeArquivo } from "../tarefas/comecar.tsx";
import { AvisoErro } from "./AvisoErro.tsx";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert.tsx";
import { Button } from "./ui/button.tsx";
import { Spinner } from "./ui/spinner.tsx";

const FORMATO_HORA = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

function tamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

/** "Documentos › Simplifica IF › Conferir base legal", sem o resto do caminho. */
function ondeFica(pasta: string): string {
  const partes = pasta.split(/[\\/]/).filter(Boolean);
  return ["Documentos", ...partes.slice(-2)].join(" › ");
}

function Arquivo({
  arquivo,
  aoFalhar,
}: {
  readonly arquivo: ArquivoPasta;
  readonly aoFalhar: (erro: MensagemErro) => void;
}) {
  const ponte = ponteDesktop();
  const tentar = (acao: (caminho: string) => Promise<void>) => () =>
    acao(arquivo.caminho).catch(() =>
      aoFalhar({
        texto: `Não foi possível abrir ${arquivo.nome}. Ele pode ter sido movido ou ser de um tipo que o app não abre.`,
      }),
    );
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-sm">
      <FileIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate font-medium" title={arquivo.nome}>
        {arquivo.nome}
      </span>
      <span className="text-muted-foreground text-xs">
        {tamanho(arquivo.tamanho)} · {FORMATO_HORA.format(new Date(arquivo.alteradoEm))}
      </span>
      {ponte?.abrirArquivoTarefa === undefined ? null : (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Abrir ${arquivo.nome}`}
          onClick={tentar(ponte.abrirArquivoTarefa)}
        >
          <ExternalLinkIcon /> Abrir
        </Button>
      )}
      {ponte?.mostrarArquivoTarefa === undefined ? null : (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Mostrar ${arquivo.nome} na pasta`}
          onClick={tentar(ponte.mostrarArquivoTarefa)}
        >
          <FolderOpenIcon /> Mostrar na pasta
        </Button>
      )}
    </li>
  );
}

function ListaArquivos({
  titulo,
  arquivos,
  aoFalhar,
}: {
  readonly titulo: string;
  readonly arquivos: ReadonlyArray<ArquivoPasta>;
  readonly aoFalhar: (erro: MensagemErro) => void;
}) {
  if (arquivos.length === 0) return null;
  return (
    <section aria-label={titulo}>
      <h3 className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">{titulo}</h3>
      <ul className="divide-y divide-border">
        {arquivos.map((arquivo) => (
          <Arquivo key={arquivo.nome} arquivo={arquivo} aoFalhar={aoFalhar} />
        ))}
      </ul>
    </section>
  );
}

function ConfirmarDesfazer({
  vista,
  ocupado,
  aoConfirmar,
  aoCancelar,
}: {
  readonly vista: PastaConversa;
  readonly ocupado: boolean;
  readonly aoConfirmar: (incluirForaDaConversa: boolean) => void;
  readonly aoCancelar: () => void;
}) {
  const { criados, alterados, apagados, copiaEm, foraDaConversa } = vista.desfazer;
  const [incluir, setIncluir] = useState(false);
  const fora = new Set(foraDaConversa);
  const lista = (nomes: ReadonlyArray<string>) => nomes.filter((nome) => incluir || !fora.has(nome)).join(", ");
  return (
    <div
      role="group"
      aria-label="Desfazer o que a IA fez nesta pasta?"
      className="rounded-lg border border-warning/50 bg-warning-surface p-3 text-sm"
    >
      <p className="font-semibold">Desfazer o que a IA fez nesta pasta?</p>
      <p className="text-muted-foreground">
        Volta o que a IA mudou na mensagem {copiaEm === undefined ? "" : `de ${FORMATO_HORA.format(new Date(copiaEm))}`}
        . A conversa não muda.
      </p>
      <ul className="my-2 list-disc pl-5">
        {lista(criados) === "" ? null : <li>Saem: {lista(criados)}</li>}
        {lista(alterados) === "" ? null : <li>Voltam ao que eram: {lista(alterados)}</li>}
        {lista(apagados) === "" ? null : <li>Voltam para a pasta: {lista(apagados)}</li>}
      </ul>
      {foraDaConversa.length === 0 ? null : (
        <div className="mb-2 flex flex-col gap-1.5">
          <p>
            {foraDaConversa.length === 1 ? "Este arquivo também foi mudado" : "Estes arquivos também foram mudados"}{" "}
            fora da conversa depois: {foraDaConversa.join(", ")}. Sem marcar abaixo, eles ficam como estão.
          </p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="accent-primary"
              checked={incluir}
              onChange={(evento) => setIncluir(evento.currentTarget.checked)}
            />
            Desfazer também esses arquivos (a mudança feita fora da conversa se perde)
          </label>
        </div>
      )}
      <div className="flex gap-2">
        <Button size="sm" variant="destructive" disabled={ocupado} onClick={() => aoConfirmar(incluir)}>
          {ocupado ? <Spinner /> : <RotateCcwIcon />} Desfazer
        </Button>
        <Button size="sm" variant="outline" disabled={ocupado} onClick={aoCancelar}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

export function PainelPasta({
  sessao,
  atualizar,
  emTurno,
  aoFechar,
}: {
  readonly sessao: string;
  /** Qualquer valor que, quando muda, faz a lista recarregar (o fim de um turno). */
  readonly atualizar: string;
  /** Há resposta em andamento: "Desfazer" espera ela terminar. */
  readonly emTurno: boolean;
  readonly aoFechar: () => void;
}) {
  const api = useApi();
  const [vista, setVista] = useState<PastaConversa>();
  const [erro, setErro] = useState<MensagemErro>();
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [desfeito, setDesfeito] = useState(false);
  const anexar = ponteDesktop()?.escolherAnexo;

  useEffect(() => {
    let vale = true;
    api
      .chamar((cliente) => cliente["pasta.ver"]({ sessao }))
      .then(
        (nova) => vale && setVista(nova),
        (falha: unknown) => vale && setErro(explicarErro(falha)),
      );
    return () => {
      vale = false;
    };
    // `atualizar` é só o gatilho da recarga.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [api, sessao, atualizar]);

  const desfazer = async (incluirForaDaConversa: boolean) => {
    setOcupado(true);
    try {
      setVista(await api.chamar((cliente) => cliente["pasta.desfazer"]({ sessao, incluirForaDaConversa })));
      setDesfeito(true);
    } catch (falha) {
      setErro(explicarErro(falha));
    } finally {
      setOcupado(false);
      setConfirmando(false);
    }
  };

  const anexarMais = async () => {
    if (anexar === undefined || vista === undefined) return;
    const arquivo = await anexar();
    if (arquivo === null) return;
    try {
      await api.chamar((cliente) => cliente["pasta.anexar"]({ pasta: vista.pasta, arquivo }));
      setVista(await api.chamar((cliente) => cliente["pasta.ver"]({ sessao })));
    } catch (falha) {
      setErro(explicarErro(falha));
    }
  };

  return (
    <aside
      aria-label="Pasta da tarefa"
      className="flex h-full w-full flex-col border-border border-l bg-card text-card-foreground"
    >
      <header className="flex items-center gap-2 border-border border-b px-3 py-2">
        <FolderOpenIcon aria-hidden className="size-4 text-muted-foreground" />
        <p className="min-w-0 flex-1 truncate font-semibold text-sm">Pasta da tarefa</p>
        <Button variant="ghost" size="icon-sm" aria-label="Fechar a pasta da tarefa" onClick={aoFechar}>
          <XIcon />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-3">
        {erro === undefined ? null : <AvisoErro erro={erro} />}
        {vista === undefined ? (
          erro === undefined ? (
            <p className="flex items-center gap-2 text-muted-foreground text-sm">
              <Spinner size="sm" /> Lendo a pasta…
            </p>
          ) : null
        ) : !vista.gerida ? (
          <p className="text-muted-foreground text-sm">
            Esta conversa usa uma pasta escolhida à mão ({nomeArquivo(vista.pasta)}). A lista de arquivos e o "Desfazer"
            ficam nas pastas das tarefas.
          </p>
        ) : (
          <>
            <p className="text-muted-foreground text-xs">{ondeFica(vista.pasta)}</p>
            {vista.arquivos.length === 0 ? <p className="text-muted-foreground text-sm">A pasta está vazia.</p> : null}
            <ListaArquivos
              titulo="Você trouxe"
              arquivos={vista.arquivos.filter((arquivo) => arquivo.origem === "anexado")}
              aoFalhar={setErro}
            />
            <ListaArquivos
              titulo="Criados ou mudados na conversa"
              arquivos={vista.arquivos.filter((arquivo) => arquivo.origem === "pasta")}
              aoFalhar={setErro}
            />
            {anexar === undefined ? null : (
              <div>
                <Button variant="outline" size="sm" onClick={() => void anexarMais()}>
                  <PaperclipIcon /> Anexar arquivo…
                </Button>
              </div>
            )}
            {desfeito ? (
              <p role="status" className="text-sm">
                Pronto: a pasta voltou ao que era antes da mensagem.
              </p>
            ) : null}
            {vista.desfazer.aviso === undefined ? null : (
              <Alert variant="warning">
                <AlertTitle>Sem cópia da última mensagem</AlertTitle>
                <AlertDescription>{vista.desfazer.aviso}</AlertDescription>
              </Alert>
            )}
            {!vista.desfazer.disponivel ? null : confirmando ? (
              <ConfirmarDesfazer
                vista={vista}
                ocupado={ocupado}
                aoConfirmar={(incluir) => void desfazer(incluir)}
                aoCancelar={() => setConfirmando(false)}
              />
            ) : (
              <div className="flex flex-col gap-1">
                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={emTurno}
                    onClick={() => {
                      setDesfeito(false);
                      setConfirmando(true);
                    }}
                  >
                    <RotateCcwIcon /> Desfazer o que a IA fez nesta pasta
                  </Button>
                </div>
                {emTurno ? (
                  <p className="text-muted-foreground text-xs">Espere a resposta terminar para desfazer.</p>
                ) : null}
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
