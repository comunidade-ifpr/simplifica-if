/**
 * Os cursos do IFPR na base, com filtros por campus, nível, eixo tecnológico do CNCT, forma de oferta,
 * turno e processo seletivo. Cada um abre a ficha do curso.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Badge } from "../../components/ui/badge.tsx";
import {
  filtrarCursos,
  type FiltrosCursos,
  nomeProcesso,
  nomeTurno,
  opcoes,
  primeiraMaiuscula,
} from "../../explorar/colecoes.ts";
import {
  buscaDeTextos,
  CampoFiltro,
  CampoTexto,
  ComIndice,
  Filtros,
  LinhaItem,
  ListaItens,
} from "../../explorar/componentes.tsx";

const CAMPOS = ["texto", "campus", "nivel", "eixo", "forma", "turno", "processo"] as const;

export const Route = createFileRoute("/explorar/cursos")({
  component: Cursos,
  validateSearch: buscaDeTextos(CAMPOS),
});

function Cursos() {
  const filtros: FiltrosCursos = Route.useSearch();
  const navegar = useNavigate({ from: Route.fullPath });
  const mudar = (campo: keyof FiltrosCursos) => (valor: string | undefined) =>
    void navegar({ search: (atual) => ({ ...atual, [campo]: valor }), replace: true });
  return (
    <ComIndice>
      {(d) => {
        const achados = filtrarCursos(d.cursos, filtros);
        const nomeCampus = new Map(d.campi.map((c) => [c.id, c.nome]));
        return (
          <section aria-labelledby="titulo-cursos" className="space-y-4">
            <h2 id="titulo-cursos" className="text-title">
              Cursos
            </h2>
            <Filtros
              total={d.cursos.length}
              achados={achados.length}
              nomes={["curso", "cursos"]}
              aoLimpar={Object.keys(filtros).length > 0 ? () => void navegar({ search: {}, replace: true }) : null}
            >
              <CampoTexto rotulo="Filtrar pelo nome" valor={filtros.texto} aoMudar={mudar("texto")} />
              <CampoFiltro
                rotulo="Campus"
                valor={filtros.campus}
                opcoes={opcoes(d.cursos.map((c) => c.campus)).sort((a, b) =>
                  (nomeCampus.get(a) ?? a).localeCompare(nomeCampus.get(b) ?? b, "pt-BR"),
                )}
                nome={(v) => nomeCampus.get(v) ?? v}
                aoMudar={mudar("campus")}
              />
              <CampoFiltro
                rotulo="Nível"
                valor={filtros.nivel}
                opcoes={opcoes(d.cursos.map((c) => c.nivel))}
                nome={primeiraMaiuscula}
                aoMudar={mudar("nivel")}
              />
              <CampoFiltro
                rotulo="Eixo tecnológico"
                valor={filtros.eixo}
                opcoes={opcoes(d.cursos.map((c) => c.cnct?.eixo))}
                aoMudar={mudar("eixo")}
              />
              <CampoFiltro
                rotulo="Forma de oferta"
                todos="Todas"
                valor={filtros.forma}
                opcoes={opcoes(d.cursos.map((c) => c.forma_oferta))}
                nome={primeiraMaiuscula}
                aoMudar={mudar("forma")}
              />
              <CampoFiltro
                rotulo="Turno"
                valor={filtros.turno}
                opcoes={opcoes(d.cursos.flatMap((c) => c.turnos))}
                nome={nomeTurno}
                aoMudar={mudar("turno")}
              />
              <CampoFiltro
                rotulo="Processo seletivo"
                valor={filtros.processo}
                opcoes={opcoes(d.cursos.flatMap((c) => c.processos))}
                nome={(v) => nomeProcesso(v, d.processos)}
                aoMudar={mudar("processo")}
              />
            </Filtros>
            <ListaItens vazia={achados.length === 0}>
              {achados.map((c) => (
                <LinhaItem
                  key={c.id}
                  link={c.link}
                  titulo={c.nome}
                  detalhe={[`Campus ${c.campus_nome}`, c.nivel, c.forma_oferta, c.turnos.map(nomeTurno).join(", ")]
                    .filter(Boolean)
                    .map((p) => primeiraMaiuscula(p!))
                    .join(" · ")}
                  selos={
                    <>
                      {c.cnct ? <Badge variant="outline">{c.cnct.eixo ?? "CNCT"}</Badge> : null}
                      {c.ppc ? (
                        <Badge variant="outline">PPC {c.ppc.ano ?? "sem ano"}</Badge>
                      ) : (
                        <Badge variant="warning">Sem PPC na base</Badge>
                      )}
                      {c.situacao && c.situacao !== "ativo" ? (
                        <Badge variant="warning">{primeiraMaiuscula(c.situacao)}</Badge>
                      ) : null}
                    </>
                  }
                />
              ))}
            </ListaItens>
          </section>
        );
      }}
    </ComIndice>
  );
}
