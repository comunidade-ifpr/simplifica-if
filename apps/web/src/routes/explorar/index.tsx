/**
 * A entrada do Explorar: quanto há de cada coleção, com o caminho para ela, e a dica da busca.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { ComIndice } from "../../explorar/componentes.tsx";
import { atalhoPaleta } from "../../explorar/Paleta.tsx";

export const Route = createFileRoute("/explorar/")({ component: Entrada });

function Cartao({
  to,
  titulo,
  contagem,
  descricao,
}: {
  readonly to:
    | "/explorar/normas"
    | "/explorar/cursos"
    | "/explorar/ppcs"
    | "/explorar/campi"
    | "/explorar/cnct"
    | "/explorar/consepe"
    | "/explorar/fichas";
  readonly titulo: string;
  readonly contagem: string;
  readonly descricao: string;
}) {
  return (
    <li>
      <Link
        to={to}
        className="flex h-full flex-col gap-1 rounded-xl border border-border bg-card p-4 shadow-xs transition-colors hover:border-ring/45"
      >
        <span className="font-semibold">{titulo}</span>
        <span className="font-bold text-2xl text-primary">{contagem}</span>
        <span className="text-muted-foreground text-sm">{descricao}</span>
      </Link>
    </li>
  );
}

function Entrada() {
  return (
    <ComIndice>
      {(d) => (
        <div className="space-y-5">
          <p className="text-sm">
            Use <kbd className="rounded border border-border px-1 text-xs">{atalhoPaleta()}</kbd> em qualquer tela para
            buscar um curso, um campus, uma norma ou uma citação, como “Res. CNE/CP 1/2021, art. 20”.
          </p>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Cartao
              to="/explorar/normas"
              titulo="Normas"
              contagem={String(d.normas.length)}
              descricao="Leis, resoluções, portarias e notas técnicas, com a situação de vigência."
            />
            <Cartao
              to="/explorar/cursos"
              titulo="Cursos"
              contagem={String(d.cursos.length)}
              descricao="Os cursos do IFPR, com o PPC, as ofertas e as divergências com o SUAP."
            />
            <Cartao
              to="/explorar/ppcs"
              titulo="PPCs"
              contagem={String(d.ppcs.length)}
              descricao="Os Projetos Pedagógicos de Curso convertidos, para ler e comparar."
            />
            <Cartao
              to="/explorar/campi"
              titulo="Campi"
              contagem={String(d.campi.length)}
              descricao="Os cursos de cada campus, o calendário e os horários de aula."
            />
            <Cartao
              to="/explorar/cnct"
              titulo="CNCT"
              contagem={String(d.cnct.length)}
              descricao="O Catálogo Nacional de Cursos Técnicos e os cursos do IFPR de cada habilitação."
            />
            <Cartao
              to="/explorar/consepe"
              titulo="Consepe"
              contagem={String(d.reunioes.reduce((n, r) => n + r.itens.length, 0))}
              descricao="Reuniões, pareceres e itens de pauta ligados aos cursos."
            />
            <Cartao
              to="/explorar/fichas"
              titulo="Fichas de análise"
              contagem={String(d.fichas.length)}
              descricao="Os critérios da análise de PPC do app."
            />
          </ul>
        </div>
      )}
    </ComIndice>
  );
}
