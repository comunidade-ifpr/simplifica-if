/**
 * A entrada da revisão: o título, uma frase, a área de soltar o PPC (no desktop; no navegador, o campo
 * do caminho, que é o modo de desenvolvimento) e as revisões recentes, uma por linha: todas as listas
 * guardadas (com a leitura com IA que ficou por terminar e quando a lista sai sozinha, se falta pouco) e
 * as leituras sem lista. "Continuar" abre a lista do arquivo, e a faixa da IA retoma a leitura dela: nada
 * é revisado de novo (o curso escolhido e o que foi marcado ficam). O ⋯ de cada lista a apaga.
 */
import type { EstadoRevisaoIa, ListaPendencias } from "@simplifica-if/contratos-app";
import { ChevronRightIcon, EllipsisIcon } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { DialogoApagar } from "../apagar/DialogoApagar.tsx";
import { avisoDeSaida, textosApagarRevisao } from "../apagar/textos.ts";
import { AvisoErro } from "../components/AvisoErro.tsx";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../components/ui/menu.tsx";
import { Pagina } from "../components/Pagina.tsx";
import { AreaSoltar } from "../components/ui/area-soltar.tsx";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { explicarErro, type MensagemErro } from "../conexao/erros.ts";
import { useApi } from "../contexto.tsx";
import { dataCurta } from "../lib/formato.ts";
import { ponteDesktop } from "../ponte-desktop.ts";
import { obterArquivo } from "./arquivo.ts";
import { nomeIa } from "./FaixaIa.tsx";
import { leiturasPorTerminar } from "./ia.ts";
import { contagens, descreverCurso, nomeDoArquivo } from "./lista.ts";

