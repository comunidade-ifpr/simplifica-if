/**
 * As telas próprias do leitor para os links que não são texto (o que no M1.6 era o texto do
 * `lerLink`): a ficha do curso, o campus, o curso do CNCT e a ficha da revisão de PPC. Valem no
 * painel ao lado da conversa e nas páginas do Explorar. Tudo vem da base pelo `GrupoLeitura`, sem IA:
 *
 * - **curso:** `fichaCurso` (dados institucionais, CNCT, PPC, fatos e o cruzamento com o SUAP, ofertas,
 *   adequação ao art. 71, normas que o PPC cita) e o índice do Explorar (página oficial, processos,
 *   itens do Consepe);
 * - **campus:** `lerCampus` (cursos) e o índice (site, calendário, horários de aula, Consepe);
 * - **cnct:** `lerCnct` (o curso no catálogo e os cursos do IFPR que o ofertam);
 * - **ficha:** `lerFicha` (pergunta, rubrica, evidências e referências).
 *
 * Os valores do PPC nas divergências PPC × SUAP nem sempre foram revisados: a tela marca a divergência
 * "Extraído, conferir" quando o valor saiu do texto por regra e "Precisa de revisão" quando a curadoria
 * ainda não o conferiu (outro status que não "Revisado"), com o trecho de origem.
 */
import {
  type CursoDoIndice,
  type ItemDePauta,
  ROTULOS_INDICADOR,
  type ReuniaoDoIndice,
} from "@simplifica-if/contratos-app";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Alert, AlertDescription } from "../components/ui/alert.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { useApi } from "../contexto.tsx";
import {
  dataBr,
  nomeAspecto,
  nomeCriticidade,
  nomeFato,
  nomeProcesso,
  nomeResultado,
  nomeTurno,
  nomeVigencia,
  primeiraMaiuscula,
  ressalvaDoFato,
  valorFato,
} from "../explorar/colecoes.ts";
import { useIndiceExplorar } from "../explorar/indice.ts";
import { useCarga } from "./carga.ts";
import { BotaoLink, Cabecalho, ComCarga, LinkExterno, Secao } from "./pecas.tsx";
import { dataCurta, situacaoDaTransicao } from "./textos.ts";

type AoAbrirLink = (link: string) => void;

/** Os fatos do PPC de cada aspecto do cruzamento com o SUAP. */
const FATOS_DO_ASPECTO: Readonly<Record<string, ReadonlyArray<string>>> = {
  ano: ["ano_documento"],
  carga_horaria: ["carga_horaria_total_h"],
  estagio: ["estagio_obrigatorio", "estagio_carga_h"],
};

/** Os itens de pauta do Consepe que atendem a `filtro`, com a reunião, mais recentes primeiro. */
function itensDoConsepe(
  reunioes: ReadonlyArray<ReuniaoDoIndice>,
  filtro: (item: ItemDePauta) => boolean,
): ReadonlyArray<{ readonly item: ItemDePauta; readonly reuniao: ReuniaoDoIndice }> {
  return reunioes.flatMap((reuniao) => reuniao.itens.filter(filtro).map((item) => ({ item, reuniao })));
}

function ListaConsepe({
  itens,
}: {
  readonly itens: ReadonlyArray<{ readonly item: ItemDePauta; readonly reuniao: ReuniaoDoIndice }>;
}) {
  if (itens.length === 0) return null;
  return (
    <Secao titulo="No Consepe">
      <ul className="space-y-2 text-sm">
        {itens.map(({ item, reuniao }) => (
          <li key={item.id} className="rounded-md border border-border p-2">
            <p data-conteudo>{item.resumo ?? item.titulo}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
              {item.tipo_demanda ? <Badge variant="outline">{item.tipo_demanda}</Badge> : null}
              {item.resultado ? <span>{item.resultado}</span> : null}
              <Link
                to="/explorar/reuniao"
                search={{ id: reuniao.id }}
                className="font-semibold text-primary underline underline-offset-2"
              >
                {reuniao.conselho}, reunião de {dataBr(reuniao.data)}
              </Link>
            </p>
          </li>
        ))}
      </ul>
    </Secao>
  );
}

function Linha({ rotulo, children }: { readonly rotulo: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2 text-sm">
      <dt className="text-muted-foreground">{rotulo}:</dt>
      <dd>{children}</dd>
    </div>
  );
}

/* ================================================================== curso */

