/**
 * As telas próprias do leitor para os links que não são texto: a ficha do curso, o campus e o curso do CNCT. Valem no
 * painel ao lado da conversa e nas páginas do Explorar. Tudo vem da base pelo `GrupoLeitura`, sem IA:
 *
 * - **curso:** `fichaCurso` (dados institucionais, CNCT, PPC, fatos e o cruzamento com o SUAP, ofertas,
 *   adequação ao art. 71, normas que o PPC cita) e o índice do Explorar (página oficial, processos,
 *   itens do Consepe);
 * - **campus:** `lerCampus` (cursos) e o índice (site, calendário, horários de aula, Consepe);
 * - **cnct:** `lerCnct` (o curso no catálogo e os cursos do IFPR que o ofertam).
 *
 * Os valores do PPC nas divergências PPC × SUAP nem sempre foram revisados: a tela marca a divergência
 * "Extraído, conferir" quando o valor saiu do texto por regra e "Precisa de revisão" quando a curadoria
 * ainda não o conferiu (outro status que não `revisado`), com o trecho de origem.
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
import { BotaoCodigoSuap, BotaoLink, Cabecalho, ComCarga, Fatos, LinkExterno, Secao } from "./pecas.tsx";
import { dataCurta } from "../lib/formato.ts";
import { situacaoDaTransicao } from "./textos.ts";
import type { AoAbrirLink } from "../painel/abrirLink.ts";

/** Os fatos do PPC de cada aspecto do cruzamento com o SUAP. */
const FATOS_DO_ASPECTO: Readonly<Record<string, ReadonlyArray<string>>> = {
  ano: ["ano_documento"],
  carga_horaria: ["carga_horaria_total_h"],
  estagio: ["estagio_obrigatorio", "estagio_carga_h"],
};

/** Link para a seção do PPC que contém `linha`, ou para o início do PPC se a linha estiver antes das seções. */
function linkDaLinhaPpc(
  ppc: {
    readonly link: string;
    readonly secoes: ReadonlyArray<{ readonly id: string; readonly linha_inicio: number; readonly linha_fim: number }>;
  },
  linha: number,
): string {
  const secao = ppc.secoes.find((s) => s.linha_inicio <= linha && linha <= s.linha_fim);
  if (secao === undefined) return ppc.link;
  const fragmento = secao.id.split("#")[1];
  return fragmento ? `${ppc.link}#${fragmento}` : ppc.link;
}

