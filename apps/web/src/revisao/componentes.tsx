/**
 * Peças da tela "Analisar um PPC" usadas pela lista simples e pelo roteiro (etapa 5b): o corpo de uma
 * pendência (mensagem, o que fazer, trecho, fontes) e os botões da cópia comentada.
 */
import type { PendenciaRevisao } from "@simplifica-if/contratos-app";
import { ExternalLinkIcon, FileTextIcon, FolderOpenIcon } from "lucide-react";
import { useState } from "react";
import { AvisoErro } from "../components/AvisoErro.tsx";
import { Button } from "../components/ui/button.tsx";
import { mensagemDeErro, type MensagemErro } from "../conexao/erros.ts";
import { abrirExterno, ponteDesktop } from "../ponte-desktop.ts";
import { ROTULO_LOCAL } from "./agrupar.ts";

export const nomeDoArquivo = (caminho: string) => caminho.split(/[\\/]/).at(-1) ?? caminho;

export function DetalhesPendencia({ pendencia }: { readonly pendencia: PendenciaRevisao }) {
  return (
    <>
      <p className="whitespace-pre-line">{pendencia.mensagem}</p>
      <p className="text-sm">
        <span className="font-medium">{pendencia.estado === "nao_atende" ? "O que fazer: " : "Se for o caso: "}</span>
        {pendencia.oQueFazer}
      </p>
      {pendencia.trecho === null ? null : (
        <blockquote className="border-l-2 pl-3 text-muted-foreground text-sm">
          “{pendencia.trecho}”{pendencia.secao === null ? null : <span> — seção {pendencia.secao}</span>}
        </blockquote>
      )}
      {pendencia.fontes.length ? (
        <p className="text-sm">
          <span className="font-medium">Fonte: </span>
          {pendencia.fontes.map((fonte, indice) => (
            <span key={fonte.link}>
              {indice > 0 ? "; " : null}
              {fonte.url === null ? (
                fonte.rotulo
              ) : (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 underline underline-offset-2"
                  onClick={() => void abrirExterno(fonte.url!)}
                >
                  {fonte.rotulo}
                  <ExternalLinkIcon className="size-3" aria-hidden />
                </button>
              )}
            </span>
          ))}
        </p>
      ) : null}
      {pendencia.tambemEm.length ? (
        <p className="text-muted-foreground text-sm">
          Também em: {pendencia.tambemEm.map((t) => t.titulo).join("; ")}.
        </p>
      ) : null}
      <p className="text-muted-foreground text-xs">{ROTULO_LOCAL[pendencia.noDocumento]}</p>
    </>
  );
}

/** O nome da cópia comentada e os botões para abri-la e mostrá-la na pasta. */
export function CopiaComentada({ arquivo }: { readonly arquivo: string }) {
  const ponte = ponteDesktop();
  const [erro, setErro] = useState<MensagemErro | undefined>(undefined);
  /** Abre ou mostra a cópia; se ela foi movida ou apagada, a mensagem fica na tela. */
  const usar = async (acao: ((caminho: string) => Promise<void>) | undefined) => {
    setErro(undefined);
    try {
      await acao?.(arquivo);
    } catch (motivo) {
      setErro({
        texto:
          "Não foi possível abrir a cópia comentada. Ela pode ter sido movida, renomeada ou apagada; analise o PPC de novo para gerar outra.",
        detalhe: mensagemDeErro(motivo),
      });
    }
  };
  return (
    <>
      <p className="text-sm">
        Cópia comentada: <span className="font-medium">{nomeDoArquivo(arquivo)}</span>, na pasta do original.
      </p>
      {ponte?.abrirDocumento === undefined && ponte?.mostrarNaPasta === undefined ? (
        <p className="break-all font-mono text-muted-foreground text-xs">{arquivo}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {ponte.abrirDocumento === undefined ? null : (
            <Button onClick={() => void usar(ponte.abrirDocumento)}>
              <FileTextIcon /> Abrir o documento comentado
            </Button>
          )}
          {ponte.mostrarNaPasta === undefined ? null : (
            <Button variant="outline" onClick={() => void usar(ponte.mostrarNaPasta)}>
              <FolderOpenIcon /> Mostrar na pasta
            </Button>
          )}
        </div>
      )}
      {erro === undefined ? null : <AvisoErro erro={erro} />}
    </>
  );
}
