/**
 * O Consepe: as reuniões da base e os itens de pauta de todas elas, com filtros por tipo de demanda e
 * campus. Cada item ligado a um curso leva à ficha dele; cada reunião, à página dela.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Badge } from "../../components/ui/badge.tsx";
import { dataBr, opcoes, quantos } from "../../explorar/colecoes.ts";
import {
  buscaDeTextos,
  CampoFiltro,
  classeLinha,
  classeLinkLinha,
  ComIndice,
  Filtros,
} from "../../explorar/componentes.tsx";

const CAMPOS = ["demanda", "campus"] as const;

export const Route = createFileRoute("/explorar/consepe")({
  component: Consepe,
  validateSearch: buscaDeTextos(CAMPOS),
});

function Consepe() {
  const filtros = Route.useSearch();
  const navegar = useNavigate({ from: Route.fullPath });
  const mudar = (campo: (typeof CAMPOS)[number]) => (valor: string | undefined) =>
    void navegar({ search: (atual) => ({ ...atual, [campo]: valor }), replace: true });
  return (
    <ComIndice>
      {(d) => {
        const nomeCampus = new Map(d.campi.map((c) => [c.id, c.nome]));
        const todos = d.reunioes.flatMap((r) => r.itens.map((item) => ({ item, reuniao: r })));
        const achados = todos.filter(
          ({ item }) =>
            (filtros.demanda === undefined || item.tipo_demanda === filtros.demanda) &&
            (filtros.campus === undefined || item.campus === filtros.campus),
        );
        return (
          <div className="space-y-6">
            <section aria-labelledby="titulo-reunioes" className="space-y-3">
              <h2 id="titulo-reunioes" className="text-title">
                Reuniões do Consepe
              </h2>
              <ul className="grid gap-x-12 border-border border-t md:grid-cols-2">
                {d.reunioes.map((r) => (
                  <li key={r.id} className={`${classeLinha} border-border border-b`}>
                    <div className="min-w-0 flex-1">
                      <Link to="/explorar/reuniao" search={{ id: r.id }} className={classeLinkLinha}>
                        {r.titulo}
                      </Link>
                      <p className="text-muted-foreground text-small">
                        {quantos(r.itens.length, "item de pauta", "itens de pauta")},{" "}
                        {quantos(r.documentos.length, "documento", "documentos")}
                      </p>
                    </div>
                    <span className="pt-0.5 text-muted-foreground text-small tabular-nums">{dataBr(r.data)}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section aria-labelledby="titulo-itens" className="space-y-3">
              <h2 id="titulo-itens" className="text-title">
                Itens de pauta
              </h2>
              <Filtros
                total={todos.length}
                achados={achados.length}
                nomes={["item", "itens"]}
                aoLimpar={Object.keys(filtros).length > 0 ? () => void navegar({ search: {}, replace: true }) : null}
              >
                <CampoFiltro
                  rotulo="Tipo de demanda"
                  valor={filtros.demanda}
                  opcoes={opcoes(todos.map(({ item }) => item.tipo_demanda))}
                  aoMudar={mudar("demanda")}
                />
                <CampoFiltro
                  rotulo="Campus"
                  valor={filtros.campus}
                  opcoes={opcoes(todos.map(({ item }) => item.campus)).sort((a, b) =>
                    (nomeCampus.get(a) ?? a).localeCompare(nomeCampus.get(b) ?? b, "pt-BR"),
                  )}
                  nome={(v) => nomeCampus.get(v) ?? v}
                  aoMudar={mudar("campus")}
                />
              </Filtros>
              {achados.length === 0 ? (
                <p className="text-muted-foreground text-sm">Nada com esses filtros.</p>
              ) : (
                <ul className="divide-y divide-border border-border border-y">
                  {achados.map(({ item, reuniao }) => (
                    <li key={item.id} className="py-3">
                      <p className="max-w-[76ch]" data-conteudo>
                        {item.titulo}
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-small">
                        {item.tipo_demanda ? <Badge variant="outline">{item.tipo_demanda}</Badge> : null}
                        {item.resultado ? <span>{item.resultado}</span> : null}
                        <Link to="/explorar/reuniao" search={{ id: reuniao.id }} className="link-grifo">
                          Reunião de {dataBr(reuniao.data)}
                        </Link>
                        {item.curso ? (
                          <Link
                            to="/explorar/ver"
                            search={{ link: `ifpr://curso/${item.curso}` }}
                            className="link-grifo"
                          >
                            Ficha do curso
                          </Link>
                        ) : null}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        );
      }}
    </ComIndice>
  );
}
