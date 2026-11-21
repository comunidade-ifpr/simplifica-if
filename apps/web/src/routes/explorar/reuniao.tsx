/**
 * Uma reunião do Consepe: os documentos publicados (pauta, pareceres) e os itens de pauta, com o curso e
 * o campus de cada um quando a curadoria os ligou. Vem do índice do Explorar; os documentos abrem na
 * publicação oficial, no navegador.
 */
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { dataBr, pedidoSobre, primeiraMaiuscula } from "../../explorar/colecoes.ts";
import { ComIndice } from "../../explorar/componentes.tsx";
import { PerguntarIa } from "../../explorar/PerguntarIa.tsx";
import { Cabecalho, LinkExterno, Secao } from "../../leitor/pecas.tsx";

export const Route = createFileRoute("/explorar/reuniao")({
  component: Reuniao,
  validateSearch: (busca: Record<string, unknown>): { readonly id: string } => ({
    id: typeof busca.id === "string" ? busca.id : "",
  }),
});

function Reuniao() {
  const { id } = Route.useSearch();
  const roteador = useRouter();
  return (
    <ComIndice>
      {(d) => {
        const r = d.reunioes.find((x) => x.id === id);
        if (r === undefined) return <p className="text-muted-foreground text-sm">Reunião não encontrada na base.</p>;
        const nomeCampus = new Map(d.campi.map((c) => [c.id, c.nome]));
        const cursos = [...new Set(r.itens.flatMap((i) => (i.curso === null ? [] : [`ifpr://curso/${i.curso}`])))];
        return (
          <div className="mx-auto max-w-3xl space-y-4">
            <div className="nao-imprimir flex flex-wrap items-center justify-between gap-2">
              <Button size="sm" variant="ghost" onClick={() => roteador.history.back()}>
                <ArrowLeftIcon /> Voltar
              </Button>
              <PerguntarIa
                pedido={pedidoSobre(
                  `a ${r.titulo}${r.fonte ? `, pauta em ${r.fonte}` : ""}${cursos.length ? "; cursos da pauta" : ""}`,
                  cursos,
                )}
              />
            </div>
            <article
              aria-label="Reunião do Consepe"
              className="space-y-4 rounded-xl border border-border bg-card p-5 text-card-foreground"
            >
              <Cabecalho tipo={r.conselho_nome} titulo={r.titulo}>
                <p className="text-muted-foreground text-sm">
                  {[dataBr(r.data), r.tipo ? `reunião ${r.tipo}` : null, r.situacao].filter(Boolean).join(" · ")}
                </p>
                {r.fonte ? <LinkExterno href={r.fonte}>Pautas no site do IFPR</LinkExterno> : null}
              </Cabecalho>
              <Secao titulo={`Itens de pauta (${r.itens.length})`}>
                <ol className="space-y-2 text-sm">
                  {r.itens.map((i) => (
                    <li key={i.id} className="rounded-md border border-border p-2">
                      <p data-conteudo>{i.titulo}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-small">
                        {i.tipo_demanda ? <Badge variant="outline">{i.tipo_demanda}</Badge> : null}
                        {i.resultado ? <span>{i.resultado}</span> : null}
                        {i.processo_sei ? <span>Processo SEI {i.processo_sei}</span> : null}
                        {i.curso ? (
                          <Link
                            to="/explorar/ver"
                            search={{ link: `ifpr://curso/${i.curso}` }}
                            className="text-link underline underline-offset-2"
                          >
                            Ficha do curso
                          </Link>
                        ) : null}
                        {i.campus ? (
                          <Link
                            to="/explorar/ver"
                            search={{ link: `ifpr://campus/${i.campus}` }}
                            className="text-link underline underline-offset-2"
                          >
                            Campus {nomeCampus.get(i.campus) ?? i.campus}
                          </Link>
                        ) : null}
                      </p>
                    </li>
                  ))}
                </ol>
              </Secao>
              <Secao titulo={`Documentos publicados (${r.documentos.length})`}>
                <ul className="space-y-2 text-sm">
                  {r.documentos.map((doc) => (
                    <li key={doc.id}>
                      {doc.url ? <LinkExterno href={doc.url}>{doc.titulo}</LinkExterno> : <strong>{doc.titulo}</strong>}
                      <span className="text-muted-foreground"> · {primeiraMaiuscula(doc.tipo)}</span>
                      {doc.resumo ? (
                        <p className="text-muted-foreground text-small" data-conteudo>
                          {doc.resumo}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Secao>
            </article>
          </div>
        );
      }}
    </ComIndice>
  );
}
