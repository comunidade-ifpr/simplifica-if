/**
 * Uma reunião do Consepe: os documentos publicados (pauta, pareceres) e os itens de pauta, com o curso e
 * o campus de cada um quando a curadoria os ligou. Vem do índice do Explorar; os documentos abrem na
 * publicação oficial, no navegador.
 */
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { dataBr, pedidoSobre, primeiraMaiuscula } from "../../explorar/colecoes.ts";
import { ComIndice } from "../../explorar/componentes.tsx";
import { PerguntarIa } from "../../explorar/PerguntarIa.tsx";
import { fichaDoLink } from "../../painel/conversar.ts";
import { Cabecalho, Fatos, LinkExterno, Secao } from "../../leitor/pecas.tsx";
import { LinkDaBase } from "../../painel/LinkDaBase.tsx";

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
          <div className="space-y-6">
            <div className="nao-imprimir -mt-2 flex flex-wrap items-center justify-between gap-2">
              <Button size="sm" variant="ghost" className="-ml-2.5" onClick={() => roteador.history.back()}>
                <ArrowLeftIcon /> Voltar
              </Button>
              <PerguntarIa
                pedido={() => ({
                  texto: pedidoSobre(`a ${r.titulo}${r.fonte ? `, pauta em ${r.fonte}` : ""}`, []),
                  fichas: cursos.map((curso) => fichaDoLink(curso)),
                })}
              />
            </div>
            <article aria-label="Reunião do Consepe" className="space-y-8">
              <Cabecalho
                tipo={r.conselho_nome}
                titulo={r.titulo}
                acoes={r.fonte ? <LinkExterno href={r.fonte}>Pautas no site do IFPR</LinkExterno> : null}
              >
                <Fatos>
                  {[dataBr(r.data), r.tipo ? `Reunião ${r.tipo}` : null, r.situacao].filter(Boolean).map((p) => (
                    <span key={p}>{primeiraMaiuscula(p!)}</span>
                  ))}
                </Fatos>
              </Cabecalho>
              <Secao titulo={`Itens de pauta (${r.itens.length})`}>
                <ol className="divide-y divide-border border-border border-y">
                  {r.itens.map((i) => (
                    <li key={i.id} className="py-3">
                      <p className="max-w-[76ch]" data-conteudo>
                        {i.titulo}
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-small">
                        {i.tipo_demanda ? <Badge variant="outline">{i.tipo_demanda}</Badge> : null}
                        {i.resultado ? <span>{i.resultado}</span> : null}
                        {i.processo_sei ? <span>Processo SEI {i.processo_sei}</span> : null}
                        {i.curso ? (
                          <LinkDaBase link={`ifpr://curso/${i.curso}`} className="link-grifo">
                            Ficha do curso
                          </LinkDaBase>
                        ) : null}
                        {i.campus ? (
                          <LinkDaBase link={`ifpr://campus/${i.campus}`} className="link-grifo">
                            Campus {nomeCampus.get(i.campus) ?? i.campus}
                          </LinkDaBase>
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
