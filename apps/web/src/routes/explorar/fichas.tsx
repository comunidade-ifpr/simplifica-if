/** As fichas de análise de PPC (os critérios da `revisar-ppc`), por tema. Cada uma abre a página dela. */
import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "../../components/ui/badge.tsx";
import { nomeCriticidade } from "../../explorar/colecoes.ts";
import { ComIndice, LinhaItem, ListaItens } from "../../explorar/componentes.tsx";

export const Route = createFileRoute("/explorar/fichas")({ component: Fichas });

function Fichas() {
  return (
    <ComIndice>
      {(d) => (
        <section aria-labelledby="titulo-fichas" className="space-y-4">
          <h2 id="titulo-fichas" className="font-semibold text-lg">
            Fichas de análise de PPC
          </h2>
          <p className="text-muted-foreground text-sm">
            Os critérios que a análise de PPC do app confere. Ajudam a revisar; não são normas.
          </p>
          <p role="status" className="text-muted-foreground text-sm">
            {d.fichas.length} fichas
          </p>
          <ListaItens vazia={d.fichas.length === 0}>
            {d.fichas.map((f) => (
              <LinhaItem
                key={f.id}
                link={f.link}
                titulo={`${f.id}: ${f.titulo}`}
                selos={
                  f.criticidade ? (
                    <Badge variant={f.criticidade === "BLOQ" ? "warning" : "outline"}>
                      {nomeCriticidade(f.criticidade)}
                    </Badge>
                  ) : null
                }
              />
            ))}
          </ListaItens>
        </section>
      )}
    </ComIndice>
  );
}