export function FichaCurso({ id, aoAbrirLink }: { readonly id: string; readonly aoAbrirLink: AoAbrirLink }) {
  const api = useApi();
  const ficha = useCarga(`curso:${id}`, () => api.chamar((c) => c.fichaCurso({ curso: id })));
  const indice = useIndiceExplorar();
  const doIndice: CursoDoIndice | undefined =
    indice.fase === "lido" ? indice.valor.cursos.find((c) => c.id === id) : undefined;
  return (
    <ComCarga carga={ficha} titulo="Não foi possível ler este curso">
      {({ dados: d }) => {
        // a ressalva de cada fato do PPC que não foi revisado ("Extraído, conferir", "Precisa de revisão")
        const ressalvas = new Map(
          (d.fatos?.fatos ?? []).flatMap((f) => {
            const ressalva = ressalvaDoFato(f.status_curadoria);
            return ressalva === null ? [] : [[f.fato, ressalva] as const];
          }),
        );
        const ressalvasDoAspecto = (aspecto: string) => [
          ...new Set((FATOS_DO_ASPECTO[aspecto] ?? []).flatMap((f) => (ressalvas.has(f) ? [ressalvas.get(f)!] : []))),
        ];
        const divergencias = (d.fatos?.cruzamento ?? []).filter((c) => nomeResultado(c.resultado).alerta);
        const consepe = indice.fase === "lido" ? itensDoConsepe(indice.valor.reunioes, (i) => i.curso === id) : [];
        return (
          <article aria-label="Curso" className="leitor-impressao space-y-4">
            <Cabecalho tipo="Curso" titulo={d.curso.nome}>
              <p className="text-muted-foreground text-sm">
                {[`Campus ${d.campus.nome}`, d.curso.nivel, d.curso.forma_oferta, d.curso.modalidade]
                  .filter(Boolean)
                  .map((p) => primeiraMaiuscula(p!))
                  .join(" · ")}
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {d.curso.situacao ? (
                  <Badge variant={d.curso.situacao === "ativo" ? "success" : "warning"} size="lg">
                    {primeiraMaiuscula(d.curso.situacao)}
                  </Badge>
                ) : null}
                {divergencias.length > 0 ? (
                  <Badge variant="warning" size="lg">
                    {divergencias.length === 1
                      ? "1 divergência PPC × SUAP"
                      : `${divergencias.length} divergências PPC × SUAP`}
                  </Badge>
                ) : null}
              </div>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <BotaoLink link={d.campus.link} aoAbrirLink={aoAbrirLink}>
                  Campus {d.campus.nome}
                </BotaoLink>
                {d.ppc ? (
                  <BotaoLink link={d.ppc.link} aoAbrirLink={aoAbrirLink}>
                    Abrir o PPC
                  </BotaoLink>
                ) : null}
                {doIndice?.pagina_oficial ? (
                  <LinkExterno href={doIndice.pagina_oficial}>Página do curso</LinkExterno>
                ) : null}
              </p>
            </Cabecalho>

            <Secao titulo="Catálogo Nacional de Cursos Técnicos">
              {d.cnct ? (
                <dl className="space-y-0.5">
                  <Linha rotulo="Curso no catálogo">
                    <BotaoLink link={d.cnct.link} aoAbrirLink={aoAbrirLink}>
                      {d.cnct.nome}
                    </BotaoLink>
                  </Linha>
                  {d.cnct.eixo ? <Linha rotulo="Eixo tecnológico">{d.cnct.eixo}</Linha> : null}
                  {d.cnct.carga_horaria_minima ? (
                    <Linha rotulo="Carga horária mínima">{d.cnct.carga_horaria_minima} h</Linha>
                  ) : null}
                </dl>
              ) : (
                <p className="text-muted-foreground text-sm">Sem curso do catálogo registrado para este curso.</p>
              )}
            </Secao>

            <Secao titulo="PPC e SUAP">
              {d.ppc === null ? (
                <p className="text-muted-foreground text-sm">Este curso não tem PPC convertido na base.</p>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm">
                    PPC de {d.ppc.ano ?? "ano não informado"}.{" "}
                    <BotaoLink link={d.ppc.link} aoAbrirLink={aoAbrirLink}>
                      Ler o PPC
                    </BotaoLink>
                  </p>
                  {d.fatos && d.fatos.cruzamento.length > 0 ? (
                    <>
                      {ressalvas.size > 0 ? (
                        <Alert variant="info">
                          <AlertDescription>
                            Há valores do PPC sem revisão da curadoria: os marcados “Extraído, conferir” foram tirados
                            do texto por regra, e os marcados “Precisa de revisão” ainda não foram conferidos. Confira o
                            trecho no PPC antes de afirmar uma divergência.
                          </AlertDescription>
                        </Alert>
                      ) : null}
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <caption className="sr-only">Comparação entre o PPC e o SUAP</caption>
                          <thead className="text-muted-foreground text-xs">
                            <tr>
                              <th scope="col" className="py-1 pr-2 font-semibold">
                                Aspecto
                              </th>
                              <th scope="col" className="py-1 pr-2 font-semibold">
                                No PPC
                              </th>
                              <th scope="col" className="py-1 pr-2 font-semibold">
                                No SUAP
                              </th>
                              <th scope="col" className="py-1 font-semibold">
                                Resultado
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {d.fatos.cruzamento.map((c) => {
                              const resultado = nomeResultado(c.resultado);
                              const doAspecto = resultado.alerta ? ressalvasDoAspecto(c.aspecto) : [];
                              return (
                                <tr key={c.aspecto} className="border-border border-t align-top">
                                  <th scope="row" className="py-1.5 pr-2 font-medium">
                                    {nomeAspecto(c.aspecto)}
                                  </th>
                                  <td className="py-1.5 pr-2">{c.valor_ppc ?? "—"}</td>
                                  <td className="py-1.5 pr-2">{c.valor_suap ?? "—"}</td>
                                  <td className="space-y-1 py-1.5">
                                    <span className="flex flex-wrap gap-1">
                                      <Badge variant={resultado.alerta ? "warning" : "outline"}>{resultado.nome}</Badge>
                                      {doAspecto.map((ressalva) => (
                                        <Badge key={ressalva} variant="info">
                                          {ressalva}
                                        </Badge>
                                      ))}
                                    </span>
                                    <span className="block text-muted-foreground text-xs">{c.explicacao}</span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : null}
                  {d.fatos && d.fatos.fatos.length > 0 ? (
                    <details className="rounded-md border border-border p-2 text-sm">
                      <summary className="cursor-pointer font-semibold">
                        De onde saíram os valores do PPC ({d.fatos.fatos.length})
                      </summary>
                      <ul className="mt-2 space-y-2">
                        {d.fatos.fatos.map((f) => (
                          <li key={f.fato}>
                            <p>
                              <strong>{nomeFato(f.fato)}:</strong> {valorFato(f)}{" "}
                              {ressalvas.has(f.fato) ? <Badge variant="info">{ressalvas.get(f.fato)}</Badge> : null}
                            </p>
                            <p className="text-muted-foreground text-xs" data-conteudo>
                              “{f.trecho_fonte}” (linha {f.fonte.linha_inicio} do PPC)
                            </p>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
              )}
            </Secao>

            <Secao titulo="Ofertas">
              {d.ofertas.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Nenhuma oferta registrada nos processos seletivos da base.
                </p>
              ) : (
                <ul className="space-y-0.5 text-sm">
                  {d.ofertas.map((o) => (
                    <li key={`${o.processo}:${o.turno}:${o.vagas}`}>
                      {indice.fase === "lido" ? nomeProcesso(o.processo, indice.valor.processos) : o.processo}:{" "}
                      {o.turno ? nomeTurno(o.turno) : "turno não informado"}, {o.vagas ?? "?"} vagas
                    </li>
                  ))}
                </ul>
              )}
            </Secao>

            {d.adequacao_art71 || d.transicoes_aplicaveis.length > 0 ? (
              <Secao titulo="Adequação à nova DCN da EPT">
                {d.adequacao_art71 ? (
                  <p className="text-sm">
                    O PPC{" "}
                    <strong>
                      {ROTULOS_INDICADOR[d.adequacao_art71.indicador as keyof typeof ROTULOS_INDICADOR] ??
                        d.adequacao_art71.indicador}
                    </strong>
                    .{" "}
                    <BotaoLink link="ifpr://norma/br/cne-cp/res/2026/2#art71" aoAbrirLink={aoAbrirLink}>
                      Ver o prazo de adequação (art. 71)
                    </BotaoLink>
                  </p>
                ) : null}
                {d.transicoes_aplicaveis.length > 0 ? (
                  <ul className="space-y-2 text-sm">
                    {d.transicoes_aplicaveis.map((t) => (
                      <li key={t.id} className="rounded-md border border-border p-2">
                        <p data-conteudo>{t.regra}</p>
                        <p className="mt-1 text-muted-foreground text-xs">
                          Situação: {situacaoDaTransicao(t.situacao_na_data)}.{" "}
                          <BotaoLink link={t.link} aoAbrirLink={aoAbrirLink}>
                            Ver o dispositivo
                          </BotaoLink>
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Secao>
            ) : null}

            {d.ppc ? (
              <Secao titulo="Normas que o PPC cita">
                {d.normas_citadas.length === 0 ? (
                  <p className="text-muted-foreground text-sm">Nenhuma citação de norma identificada no PPC.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {d.normas_citadas.map((n) => (
                      <li key={n.id}>
                        <BotaoLink link={n.link} aoAbrirLink={aoAbrirLink}>
                          {n.titulo}
                        </BotaoLink>
                        <span className="text-muted-foreground">
                          {" "}
                          · {nomeVigencia(n.status_vigencia)} ·{" "}
                          {n.ocorrencias === 1 ? "1 citação" : `${n.ocorrencias} citações`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Secao>
            ) : null}

            <ListaConsepe itens={consepe} />
          </article>
        );
      }}
    </ComCarga>
  );
}

/* ================================================================== campus */

export function FichaCampus({ id, aoAbrirLink }: { readonly id: string; readonly aoAbrirLink: AoAbrirLink }) {
  const api = useApi();
  const lido = useCarga(`campus:${id}`, () => api.chamar((c) => c.lerCampus({ campus: id })));
  const indice = useIndiceExplorar();
  const doIndice = indice.fase === "lido" ? indice.valor.campi.find((c) => c.id === id) : undefined;
  const consepe = indice.fase === "lido" ? itensDoConsepe(indice.valor.reunioes, (i) => i.campus === id) : [];
  return (
    <ComCarga carga={lido} titulo="Não foi possível ler este campus">
      {({ dados: d }) => {
        const porNivel = new Map<string, typeof d.cursos>();
        for (const c of d.cursos) {
          const nivel = c.nivel === null ? "Outros" : primeiraMaiuscula(c.nivel);
          porNivel.set(nivel, [...(porNivel.get(nivel) ?? []), c]);
        }
        return (
          <article aria-label="Campus" className="leitor-impressao space-y-4">
            <Cabecalho tipo="Campus" titulo={`Campus ${d.campus.nome}`}>
              <p className="text-muted-foreground text-sm">
                {d.cursos.length === 1 ? "1 curso na base" : `${d.cursos.length} cursos na base`}
              </p>
            </Cabecalho>
            <Secao titulo="Contato e páginas do campus">
              <ul className="space-y-1">
                {d.campus.site ? (
                  <li>
                    <LinkExterno href={d.campus.site}>Site do campus</LinkExterno>
                  </li>
                ) : null}
                {doIndice?.calendario_academico ? (
                  <li>
                    <LinkExterno href={doIndice.calendario_academico}>Calendário acadêmico</LinkExterno>
                  </li>
                ) : null}
                {doIndice?.horarios_url ? (
                  <li>
                    <LinkExterno href={doIndice.horarios_url}>Horários de aula</LinkExterno>
                    {doIndice.horarios_coletado_em ? (
                      <span className="text-muted-foreground text-xs">
                        {" "}
                        (endereço conferido em {dataCurta(doIndice.horarios_coletado_em.slice(0, 10))})
                      </span>
                    ) : null}
                  </li>
                ) : indice.fase === "lido" ? (
                  <li className="text-muted-foreground text-sm">A página de horários de aula não está registrada.</li>
                ) : null}
              </ul>
            </Secao>
            <Secao titulo="Cursos">
              {d.cursos.length === 0 ? (
                <p className="text-muted-foreground text-sm">Nenhum curso deste campus na base.</p>
              ) : (
                <div className="space-y-3">
                  {[...porNivel].map(([nivel, cursos]) => (
                    <div key={nivel}>
                      <h4 className="font-semibold text-sm">{nivel}</h4>
                      <ul className="space-y-0.5 text-sm">
                        {cursos.map((c) => (
                          <li key={c.id}>
                            <BotaoLink link={c.link} aoAbrirLink={aoAbrirLink}>
                              {c.nome}
                            </BotaoLink>
                            <span className="text-muted-foreground">
                              {[c.forma_oferta, ...c.turnos.map(nomeTurno)].filter(Boolean).length > 0
                                ? ` · ${[c.forma_oferta, ...c.turnos.map(nomeTurno)].filter(Boolean).join(", ")}`
                                : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </Secao>
            <ListaConsepe itens={consepe} />
          </article>
        );
      }}
    </ComCarga>
  );
}

/* ================================================================== CNCT */

export function FichaCnct({ slug, aoAbrirLink }: { readonly slug: string; readonly aoAbrirLink: AoAbrirLink }) {
  const api = useApi();
  const lido = useCarga(`cnct:${slug}`, () => api.chamar((c) => c.lerCnct({ cnct: slug })));
  return (
    <ComCarga carga={lido} titulo="Não foi possível ler este curso do catálogo">
      {({ dados: d }) => (
        <article aria-label="Curso do catálogo" className="leitor-impressao space-y-4">
          <Cabecalho tipo="Catálogo Nacional de Cursos Técnicos" titulo={d.cnct.denominacao}>
            <dl className="space-y-0.5">
              {d.cnct.eixo ? <Linha rotulo="Eixo tecnológico">{d.cnct.eixo}</Linha> : null}
              {d.cnct.area ? <Linha rotulo="Área tecnológica">{d.cnct.area}</Linha> : null}
              {d.cnct.carga_horaria_minima ? (
                <Linha rotulo="Carga horária mínima">{d.cnct.carga_horaria_minima} h</Linha>
              ) : null}
            </dl>
          </Cabecalho>
          <Secao titulo="Cursos do IFPR com esta habilitação">
            {d.cursos_ifpr.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nenhum curso do IFPR na base oferta esta habilitação.</p>
            ) : (
              <ul className="space-y-0.5 text-sm">
                {d.cursos_ifpr.map((c) => (
                  <li key={c.id}>
                    <BotaoLink link={c.link} aoAbrirLink={aoAbrirLink}>
                      {c.nome}
                    </BotaoLink>
                    <span className="text-muted-foreground">
                      {" "}
                      · Campus {c.campus.nome ?? c.campus.id}
                      {c.forma_oferta ? `, ${c.forma_oferta}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Secao>
          {d.campos.map((campo) => (
            <Secao key={campo.campo} titulo={campo.rotulo}>
              <p className="whitespace-pre-line text-sm" data-conteudo>
                {campo.texto}
              </p>
            </Secao>
          ))}
        </article>
      )}
    </ComCarga>
  );
}

/* ================================================================== ficha da revisão de PPC */

const DOMINIOS: Readonly<Record<string, string>> = {
  curriculo: "Currículo",
  identidade: "Identidade do curso",
  suporte: "Apoio ao estudante e infraestrutura",
  transversal: "Transversal",
};

export function FichaRevisao({ id, aoAbrirLink }: { readonly id: string; readonly aoAbrirLink: AoAbrirLink }) {
  const api = useApi();
  const lido = useCarga(`ficha:${id}`, () => api.chamar((c) => c.lerFicha({ ficha: id })));
  return (
    <ComCarga carga={lido} titulo="Não foi possível ler esta ficha">
      {({ dados: d }) => (
        <article aria-label="Ficha de análise" className="leitor-impressao space-y-4">
          <Cabecalho tipo="Ficha de análise de PPC" titulo={`${d.ficha.id}: ${d.ficha.titulo}`}>
            <p className="flex flex-wrap gap-1.5">
              {d.ficha.criticidade ? (
                <Badge variant="outline" size="lg">
                  {nomeCriticidade(d.ficha.criticidade)}
                </Badge>
              ) : null}
              {d.ficha.dominio ? (
                <Badge variant="outline" size="lg">
                  Tema: {DOMINIOS[d.ficha.dominio] ?? primeiraMaiuscula(d.ficha.dominio)}
                </Badge>
              ) : null}
            </p>
            <p className="text-muted-foreground text-xs">
              Critério usado pela revisão de PPC do app. Ajuda a revisar; não é norma.
            </p>
          </Cabecalho>
          {d.campos.map((campo) => (
            <Secao key={campo.campo} titulo={campo.rotulo}>
              <p className="whitespace-pre-line text-sm" data-conteudo>
                {campo.texto}
              </p>
            </Secao>
          ))}
          {d.referencias.length > 0 ? (
            <Secao titulo="Normas de referência">
              <ul className="space-y-1 text-sm">
                {d.referencias.map((r) => (
                  <li key={`${r.ref}${r.dispositivo ?? ""}`}>
                    <BotaoLink link={r.link} aoAbrirLink={aoAbrirLink} />
                  </li>
                ))}
              </ul>
            </Secao>
          ) : null}
        </article>
      )}
    </ComCarga>
  );
}
