/**
 * "Ver todas": o catálogo inteiro por área (as nativas do app e as skills do servidor), com as que servem
 * à função do perfil primeiro e marcadas (M1.8).
 */
import { createFileRoute } from "@tanstack/react-router";
import { AvisoErro } from "../components/AvisoErro.tsx";
import { Pagina } from "../components/Pagina.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import {
  areaTarefa,
  nomeTarefa,
  publicoTarefa,
  servePerfil,
  type Tarefa,
  tarefasDoPerfil,
  useCatalogo,
} from "../tarefas/catalogo.ts";
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
    <Pagina largura="larga">
      <h1 className="text-display">Todas as tarefas</h1>
      {catalogo.fase === "falhou" ? <AvisoErro erro={catalogo.erro} /> : null}
      {catalogo.fase === "carregando" ? (
        <p className="flex items-center gap-2 text-muted-foreground text-sm">
          <Spinner size="sm" /> Carregando as tarefas…
        </p>
      ) : null}
      {[...porArea].map(([area, daArea]) => (
        <section key={area} aria-labelledby={`area-${area}`} className="flex flex-col gap-3">
          <h2 id={`area-${area}`} className="text-title">
            {nomeArea(area)}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {daArea.map((tarefa) => (
              <li key={nomeTarefa(tarefa)}>
                <CartaoTarefa
                  tarefa={tarefa}
                  paraVoce={servePerfil(tarefa, perfil) === true && publicoTarefa(tarefa).length > 0}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Pagina>
  );
}
