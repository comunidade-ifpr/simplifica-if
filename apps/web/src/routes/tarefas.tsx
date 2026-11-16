/** "Ver todas": o catálogo das tarefas por área (as nativas do app e as skills do servidor). */
import { createFileRoute } from "@tanstack/react-router";
import { AvisoErro } from "../components/AvisoErro.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { areaTarefa, nomeTarefa, type Tarefa, tarefasDoPerfil, useCatalogo } from "../tarefas/catalogo.ts";
import { usePerfil } from "../tarefas/perfil.ts";
import { nomeArea } from "../tarefas/textos.ts";
import { CartaoTarefa } from "../tarefas/CartaoTarefa.tsx";

export const Route = createFileRoute("/tarefas")({ component: TodasAsTarefas });

function TodasAsTarefas() {
  const catalogo = useCatalogo();
  const perfil = usePerfil();
  const tarefas = tarefasDoPerfil(catalogo.fase === "pronto" ? catalogo.skills : [], perfil);
  const porArea = new Map<string, Array<Tarefa>>();
  for (const tarefa of tarefas) porArea.set(areaTarefa(tarefa), [...(porArea.get(areaTarefa(tarefa)) ?? []), tarefa]);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
        <h1 className="font-bold text-2xl tracking-tight">Todas as tarefas</h1>
        {catalogo.fase === "falhou" ? <AvisoErro erro={catalogo.erro} /> : null}
        {catalogo.fase === "carregando" ? (
          <p className="flex items-center gap-2 text-muted-foreground text-sm">
            <Spinner size="sm" /> Carregando as tarefas…
          </p>
        ) : null}
        {[...porArea].map(([area, daArea]) => (
          <section key={area} aria-labelledby={`area-${area}`} className="flex flex-col gap-3">
            <h2 id={`area-${area}`} className="font-semibold text-lg">
              {nomeArea(area)}
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {daArea.map((tarefa) => (
                <li key={nomeTarefa(tarefa)}>
                  <CartaoTarefa tarefa={tarefa} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
