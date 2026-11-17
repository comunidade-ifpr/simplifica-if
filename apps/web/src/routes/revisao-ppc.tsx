/**
 * "Revisar um PPC" (M1.11, etapas 3 e 4): a revisão prévia sem IA e, depois dela, a revisão completa
 * com a IA da conta da pessoa (`RevisaoComIa`), cujo resultado substitui o da pré-conferência. A pessoa escolhe o `.docx` no diálogo
 * do sistema; o servidor converte, confere os critérios que o código decide e grava uma cópia com
 * comentários do Word ao lado do original. A tela mostra o andamento, a lista de pendências por tema
 * (na ordem do parecer da PROENS) e os botões para abrir a cópia comentada e mostrá-la na pasta.
 *
 * No navegador (sem o desktop), o caminho do arquivo é digitado: é o modo de desenvolvimento.
 */
import type { EstadoRevisaoIa, ListaPendencias, ResultadoRevisaoPpc } from "@simplifica-if/contratos-app";
import { createFileRoute } from "@tanstack/react-router";
import { FileSearchIcon, HistoryIcon } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { AvisoErro } from "../components/AvisoErro.tsx";
import { Alert, AlertDescription } from "../components/ui/alert.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { explicarErro, mensagemDeErro, type MensagemErro } from "../conexao/erros.ts";
import { useApi } from "../contexto.tsx";
import { ponteDesktop } from "../ponte-desktop.ts";
import { agruparPorTema, dataBrasileira, descreverCurso, ROTULO_ESTADO } from "../revisao/agrupar.ts";
import { CopiaComentada, DetalhesPendencia, nomeDoArquivo } from "../revisao/componentes.tsx";
import { revisaoParaRetomar, textoCobertura } from "../revisao/ia.ts";
import { RevisaoComIa } from "../revisao/RevisaoComIa.tsx";
import { ListaViva } from "../revisao/Roteiro.tsx";

export const Route = createFileRoute("/revisao-ppc")({ component: RevisaoPpc });

type Estado =
  | { readonly fase: "escolha" }
  | { readonly fase: "revisando"; readonly arquivo: string }
  | { readonly fase: "erro"; readonly erro: MensagemErro }
  | { readonly fase: "pronta"; readonly resultado: ResultadoRevisaoPpc }
  /** Uma revisão com IA não concluída, reencontrada depois de recarregar a tela. */
  | { readonly fase: "retomando"; readonly revisao: EstadoRevisaoIa };

