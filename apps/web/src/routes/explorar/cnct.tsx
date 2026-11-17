/**
 * O Catálogo Nacional de Cursos Técnicos, por eixo tecnológico, com quantos cursos do IFPR na base têm
 * cada habilitação. Cada curso do catálogo abre a página dele, com os cursos do IFPR que o ofertam.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Badge } from "../../components/ui/badge.tsx";
import { cursosPorCnct, filtrarCnct, opcoes } from "../../explorar/colecoes.ts";
import {
  buscaDeTextos,
  CampoFiltro,
  CampoTexto,
  ComIndice,
  Filtros,
  LinhaItem,
  ListaItens,
} from "../../explorar/componentes.tsx";

const CAMPOS = ["texto", "eixo", "ofertados"] as const;

export const Route = createFileRoute("/explorar/cnct")({
  component: Cnct,
  validateSearch: buscaDeTextos(CAMPOS),
});

function Cnct() {
  const busca = Route.useSearch();
  const filtros = { texto: busca.texto, eixo: busca.eixo, ofertados: busca.ofertados === "sim" };
  const navegar = useNavigate({ from: Route.fullPath });
  const mudar = (campo: (typeof CAMPOS)[number]) => (valor: string | undefined) =>
    void navegar({ search: (atual) => ({ ...atual, [campo]: valor }), replace: true });
  return (
    <ComIndice>
      {(d) => {
        const achados = filtrarCnct(d.cnct, d.cursos, filtros);
        const contagem = cursosPorCnct(d.cursos);
        return (
          <section aria-labelledby="titulo-cnct" className="space-y-4">
            <h2 id="titulo-cnct" className="font-semibold text-lg">
              Catálogo Nacional de Cursos Técnicos
            </h2>
            <Filtros
              total={d.cnct.length}
              achados={achados.length}
              nomes={["curso do catálogo", "cursos do catálogo"]}
              aoLimpar={Object.keys(busca).length > 0 ? () => void navegar({ search: {}, replace: true }) : null}
            >
              <CampoTexto rotulo="Filtrar pelo nome" valor={busca.texto} aoMudar={mudar("texto")} />
              <CampoFiltro
                rotulo="Eixo tecnológico"
                valor={busca.eixo}
                opcoes={opcoes(d.cnct.map((c) => c.eixo))}
                aoMudar={mudar("eixo")}
              />
              <CampoFiltro
                rotulo="No IFPR"
                todos="Todos os do catálogo"
                valor={busca.ofertados}
                opcoes={["sim"]}
                nome={() => "Só os que o IFPR oferta"}
                aoMudar={mudar("ofertados")}
              />
            </Filtros>
            <ListaItens vazia={achados.length === 0}>
              {achados.map((c) => {
                const n = contagem.get(c.slug) ?? 0;
                return (
                  <LinhaItem
                    key={c.slug}
                    link={c.link}
                    titulo={c.denominacao}
                    detalhe={[
                      `Eixo ${c.eixo}`,
                      c.carga_horaria_minima === null ? null : `mínimo de ${c.carga_horaria_minima} h`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    selos={
                      n > 0 ? (
                        <Badge variant="success">{n === 1 ? "1 curso no IFPR" : `${n} cursos no IFPR`}</Badge>
                      ) : null
                    }
                  />
                );
              })}
            </ListaItens>
          </section>
        );
      }}
    </ComIndice>
  );
}
