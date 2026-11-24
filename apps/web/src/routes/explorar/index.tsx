/** A entrada do Explorar, abaixo da busca: o que há em cada coleção, com o caminho para ela. */
import type { DadosIndice } from "@simplifica-if/contratos-app";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRightIcon, type LucideIcon } from "lucide-react";
import { quantos } from "../../explorar/colecoes.ts";
import { ICONES_TIPO } from "../../explorar/icones.ts";
import { classeLinha, classeLinkLinha, ComIndice } from "../../explorar/componentes.tsx";

export const Route = createFileRoute("/explorar/")({ component: Entrada });

const COLECOES: ReadonlyArray<{
  readonly to:
    | "/explorar/normas"
    | "/explorar/cursos"
    | "/explorar/ppcs"
    | "/explorar/campi"
    | "/explorar/cnct"
    | "/explorar/consepe";
  readonly titulo: string;
  readonly icone: LucideIcon;
  readonly descricao: string;
  readonly contagem: (d: DadosIndice) => string;
}> = [
  {
    to: "/explorar/normas",
    titulo: "Normas",
    icone: ICONES_TIPO.norma,
    descricao: "Leis, resoluções, portarias e notas técnicas, com a situação de vigência e as relações entre elas.",
    contagem: (d) => quantos(d.normas.length, "norma", "normas"),
  },
  {
    to: "/explorar/cursos",
    titulo: "Cursos",
    icone: ICONES_TIPO.curso,
    descricao: "Os cursos do IFPR, com o PPC, as ofertas e as divergências com o SUAP.",
    contagem: (d) => quantos(d.cursos.length, "curso", "cursos"),
  },
  {
    to: "/explorar/ppcs",
    titulo: "PPCs",
    icone: ICONES_TIPO.ppc,
    descricao: "Os Projetos Pedagógicos de Curso convertidos, para ler e comparar.",
    contagem: (d) => quantos(d.ppcs.length, "PPC", "PPCs"),
  },
  {
    to: "/explorar/campi",
    titulo: "Campi",
    icone: ICONES_TIPO.campus,
    descricao: "Os cursos de cada campus, o calendário e os horários de aula.",
    contagem: (d) => quantos(d.campi.length, "campus", "campi"),
  },
  {
    to: "/explorar/cnct",
    titulo: "CNCT",
    icone: ICONES_TIPO.cnct,
    descricao: "O Catálogo Nacional de Cursos Técnicos e os cursos do IFPR de cada habilitação.",
    contagem: (d) => quantos(d.cnct.length, "curso no catálogo", "cursos no catálogo"),
  },
  {
    to: "/explorar/consepe",
    titulo: "Consepe",
    icone: ICONES_TIPO.consepe,
    descricao: "As reuniões do conselho, os pareceres e os itens de pauta ligados aos cursos.",
    contagem: (d) =>
      `${quantos(d.reunioes.length, "reunião", "reuniões")}, ${quantos(
        d.reunioes.reduce((n, r) => n + r.itens.length, 0),
        "item de pauta",
        "itens de pauta",
      )}`,
  },
];

function Entrada() {
  return (
    <ComIndice>
      {(d) => (
        <section aria-labelledby="titulo-colecoes" className="space-y-3">
          <h2 id="titulo-colecoes" className="text-title">
            O que há na base
          </h2>
          <ul className="grid gap-x-12 border-border border-t md:grid-cols-2">
            {COLECOES.map((c) => (
              <li key={c.to} className={`${classeLinha} border-border border-b`}>
                <c.icone aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <Link to={c.to} className={classeLinkLinha}>
                      {c.titulo}
                    </Link>
                    <span className="text-muted-foreground text-small tabular-nums">{c.contagem(d)}</span>
                  </p>
                  <p className="text-muted-foreground text-small">{c.descricao}</p>
                </div>
                <ChevronRightIcon
                  aria-hidden
                  className="mt-1 size-4 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 group-has-[a:focus-visible]:opacity-100"
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </ComIndice>
  );
}
