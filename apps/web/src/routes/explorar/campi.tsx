/** Os campi do IFPR, com quantos cursos cada um tem na base. Cada um abre a ficha do campus. */
import { createFileRoute } from "@tanstack/react-router";
import { ComIndice, LinhaItem, ListaItens } from "../../explorar/componentes.tsx";

export const Route = createFileRoute("/explorar/campi")({ component: Campi });

function Campi() {
  return (
    <ComIndice>
      {(d) => {
        const cursos = new Map<string, number>();
        for (const c of d.cursos) cursos.set(c.campus, (cursos.get(c.campus) ?? 0) + 1);
        const campi = [...d.campi].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
        return (
          <section aria-labelledby="titulo-campi" className="space-y-4">
            <h2 id="titulo-campi" className="font-semibold text-lg">
              Campi
            </h2>
            <p role="status" className="text-muted-foreground text-sm">
              {campi.length} campi
            </p>
            <ListaItens vazia={campi.length === 0}>
              {campi.map((c) => {
                const n = cursos.get(c.id) ?? 0;
                return (
                  <LinhaItem
                    key={c.id}
                    link={c.link}
                    titulo={`Campus ${c.nome}`}
                    detalhe={[
                      n === 1 ? "1 curso na base" : `${n} cursos na base`,
                      c.horarios_url ? "horários de aula publicados" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
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
