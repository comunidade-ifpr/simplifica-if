/**
 * Os PPCs convertidos, com filtros por campus, nível e forma de oferta. Por padrão, só os vigentes; o
 * filtro "Versões" mostra também os substituídos, que ficam na base. Cada um abre no leitor.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { filtrarPpcs, type FiltrosPpcs, opcoes, primeiraMaiuscula } from "../../explorar/colecoes.ts";
import {
  buscaDeTextos,
  CampoFiltro,
  CampoTexto,
  ComIndice,
  Filtros,
  LinhaItem,
  ListaItens,
} from "../../explorar/componentes.tsx";

const CAMPOS = ["texto", "campus", "nivel", "forma", "substituidos"] as const;

export const Route = createFileRoute("/explorar/ppcs")({
  component: Ppcs,
  validateSearch: buscaDeTextos(CAMPOS),
});

function Ppcs() {
  const busca = Route.useSearch();
  const filtros: FiltrosPpcs = { ...busca, substituidos: busca.substituidos === "sim" };
  const navegar = useNavigate({ from: Route.fullPath });
  const mudar = (campo: (typeof CAMPOS)[number]) => (valor: string | undefined) =>
    void navegar({ search: (atual) => ({ ...atual, [campo]: valor }), replace: true });
  return (
    <ComIndice>
      {(d) => {
        const achados = filtrarPpcs(d.ppcs, filtros);
        const nomeCampus = new Map(d.campi.map((c) => [c.id, c.nome]));
        return (
          <section aria-labelledby="titulo-ppcs" className="space-y-4">
            <h2 id="titulo-ppcs" className="text-title">
              Projetos Pedagógicos de Curso
            </h2>
            <p className="text-muted-foreground text-sm">
              Os PPCs são exemplos de como os campi escreveram os seus cursos, não normas. Para um assunto (como
              “acompanhamento de egressos”), use a busca: ela procura também no texto das seções.
            </p>
            <Filtros
              total={filtros.substituidos ? d.ppcs.length : d.ppcs.filter((p) => p.vigente).length}
              achados={achados.length}
              nomes={["PPC", "PPCs"]}
              aoLimpar={Object.keys(busca).length > 0 ? () => void navegar({ search: {}, replace: true }) : null}
            >
              <CampoTexto rotulo="Filtrar pelo nome do curso" valor={filtros.texto} aoMudar={mudar("texto")} />
              <CampoFiltro
                rotulo="Campus"
                valor={filtros.campus}
                opcoes={opcoes(d.ppcs.map((p) => p.campus)).sort((a, b) =>
                  (nomeCampus.get(a) ?? a).localeCompare(nomeCampus.get(b) ?? b, "pt-BR"),
                )}
                nome={(v) => nomeCampus.get(v) ?? v}
                aoMudar={mudar("campus")}
              />
              <CampoFiltro
                rotulo="Nível"
                valor={filtros.nivel}
                opcoes={opcoes(d.ppcs.map((p) => p.nivel))}
                nome={primeiraMaiuscula}
                aoMudar={mudar("nivel")}
              />
              <CampoFiltro
                rotulo="Forma de oferta"
                todos="Todas"
                valor={filtros.forma}
                opcoes={opcoes(d.ppcs.map((p) => p.forma))}
                nome={primeiraMaiuscula}
                aoMudar={mudar("forma")}
              />
              <CampoFiltro
                rotulo="Versões"
                todos="Só os vigentes"
                valor={busca.substituidos}
                opcoes={["sim"]}
                nome={() => "Também os substituídos"}
                aoMudar={mudar("substituidos")}
              />
            </Filtros>
            <ListaItens vazia={achados.length === 0}>
              {achados.map((p) => (
                <LinhaItem
                  key={p.chave}
                  link={p.link}
                  titulo={p.nome}
                  detalhe={[
                    `Campus ${p.campus_nome}`,
                    p.forma,
                    p.ano === null ? null : `documento de ${p.ano}`,
                    p.vigente ? null : "substituído",
                  ]
                    .filter(Boolean)
                    .map((t) => primeiraMaiuscula(t!))
                    .join(" · ")}
                />
              ))}
            </ListaItens>
          </section>
        );
      }}
    </ComIndice>
  );
}