function RevisaoPpc() {
  const api = useApi();
  const [estado, setEstado] = useState<Estado>({ fase: "escolha" });
  // A lista viva mais recente (etapa 5b): continuar de onde parou, depois de fechar o app.
  const [ultima, setUltima] = useState<ListaPendencias | null>(null);
  useEffect(() => {
    let ativo = true;
    api
      .chamar((cliente) => cliente["revisaoPpc.ultimaLista"]({}))
      .then((lista) => ativo && setUltima(lista))
      .catch(() => undefined);
    return () => {
      ativo = false;
    };
  }, [api]);
  // Depois de recarregar a tela, a revisão com IA que não terminou volta (o servidor a guarda).
  useEffect(() => {
    let ativo = true;
    api
      .chamar((cliente) => cliente["revisaoPpc.listarIa"]({}))
      .then((lista) => {
        const revisao = revisaoParaRetomar(lista);
        if (ativo && revisao !== undefined)
          setEstado((atual) => (atual.fase === "escolha" ? { fase: "retomando", revisao } : atual));
      })
      .catch(() => undefined);
    return () => {
      ativo = false;
    };
  }, [api]);
  const revisar = async (arquivo: string) => {
    setEstado({ fase: "revisando", arquivo });
    try {
      const resultado = await api.chamar((cliente) => cliente["revisaoPpc.revisar"]({ arquivo }));
      setEstado({ fase: "pronta", resultado });
    } catch (erro) {
      setEstado({ fase: "erro", erro: explicarErro(erro) });
    }
  };
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
        <section className="flex flex-col gap-2">
          <h1 className="font-bold text-2xl tracking-tight">Revisar um PPC</h1>
          <p className="max-w-prose text-muted-foreground">
            Revisão prévia, sem IA: o Simplifica IF confere no seu PPC os critérios que dá para conferir automaticamente
            e devolve uma cópia do arquivo com comentários do Word nos trechos. O seu arquivo não é alterado. Não é
            parecer da PROENS.
          </p>
        </section>
        <Escolha
          ocupada={estado.fase === "revisando"}
          aoEscolher={revisar}
          aoFalhar={(erro) =>
            setEstado({
              fase: "erro",
              erro: {
                texto: "Não foi possível usar o arquivo escolhido. Tente escolhê-lo de novo.",
                detalhe: mensagemDeErro(erro),
              },
            })
          }
        />
        {estado.fase === "escolha" && ultima !== null ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
            <span>
              Sua lista de <span className="font-medium">{nomeDoArquivo(ultima.arquivoOriginal)}</span> está guardada (
              {dataBrasileira(ultima.atualizadaEm)}).
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEstado({ fase: "pronta", resultado: ultima.resultado })}
            >
              <HistoryIcon /> Continuar de onde parei
            </Button>
          </div>
        ) : null}
        {estado.fase === "revisando" ? (
          <div role="status" className="flex items-center gap-2 text-muted-foreground">
            <Spinner /> Revisando {nomeDoArquivo(estado.arquivo)}: convertendo o documento e conferindo os critérios…
          </div>
        ) : null}
        {estado.fase === "erro" ? <AvisoErro erro={estado.erro} icone /> : null}
        {estado.fase === "retomando" ? (
          <>
            <p className="text-sm">
              Revisão com IA de <span className="font-medium">{nomeDoArquivo(estado.revisao.arquivoOriginal)}</span>{" "}
              ainda não terminou.
            </p>
            <RevisaoComIa
              key={estado.revisao.id}
              arquivo={estado.revisao.arquivoOriginal}
              retomada={estado.revisao}
              aoConcluir={(resultado) => setEstado({ fase: "pronta", resultado })}
            />
          </>
        ) : null}
        {estado.fase === "pronta" ? (
          <>
            {estado.resultado.conferidosIa === 0 ? (
              <RevisaoComIa
                key={estado.resultado.arquivoComentado}
                arquivo={estado.resultado.arquivoOriginal}
                aoConcluir={(resultado) => setEstado({ fase: "pronta", resultado })}
              />
            ) : null}
            <Resultado
              resultado={estado.resultado}
              aoApagar={() => {
                setUltima(null);
                setEstado({ fase: "escolha" });
              }}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

function Escolha({
  ocupada,
  aoEscolher,
  aoFalhar,
}: {
  readonly ocupada: boolean;
  readonly aoEscolher: (arquivo: string) => void;
  readonly aoFalhar: (erro: unknown) => void;
}) {
  const escolherDocx = ponteDesktop()?.escolherDocx;
  const [caminho, setCaminho] = useState("");
  if (escolherDocx !== undefined)
    return (
      <div>
        <Button
          size="lg"
          disabled={ocupada}
          onClick={async () => {
            try {
              const arquivo = await escolherDocx();
              if (arquivo !== null) aoEscolher(arquivo);
            } catch (erro) {
              aoFalhar(erro);
            }
          }}
        >
          <FileSearchIcon /> Escolher o PPC (.docx)…
        </Button>
      </div>
    );
  const aoEnviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (caminho.trim()) aoEscolher(caminho.trim());
  };
  return (
    <form className="flex flex-col gap-2" onSubmit={aoEnviar} aria-label="Escolher o PPC">
      <label htmlFor="arquivo-ppc" className="font-semibold">
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
        <Button type="submit" disabled={ocupada}>
          Revisar
        </Button>
      </div>
    </form>
  );
}

function Resultado({
  resultado,
  aoApagar,
}: {
  readonly resultado: ResultadoRevisaoPpc;
  readonly aoApagar?: () => void;
}) {
  // A lista viva (etapa 5b): o roteiro, as situações e as ações em cada pendência.
  if (resultado.lista !== undefined)
    return <ListaViva key={resultado.lista} lista={resultado.lista} {...(aoApagar ? { aoApagar } : {})} />;
  const precisam = resultado.pendencias.filter((p) => p.estado === "nao_atende").length;
  const conferir = resultado.pendencias.length - precisam;
  const grupos = agruparPorTema(resultado);
  return (
    <section aria-labelledby="titulo-resultado" className="flex flex-col gap-5">
      <div className="flex flex-col gap-2 rounded-lg border p-4">
        <h2 id="titulo-resultado" className="font-semibold text-lg">
          {precisam} {precisam === 1 ? "ponto precisa" : "pontos precisam"} de ajuste e {conferir}{" "}
          {conferir === 1 ? "é para conferir" : "são para conferir"}
        </h2>
        <p className="text-sm">Curso: {descreverCurso(resultado.curso)}</p>
        <p className="text-muted-foreground text-sm">
          {textoCobertura(resultado)} Base de normas de {dataBrasileira(resultado.dataBase)}. Uma revisão prévia sem
          pendências não é PPC aprovado.
        </p>
        <CopiaComentada arquivo={resultado.arquivoComentado} />
      </div>
      {resultado.pendencias.length === 0 ? (
        <Alert variant="success">
          <AlertDescription>
            Nenhuma pendência nos critérios conferidos. Uma revisão prévia sem pendências não é PPC aprovado.
          </AlertDescription>
        </Alert>
      ) : null}
      {grupos.map((grupo) => (
        <section key={grupo.ordem} aria-label={grupo.tema} className="flex flex-col gap-3">
          <h3 className="font-semibold">{grupo.tema}</h3>
          {grupo.pendencias.length ? (
            <ul className="flex flex-col gap-3">
              {grupo.pendencias.map((pendencia) => (
                <li
                  key={`${pendencia.ficha}|${pendencia.mensagem}|${pendencia.trecho ?? ""}`}
                  className="flex flex-col gap-1.5 rounded-lg border p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={pendencia.estado === "nao_atende" ? "warning" : "info"}>
                      {ROTULO_ESTADO[pendencia.estado]}
                    </Badge>
                    <span className="text-muted-foreground text-xs">
                      {pendencia.tituloFicha}
                      {pendencia.origem === "ia" ? " · avaliação da IA" : " · conferido pela base"}
                    </span>
                  </div>
                  <DetalhesPendencia pendencia={pendencia} />
                </li>
              ))}
            </ul>
          ) : null}
          {grupo.semPendencia.length ? (
            <p className="text-muted-foreground text-sm">
              Em ordem nos critérios conferidos:{" "}
              {grupo.semPendencia
                .map((c) => (c.estado === "nao_se_aplica" ? `${c.titulo} (não se aplica)` : c.titulo))
                .join("; ")}
              .
            </p>
          ) : null}
        </section>
      ))}
    </section>
  );
}