function situacaoMatrizAlerta(situacao: string | null): boolean {
  return situacao === "Múltiplas — CH divergentes" || situacao === "Sem matriz ativa";
}

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
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-small">
              {item.tipo_demanda ? <Badge variant="outline">{item.tipo_demanda}</Badge> : null}
              {item.resultado ? <span>{item.resultado}</span> : null}
              <Link to="/explorar/reuniao" search={{ id: reuniao.id }} className="link-grifo">
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
  // PPCs anteriores do curso, que ficam na base substituídos pelo vigente: do mais novo ao mais antigo.
  const substituidos =
    indice.fase === "lido"
      ? indice.valor.ppcs
          .filter((p) => !p.vigente && p.chave.startsWith(`${id}/`))
          .sort((a, b) => b.versao.localeCompare(a.versao, "pt-BR", { numeric: true }))
      : [];
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
          <article aria-label="Curso" className="leitor-impressao space-y-6">
            <Cabecalho
              tipo="Curso"
              titulo={d.curso.nome}
              acoes={
                <>
                  {d.ppc ? (
                    <BotaoLink link={d.ppc.link} aoAbrirLink={aoAbrirLink}>
                      Abrir o PPC
                    </BotaoLink>
                  ) : null}
                  {doIndice?.pagina_oficial ? (
                    <LinkExterno href={doIndice.pagina_oficial}>Página do curso</LinkExterno>
                  ) : null}
                </>
              }
            >
              <Fatos>
                <BotaoLink link={d.campus.link} aoAbrirLink={aoAbrirLink}>
                  Campus {d.campus.nome}
                </BotaoLink>
                {[d.curso.nivel, d.curso.forma_oferta, d.curso.modalidade].filter(Boolean).map((p) => (
                  <span key={p}>{primeiraMaiuscula(p!)}</span>
                ))}
                {d.suap?.codigo ? <BotaoCodigoSuap codigo={d.suap.codigo} /> : null}
              </Fatos>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 empty:hidden">
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

            <Secao titulo="Cadastro no SUAP">
              {d.suap === null ? (
                <p className="text-muted-foreground text-sm">
                  Este curso não tem vínculo com o SUAP registrado na base.
                </p>
              ) : (
                <div className="space-y-3 rounded-xl border border-border bg-muted/50 p-3.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                      <div>
                        <dt className="text-muted-foreground text-micro">Código / ID</dt>
                        <dd className="flex items-center gap-1.5 font-medium">
                          {d.suap.codigo ? <span className="font-mono">{d.suap.codigo}</span> : <span>Sem código</span>}
                          <span className="text-muted-foreground text-micro">(#{d.suap.id})</span>
                        </dd>
                      </div>
                      {d.suap.vagas !== null ? (
                        <div>
                          <dt className="text-muted-foreground text-micro">Vagas no cadastro acadêmico</dt>
                          <dd className="font-medium">
                            {d.suap.vagas} vagas{" "}
                            <span className="font-normal text-muted-foreground text-micro">(SUAP)</span>
                          </dd>
                        </div>
                      ) : null}
                      {d.suap.situacao !== null ? (
                        <div>
                          <dt className="text-muted-foreground text-micro">Situação das matrizes</dt>
                          <dd className="mt-0.5">
                            <Badge variant={situacaoMatrizAlerta(d.suap.situacao) ? "warning" : "outline"}>
                              {d.suap.situacao}
                            </Badge>
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                    {d.suap.coletado_em !== null ? (
                      <p className="text-muted-foreground text-micro">
                        Retrato coletado em {dataCurta(d.suap.coletado_em.slice(0, 10))}
                      </p>
                    ) : null}
                  </div>
                  {d.suap.matrizes.length > 0 ? (
                    <div className="space-y-1.5">
                      <p className="text-muted-foreground text-micro">
                        {d.suap.matrizes.length === 1
                          ? "Matriz ativa (1)"
                          : `Matrizes ativas (${d.suap.matrizes.length})`}
                      </p>
                      <ul className="space-y-1.5">
                        {d.suap.matrizes.map((m) => (
                          <li
                            key={m.matriz_id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm"
                          >
                            <div className="min-w-0 space-y-0.5">
                              <p className="font-medium">
                                <span className="mr-1.5 font-mono text-muted-foreground text-small">
                                  #{m.matriz_id}
                                </span>
                                <span data-conteudo>{m.descricao}</span>
                              </p>
                              <p className="text-muted-foreground text-micro">
                                Carga horária exibida: <strong>{m.ch_exibida_h} h</strong> · Estágio exigido:{" "}
                                {m.estagio_exigido
                                  ? m.ch_estagio_h !== null
                                    ? `Sim (${m.ch_estagio_h} h)`
                                    : "Sim"
                                  : "Não"}
                              </p>
                            </div>
                            {m.url !== null ? <LinkExterno href={m.url}>Abrir no SUAP</LinkExterno> : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-small">Nenhuma matriz ativa registrada na base.</p>
                  )}
                </div>
              )}
            </Secao>

            <Secao titulo="PPC e cruzamento com o SUAP">
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
                  {substituidos.length > 0 ? (
                    <p className="text-muted-foreground text-sm">
                      {substituidos.length === 1
                        ? "Versão anterior, substituída: "
                        : "Versões anteriores, substituídas: "}
                      {substituidos.map((p, i) => (
                        <span key={p.chave}>
                          {i > 0 ? ", " : null}
                          <BotaoLink link={p.link} aoAbrirLink={aoAbrirLink}>
                            {p.ano !== null ? `de ${p.ano}` : p.versao}
                          </BotaoLink>
                        </span>
                      ))}
                      .
                    </p>
                  ) : null}
                  {d.fatos && d.fatos.cruzamento.length > 0 ? (
                    <>
                      {ressalvas.size > 0 ? (
                        <Alert variant="info">
                          <AlertDescription>
                            Há valores do PPC sem revisão da curadoria: os marcados “Extraído, conferir” foram tirados
                            do texto por regra, o ano marcado “Evidência conferida por regra” teve só o trecho conferido
                            automaticamente, e os marcados “Precisa de revisão” ainda não foram conferidos. Confira o
                            trecho no PPC antes de afirmar uma divergência.
                          </AlertDescription>
                        </Alert>
                      ) : null}
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <caption className="sr-only">Comparação entre o PPC e o SUAP</caption>
                          <thead className="text-muted-foreground text-small">
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
                              const fatoOrigem = d.fatos?.fatos.find((f) =>
                                (FATOS_DO_ASPECTO[c.aspecto] ?? []).includes(f.fato),
                              );
                              return (
                                <tr key={c.aspecto} className="border-border border-t align-top">
                                  <th scope="row" className="py-1.5 pr-2 font-medium">
                                    {nomeAspecto(c.aspecto)}
                                  </th>
                                  <td className="py-1.5 pr-2">
                                    <span className="block">{c.valor_ppc ?? "—"}</span>
                                    {fatoOrigem !== undefined && d.ppc !== null ? (
                                      <span className="block text-micro">
                                        <BotaoLink
                                          link={linkDaLinhaPpc(d.ppc, fatoOrigem.fonte.linha_inicio)}
                                          aoAbrirLink={aoAbrirLink}
                                        >
                                          Ver linha {fatoOrigem.fonte.linha_inicio} do PPC
                                        </BotaoLink>
                                      </span>
                                    ) : null}
                                  </td>
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
                                    <span className="block text-muted-foreground text-micro">{c.explicacao}</span>
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
                              {f.status_curadoria === "revisado" && f.revisor ? (
                                <span className="text-muted-foreground text-small">
                                  {" "}
                                  Revisado por {f.revisor}
                                  {f.revisado_em ? ` em ${dataBr(f.revisado_em)}` : ""}
                                </span>
                              ) : null}
                            </p>
                            <p className="font-serif text-muted-foreground text-small" data-conteudo>
                              “{f.trecho_fonte}”{" "}
                              {d.ppc !== null ? (
                                <BotaoLink link={linkDaLinhaPpc(d.ppc, f.fonte.linha_inicio)} aoAbrirLink={aoAbrirLink}>
                                  (linha {f.fonte.linha_inicio} do PPC)
                                </BotaoLink>
                              ) : (
                                `(linha ${f.fonte.linha_inicio} do PPC)`
                              )}
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
                        <p className="mt-1 text-muted-foreground text-small">
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
          <article aria-label="Campus" className="leitor-impressao space-y-6">
            <Cabecalho
              tipo="Campus"
              titulo={`Campus ${d.campus.nome}`}
              acoes={d.campus.site ? <LinkExterno href={d.campus.site}>Site do campus</LinkExterno> : null}
            >
              <Fatos>
                <span>{d.cursos.length === 1 ? "1 curso na base" : `${d.cursos.length} cursos na base`}</span>
              </Fatos>
            </Cabecalho>
            <Secao titulo="Calendário e horários">
              <ul className="space-y-1">
                {doIndice?.calendario_academico ? (
                  <li>
                    <LinkExterno href={doIndice.calendario_academico}>Calendário acadêmico</LinkExterno>
                  </li>
                ) : null}
                {doIndice?.horarios_url ? (
                  <li>
                    <LinkExterno href={doIndice.horarios_url}>Horários de aula</LinkExterno>
                    {doIndice.horarios_coletado_em ? (
                      <span className="text-muted-foreground text-micro">
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
        <article aria-label="Curso do catálogo" className="leitor-impressao space-y-6">
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