export function Entrada({
  erro,
  aoEscolher,
  aoAbrirLista,
}: {
  readonly erro: MensagemErro | undefined;
  readonly aoEscolher: (arquivo: string) => void;
  readonly aoAbrirLista: (lista: ListaPendencias) => void;
}) {
  const api = useApi();
  const ponte = ponteDesktop();
  const [falha, setFalha] = useState<MensagemErro | undefined>(undefined);
  const [listas, setListas] = useState<ReadonlyArray<ListaPendencias>>([]);
  const [porTerminar, setPorTerminar] = useState<ReadonlyArray<EstadoRevisaoIa>>([]);
  const [apagando, setApagando] = useState<ListaPendencias | null>(null);
  const [apagadas, setApagadas] = useState(0);
  const [agora] = useState(() => Date.now());
  useEffect(() => {
    let vivo = true;
    api
      .chamar((c) => c["revisaoPpc.listas"]({}))
      .then((l) => vivo && setListas(l))
      .catch(() => undefined);
    api
      .chamar((c) => c["revisaoPpc.listarIa"]({}))
      .then((l) => vivo && setPorTerminar(leiturasPorTerminar(l)))
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
    // `apagadas` é só o gatilho da recarga depois de apagar.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [api, apagadas]);

  const usarArquivo = async (obter: () => Promise<string | null>, seRecusado?: MensagemErro) => {
    setFalha(undefined);
    const obtido = await obterArquivo(obter, seRecusado);
    if (obtido === undefined) return;
    if ("erro" in obtido) setFalha(obtido.erro);
    else aoEscolher(obtido.arquivo);
  };

  /** A leitura com IA por terminar: a lista do arquivo, onde a faixa da IA a retoma. */
  const continuar = async (leitura: EstadoRevisaoIa) => {
    setFalha(undefined);
    try {
      const lista = await api.chamar((c) => c["revisaoPpc.listaDoArquivo"]({ arquivo: leitura.arquivoOriginal }));
      if (lista !== null) return aoAbrirLista(lista);
      setFalha({
        texto: `A lista de “${nomeDoArquivo(leitura.arquivoOriginal)}” não está mais neste computador. Escolha o arquivo de novo para revisá-lo.`,
      });
    } catch (motivo) {
      setFalha(explicarErro(motivo));
    }
  };

  const leituraDa = (lista: ListaPendencias) =>
    porTerminar.find((e) => e.arquivoOriginal === lista.arquivoOriginal && e.sha256 === lista.sha256);
  const outras = porTerminar.filter(
    (e) => !listas.some((l) => l.arquivoOriginal === e.arquivoOriginal && l.sha256 === e.sha256),
  );
  const apagou = useRef(false);
  const mostrado = falha ?? erro;

  return (
    <Pagina largura="estreita" className="gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-display">Revisar um PPC</h1>
        <p className="text-body text-muted-foreground">Confira seu PPC contra as normas antes de enviar à PROENS.</p>
      </header>
      {ponte?.escolherDocx === undefined ? (
        <CaminhoDigitado aoEscolher={aoEscolher} />
      ) : (
        <AreaSoltar
          titulo="Solte aqui o PPC em Word (.docx)"
          descricao="Seu arquivo não é alterado: os comentários vão para uma cópia, na mesma pasta."
          rotuloEscolher="Escolher o PPC"
          aoEscolher={() => void usarArquivo(() => ponte.escolherDocx!())}
          aoSoltar={(arquivos) => {
            const arquivo = arquivos[0];
            if (arquivo === undefined) return;
            if (ponte.soltarDocx === undefined) {
              setFalha({ texto: "Use o botão “Escolher o PPC” para abrir o arquivo." });
              return;
            }
            void usarArquivo(() => ponte.soltarDocx!(arquivo), {
              texto: "Só dá para revisar um arquivo do Word (.docx). Solte um .docx ou use “Escolher o PPC”.",
            });
          }}
        />
      )}
      {mostrado === undefined ? null : <AvisoErro erro={mostrado} icone />}
      {listas.length === 0 && outras.length === 0 ? null : (
        <section aria-labelledby="titulo-recentes" className="flex flex-col gap-2">
          <h2 id="titulo-recentes" className="text-heading">
            Revisões recentes
          </h2>
          <ul className="border-border border-t">
            {listas.map((lista) => {
              const leitura = leituraDa(lista);
              return (
                <Recente
                  key={lista.id}
                  titulo={nomeDoArquivo(lista.arquivoOriginal)}
                  detalhes={[
                    descreverCurso(lista.resultado.curso),
                    dataCurta(lista.atualizadaEm),
                    leitura === undefined
                      ? null
                      : `leitura com o ${nomeIa(leitura.provider)} ${leitura.situacao === "pausada" ? "pausada" : "em andamento"}`,
                    avisoDeSaida(lista.atualizadaEm, agora),
                  ]}
                  fim={
                    contagens(lista).corrigir === 0
                      ? "Nada para corrigir"
                      : `${contagens(lista).corrigir} para corrigir`
                  }
                  aoAbrir={() => aoAbrirLista(lista)}
                  aoApagar={() => setApagando(lista)}
                />
              );
            })}
            {outras.map((e) => (
              <Recente
                key={e.id}
                titulo={nomeDoArquivo(e.arquivoOriginal)}
                detalhes={[
                  dataCurta(e.atualizadaEm),
                  `leitura com o ${nomeIa(e.provider)} ${e.situacao === "pausada" ? "pausada" : "em andamento"}`,
                ]}
                fim="Continuar"
                aoAbrir={() => void continuar(e)}
              />
            ))}
          </ul>
        </section>
      )}
      <DialogoApagar
        aberto={apagando !== null}
        textos={
          apagando === null ? null : textosApagarRevisao(apagando, leituraDa(apagando)?.situacao === "em_andamento")
        }
        aoConfirmar={async () => {
          if (apagando === null) return null;
          await api.chamar((c) => c["revisaoPpc.apagarLista"]({ lista: apagando.id }));
          apagou.current = true;
          return null;
        }}
        aoFechar={() => {
          setApagando(null);
          if (apagou.current) setApagadas((n) => n + 1);
          apagou.current = false;
        }}
      />
    </Pagina>
  );
}

function Recente({
  titulo,
  detalhes,
  fim,
  aoAbrir,
  aoApagar,
}: {
  readonly titulo: string;
  readonly detalhes: ReadonlyArray<string | null>;
  readonly fim: string;
  readonly aoAbrir: () => void;
  /** Só nas listas guardadas. */
  readonly aoApagar?: () => void;
}) {
  return (
    <li className="flex items-center gap-1 border-border border-b">
      <button
        type="button"
        onClick={aoAbrir}
        className="flex w-full cursor-pointer items-center gap-4 py-3 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate font-semibold text-body">{titulo}</span>
          <span className="text-muted-foreground text-small">{detalhes.filter((d) => d !== null).join(", ")}</span>
        </span>
        <span className="shrink-0 text-small tabular-nums">{fim}</span>
        <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </button>
      {aoApagar === undefined ? null : (
        <Menu>
          <MenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Mais ações da revisão de “${titulo}”`}
                // O rótulo leva o nome do arquivo da pessoa.
                data-conteudo=""
                title="Mais ações"
              />
            }
          >
            <EllipsisIcon />
          </MenuTrigger>
          <MenuPopup>
            <MenuItem className="text-destructive-foreground" onClick={aoApagar}>
              Apagar esta revisão…
            </MenuItem>
          </MenuPopup>
        </Menu>
      )}
    </li>
  );
}

/** O modo de desenvolvimento (no navegador, sem o desktop): o caminho do arquivo, digitado. */
function CaminhoDigitado({ aoEscolher }: { readonly aoEscolher: (arquivo: string) => void }) {
  const [caminho, setCaminho] = useState("");
  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (caminho.trim()) aoEscolher(caminho.trim());
  };
  return (
    <form className="flex flex-col gap-2" onSubmit={enviar} aria-label="Escolher o PPC">
      <label htmlFor="arquivo-ppc" className="font-semibold text-small">
        Caminho do PPC (.docx)
      </label>
      <div className="flex gap-2">
        <Input
          id="arquivo-ppc"
          nativeInput
          placeholder="/Users/voce/Documents/PPC.docx"
          value={caminho}
          onChange={(evento) => setCaminho(evento.currentTarget.value)}
        />
        <Button type="submit">Revisar</Button>
      </div>
    </form>
  );
}
