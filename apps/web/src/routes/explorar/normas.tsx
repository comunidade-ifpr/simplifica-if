/**
 * As normas da base: no alto, a linha do tempo (um sinal por norma, que acompanha os filtros, e o ano que
 * filtra a lista); embaixo, a lista agrupada por ano (o mais recente primeiro), com o sinal da situação de
 * vigência na data da base e filtros por órgão, tipo, ano e situação. Cada uma abre no leitor do M1.6.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  filtrarNormas,
  type FiltrosNormas,
  nomeSituacaoNorma,
  nomeVigencia,
  normasPorAno,
  opcoes,
  vigenciaDaNorma,
} from "../../explorar/colecoes.ts";
import {
  buscaDeTextos,
  CampoFiltro,
  CampoTexto,
  ComIndice,
  Dado,
  Filtros,
  LinhaItem,
  ListaItens,
} from "../../explorar/componentes.tsx";
import { LinhaDoTempo } from "../../explorar/LinhaDoTempo.tsx";
import { SinalVigencia, SituacaoVigencia } from "../../explorar/Vigencia.tsx";

const CAMPOS = ["texto", "orgao", "tipo", "ano", "vigencia"] as const;

export const Route = createFileRoute("/explorar/normas")({
  component: Normas,
  validateSearch: buscaDeTextos(CAMPOS),
});

function Normas() {
  const filtros: FiltrosNormas = Route.useSearch();
  const navegar = useNavigate({ from: Route.fullPath });
  const mudar = (campo: keyof FiltrosNormas) => (valor: string | undefined) =>
    void navegar({ search: (atual) => ({ ...atual, [campo]: valor }), replace: true });
  return (
    <ComIndice>
      {(d) => {
        const achadas = filtrarNormas(d.normas, filtros);
        const filtrado = Object.values(filtros).some((v) => v !== undefined);
        return (
          <section aria-labelledby="titulo-normas" className="space-y-4">
            <h2 id="titulo-normas" className="text-title">
              Normas
            </h2>
            <LinhaDoTempo
              normas={d.normas}
              acesas={filtrado ? new Set(achadas.map((n) => n.id)) : null}
              ano={filtros.ano}
            />
            <Filtros
              total={d.normas.length}
              achados={achadas.length}
              nomes={["norma", "normas"]}
              aoLimpar={Object.keys(filtros).length > 0 ? () => void navegar({ search: {}, replace: true }) : null}
            >
              <CampoTexto rotulo="Filtrar pelo nome ou número" valor={filtros.texto} aoMudar={mudar("texto")} />
              <CampoFiltro
                rotulo="Órgão"
                valor={filtros.orgao}
                opcoes={opcoes(d.normas.map((n) => n.orgao))}
                aoMudar={mudar("orgao")}
              />
              <CampoFiltro
                rotulo="Tipo"
                valor={filtros.tipo}
                opcoes={opcoes(d.normas.map((n) => n.tipo))}
                aoMudar={mudar("tipo")}
              />
              <CampoFiltro
                rotulo="Ano"
                valor={filtros.ano}
                opcoes={opcoes(d.normas.map((n) => (n.ano === null ? null : String(n.ano)))).reverse()}
                aoMudar={mudar("ano")}
              />
              <CampoFiltro
                rotulo="Situação de vigência"
                todos="Todas"
                valor={filtros.vigencia}
                opcoes={opcoes(d.normas.map((n) => n.status_vigencia))}
                nome={nomeVigencia}
                aoMudar={mudar("vigencia")}
              />
            </Filtros>
            {achadas.length === 0 ? (
              <ListaItens vazia>{null}</ListaItens>
            ) : (
              <div className="border-border border-t">
                {normasPorAno(achadas).map((grupo) => (
                  <section
                    key={grupo.ano ?? "sem-ano"}
                    aria-label={grupo.ano === null ? "Normas sem ano" : `Normas de ${grupo.ano}`}
                    className="grid border-border border-b sm:grid-cols-[6rem_minmax(0,1fr)]"
                  >
                    <h3 className="px-3 pt-3 font-bold text-muted-foreground text-title tabular-nums [font-stretch:80%] sm:sticky sm:top-0 sm:self-start">
                      {grupo.ano ?? "Sem ano"}
                    </h3>
                    <ul className="divide-y divide-border">
                      {grupo.normas.map((n) => {
                        const vigencia = vigenciaDaNorma(n);
                        return (
                          <LinhaItem
                            key={n.id}
                            link={n.link}
                            titulo={n.titulo}
                            detalhe={n.ementa ?? (n.situacao === "base" ? null : nomeSituacaoNorma(n.situacao))}
                            serifado={n.ementa !== null}
                            marca={<SinalVigencia vigencia={vigencia} />}
                            selos={
                              <>
                                {n.orgao ? <Dado>{n.orgao}</Dado> : null}
                                {n.ementa !== null && n.situacao !== "base" ? (
                                  <Dado>{nomeSituacaoNorma(n.situacao)}</Dado>
                                ) : null}
                                <span className="flex w-44 flex-col items-start gap-0.5">
                                  <SituacaoVigencia vigencia={vigencia} />
                                </span>
                              </>
                            }
                          />
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </section>
        );
      }}
    </ComIndice>
  );
}
