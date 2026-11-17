/**
 * As normas da base, com filtros por órgão, tipo, ano e situação de vigência (na data da base). Cada uma
 * abre no leitor do M1.6.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Badge } from "../../components/ui/badge.tsx";
import {
  A_CONFIRMAR,
  filtrarNormas,
  type FiltrosNormas,
  nomeSituacaoNorma,
  nomeVigencia,
  opcoes,
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

const CAMPOS = ["texto", "orgao", "tipo", "ano", "vigencia"] as const;

export const Route = createFileRoute("/explorar/normas")({
  component: Normas,
  validateSearch: buscaDeTextos(CAMPOS),
});

const VARIANTE: Readonly<Record<string, "success" | "error" | "warning" | "outline">> = {
  vigente: "success",
  revogada: "error",
  "parcialmente revogada": "warning",
  alterada: "outline",
  "a confirmar": "warning",
};

function Normas() {
  const filtros: FiltrosNormas = Route.useSearch();
  const navegar = useNavigate({ from: Route.fullPath });
  const mudar = (campo: keyof FiltrosNormas) => (valor: string | undefined) =>
    void navegar({ search: (atual) => ({ ...atual, [campo]: valor }), replace: true });
  return (
    <ComIndice>
      {(d) => {
        const achadas = filtrarNormas(d.normas, filtros);
        return (
          <section aria-labelledby="titulo-normas" className="space-y-4">
            <h2 id="titulo-normas" className="font-semibold text-lg">
              Normas
            </h2>
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
                opcoes={[
                  ...opcoes(d.normas.map((n) => n.status_vigencia)).filter((s) => s !== "a confirmar"),
                  A_CONFIRMAR,
                ]}
                nome={(v) => (v === A_CONFIRMAR ? "Vigência a confirmar" : nomeVigencia(v))}
                aoMudar={mudar("vigencia")}
              />
            </Filtros>
            <ListaItens vazia={achadas.length === 0}>
              {achadas.map((n) => (
                <LinhaItem
                  key={n.id}
                  link={n.link}
                  titulo={n.titulo}
                  detalhe={n.ementa}
                  selos={
                    <>
                      {n.status_vigencia ? (
                        <Badge variant={VARIANTE[n.status_vigencia] ?? "outline"}>
                          {nomeVigencia(n.status_vigencia)}
                        </Badge>
                      ) : null}
                      {n.vigencia_a_confirmar && n.status_vigencia !== "a confirmar" ? (
                        <Badge variant="warning">Vigência a confirmar</Badge>
                      ) : null}
                      {n.situacao !== "base" ? <Badge variant="outline">{nomeSituacaoNorma(n.situacao)}</Badge> : null}
                      {n.orgao ? <Badge variant="outline">{n.orgao}</Badge> : null}
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
