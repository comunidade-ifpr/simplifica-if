/**
 * O conteúdo do leitor `ifpr://` (M1.6), por tipo de link. Tudo vem do `GrupoLeitura` pelo RPC do
 * servidor local, direto da base, sem passar pela IA:
 *
 * - **norma** (com ou sem `#dispositivo`): `fichaNorma` (selo de vigência, relações navegáveis,
 *   sucessoras, regras de transição, na coluna lateral quando há largura), `lerDocumento` (o texto inteiro, com o
 *   dispositivo destacado, e o sumário, que vira o índice "Neste documento" no alto da lateral) e,
 *   com dispositivo, `lerDispositivos` (o texto com o caput, para "Copiar citação"); a norma com tabela
 *   de correspondência tem "Comparar com a sucessora" (ou "com a anterior"), pelo índice do Explorar;
 * - **ppc** (`campus/curso/versao`, ou `campus/curso` para o vigente; com ou sem `#secao`): `lerPpc`
 *   (curso, campus, o ID da versão e o índice das seções), `lerDocumento` e, com seção, `lerSecao`
 *   (para a citação); o índice do Explorar diz se a versão foi substituída;
 * - **curso, cnct, campus**: as telas próprias de `Fichas.tsx` (do Explorar);
 * - o tipo que um módulo registrou (`linksDeModulo.ts`): o leitor do módulo.
 */
import type { Ancora } from "@simplifica-if/contratos-app";
import { Link } from "@tanstack/react-router";
import { CheckIcon, ClipboardCopyIcon, Columns2Icon, InfoIcon } from "lucide-react";
import { useState } from "react";
import { useApi } from "../contexto.tsx";
import { Markdown } from "../components/Markdown.tsx";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { nomeAspecto, nomeResultado, primeiraMaiuscula } from "../explorar/colecoes.ts";
import { comparacoesDe } from "../explorar/comparar.ts";
import { useIndiceExplorar } from "../explorar/indice.ts";
import { corVigencia, SinalVigencia } from "../explorar/Vigencia.tsx";
import { dataCurta } from "../lib/formato.ts";
import { cn } from "../lib/utils.ts";
import { dispositivoPorExtenso, nomeCurtoLink } from "../tarefas/textos.ts";
import { useCarga } from "./carga.ts";
import { Documento } from "./Documento.tsx";
import { FichaCampus, FichaCnct, FichaCurso } from "./Fichas.tsx";
import { linkDeModulo } from "./linksDeModulo.ts";
import {
  BotaoCodigoSuap,
  BotaoLink,
  Cabecalho,
  ComCarga,
  Corpo,
  FaixaTrecho,
  Fatos,
  LinkExterno,
  Secao,
} from "./pecas.tsx";
import { Sumario } from "./Sumario.tsx";
import { useInstanciaLeitor } from "./instancia.ts";
import { artigosDosDispositivos, conteudoDoIndice, numeroDoArtigo } from "./sumario.ts";
import {
  citacaoDoDispositivo,
  citacaoDoPpc,
  datasDoCabecalho,
  type FichaNorma,
  nomeDaRelacao,
  referenciaDaNorma,
  type Relacao,
  type Selo,
  selosDaNorma,
  situacaoDaTransicao,
} from "./textos.ts";
import { type AoAbrirLink, ondeDoClique } from "../painel/abrirLink.ts";

/** Um link `ifpr://` desmontado. */
export interface LinkDesmontado {
  readonly tipo: string;
  readonly caminho: string;
  readonly fragmento: string | null;
}

export function desmontarLink(link: string): LinkDesmontado | null {
  const m = /^ifpr:\/\/([a-z][a-z-]*)\/([^#]+)(?:#(.+))?$/i.exec(link);
  return m ? { tipo: m[1]!.toLowerCase(), caminho: m[2]!, fragmento: m[3] ?? null } : null;
}

/* ================================================================== peças */

/** "Copiar citação": o texto pronto, ou `null` enquanto ele não chega. */
function BotaoCopiar({ texto }: { readonly texto: string | null }) {
  const [estado, setEstado] = useState<"parado" | "copiada" | "falhou">("parado");
  const copiar = () => {
    if (texto === null) return;
    navigator.clipboard.writeText(texto).then(
      () => {
        setEstado("copiada");
        window.setTimeout(() => setEstado("parado"), 2500);
      },
      () => setEstado("falhou"),
    );
  };
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" disabled={texto === null} onClick={copiar}>
        {estado === "copiada" ? <CheckIcon /> : <ClipboardCopyIcon />}
        {estado === "copiada" ? "Citação copiada" : "Copiar citação"}
      </Button>
      {estado === "falhou" ? (
        <span role="alert" className="text-destructive-foreground text-micro">
          Não foi possível copiar. Selecione o texto e copie com Ctrl+C.
        </span>
      ) : null}
    </div>
  );
}

const linkDaNorma = (id: string, dispositivo?: string | null) =>
  `ifpr://norma/${id}${dispositivo ? `#${dispositivo.replace(/^#/, "")}` : ""}`;

/* ================================================================== norma */

const COR_SELO: Readonly<Record<Selo["variante"], string>> = {
  success: "text-success-foreground",
  info: "text-info-foreground",
  warning: "text-warning-foreground",
  error: "text-destructive-foreground",
};

/**
 * A situação da norma na data da base: em cada linha, o sinal com o nome do estado e, ao lado, o que ele
 * quer dizer (desde quando, o que falta confirmar). É o que a pessoa precisa saber antes de citar.
 */
function Situacao({ selos }: { readonly selos: ReadonlyArray<Selo> }) {
  return (
    <div role="group" aria-label="Situação" className="divide-y divide-border rounded-xl bg-muted px-4">
      {selos.map((selo) => (
        <div key={selo.rotulo} className="grid gap-x-6 gap-y-0.5 py-3 @3xl:grid-cols-[14rem_minmax(0,1fr)]">
          <p
            className={cn(
              "flex items-center gap-2 self-start font-semibold",
              selo.sinal === null ? COR_SELO[selo.variante] : corVigencia(selo.sinal),
            )}
          >
            {selo.sinal === null ? (
              <InfoIcon aria-hidden className="size-3.5 shrink-0" />
            ) : (
              <SinalVigencia vigencia={selo.sinal} className="size-3.5" />
            )}
            {selo.rotulo}
          </p>
          <p className="max-w-[76ch] in-[.painel-leitura]:max-w-none text-muted-foreground text-small">
            {selo.detalhe}
          </p>
        </div>
      ))}
    </div>
  );
}

/** Os metadados editoriais da norma (do front matter), na ordem em que aparecem, com o que cada um é. */
const EDITORIAIS = [
  {
    campo: "pontos_chave",
    titulo: "Pontos-chave",
    nota: "Resumo da curadoria, com o dispositivo de cada ponto. Não faz parte do texto oficial: para citar, use o dispositivo.",
  },
  {
    campo: "notas_da_fonte",
    titulo: "Notas da fonte",
    nota: "Como este texto foi obtido e consolidado.",
  },
] as const;

/**
 * O que a curadoria escreveu sobre a norma, fora do texto dela: cada campo num bloco recolhido, com o
 * nome da função e o aviso de que não é o texto oficial. O corpo da página fica só com a norma.
 */
function MetadadosEditoriais({
  norma,
  aoAbrirLink,
}: {
  readonly norma: Readonly<Record<(typeof EDITORIAIS)[number]["campo"], ReadonlyArray<string>>>;
  readonly aoAbrirLink: AoAbrirLink;
}) {
  const blocos = EDITORIAIS.filter(({ campo }) => norma[campo].length > 0);
  if (blocos.length === 0) return null;
  return (
    <div className="divide-y divide-border rounded-xl border border-border">
      {blocos.map(({ campo, titulo, nota }) => (
        <details key={campo} className="group px-4 py-2.5">
          <summary className="cursor-pointer font-semibold text-small">
            {titulo} <span className="font-normal text-muted-foreground">({norma[campo].length})</span>
          </summary>
          <p className="mt-1.5 text-muted-foreground text-micro">{nota}</p>
          <div className="mt-1.5 max-w-[76ch] in-[.painel-leitura]:max-w-none text-sm" data-conteudo>
            <Markdown texto={norma[campo].map((item) => `- ${item}`).join("\n")} aoAbrirLink={aoAbrirLink} />
          </div>
        </details>
      ))}
    </div>
  );
}

/**
 * Os atos que alteraram a norma, pelas notas de redação do texto oficial ("Redação dada pela Lei nº ..."):
 * um bloco recolhido, com os artigos atingidos por ato, que levam ao artigo no texto. Não são as relações
 * registradas (essas ficam na lateral): o ato quase nunca tem texto na base.
 */
function AlteracoesAnotadas({
  alteracoes,
  ancoras,
  aoAbrirLink,
}: {
  readonly alteracoes: FichaNorma["alteracoes_anotadas"];
  readonly ancoras: ReadonlyArray<Ancora> | null;
  readonly aoAbrirLink: AoAbrirLink;
}) {
  const { irPara } = useInstanciaLeitor();
  if (alteracoes.length === 0) return null;
  return (
    <details className="rounded-xl border border-border px-4 py-2.5">
      <summary className="cursor-pointer font-semibold text-small">
        Alterada por <span className="font-normal text-muted-foreground">({alteracoes.length})</span>
      </summary>
      <p className="mt-1.5 text-muted-foreground text-micro">
        Atos que mudaram dispositivos desta norma, segundo as notas do texto oficial, do mais recente ao mais antigo. As
        mudanças já estão no texto abaixo.
      </p>
      <ul className="mt-1.5 max-w-[76ch] in-[.painel-leitura]:max-w-none space-y-1.5 text-sm">
        {alteracoes.map((a) => {
          const artigos = ancoras === null ? [] : artigosDosDispositivos(a.dispositivos, ancoras);
          const n = a.dispositivos.length;
          return (
            <li key={a.id}>
              {a.link !== null ? <BotaoLink link={a.link} aoAbrirLink={aoAbrirLink} /> : <span>{a.ato}</span>}
              <span className="text-muted-foreground text-small">
                {" "}
                · {n} {n === 1 ? "dispositivo" : "dispositivos"}
              </span>
              {artigos.length > 0 ? (
                <span className="text-small">
                  {" "}
                  ·{" "}
                  {artigos.map((artigo, i) => (
                    <span key={artigo.id}>
                      {i > 0 ? ", " : null}
                      <button
                        type="button"
                        className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                        aria-label={`Ir ao artigo ${numeroDoArtigo(artigo.id)}`}
                        onClick={() => irPara({ id: artigo.id, linha: artigo.linha_inicio })}
                      >
                        art. {numeroDoArtigo(artigo.id)}
                      </button>
                    </span>
                  ))}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function Relacoes({
  saida,
  entrada,
  aoAbrirLink,
}: {
  readonly saida: ReadonlyArray<Relacao>;
  readonly entrada: ReadonlyArray<Relacao>;
  readonly aoAbrirLink: AoAbrirLink;
}) {
  const itens = [
    ...saida.map((r) => ({ r, nome: nomeDaRelacao(r.tipo, "saida"), link: linkDaNorma(r.alvo, r.alvo_dispositivo) })),
    ...entrada.map((r) => ({ r, nome: nomeDaRelacao(r.tipo, "entrada"), link: linkDaNorma(r.origem, r.operador) })),
  ];
  if (itens.length === 0) return null;
  const grupos = new Map<string, Array<(typeof itens)[number]>>();
  for (const item of itens) grupos.set(item.nome, [...(grupos.get(item.nome) ?? []), item]);
  return (
    <Secao titulo="Relações com outras normas">
      <dl className="space-y-3 text-sm">
        {[...grupos].map(([nome, doGrupo]) => (
          <div key={nome}>
            <dt className="text-muted-foreground text-small">{nome}</dt>
            {doGrupo.map(({ r, link }) => (
              <dd key={`${link}:${r.alcance ?? ""}`} className="mt-1">
                <BotaoLink link={link} aoAbrirLink={aoAbrirLink} />
                {r.alcance ? <span className="text-muted-foreground text-small"> ({r.alcance})</span> : null}
              </dd>
            ))}
          </div>
        ))}
      </dl>
    </Secao>
  );
}

function LeitorNorma({
  id,
  fragmento,
  link,
  aoAbrirLink,
}: {
  readonly id: string;
  readonly fragmento: string | null;
  readonly link: string;
  readonly aoAbrirLink: AoAbrirLink;
}) {
  const api = useApi();
  const ficha = useCarga(`ficha:${id}`, () => api.chamar((c) => c.fichaNorma({ id })));
  const temTexto = ficha.fase === "lido" && ficha.valor.dados.norma.situacao === "base";
  const documento = useCarga(temTexto ? `documento:${linkDaNorma(id)}` : null, () =>
    api.chamar((c) => c.lerDocumento({ link: linkDaNorma(id) })),
  );
  const dispositivo = useCarga(fragmento === null ? null : `dispositivo:${id}#${fragmento}`, () =>
    api.chamar((c) => c.lerDispositivos({ ids: [`${id}#${fragmento}`], filhos: true })),
  );
  // "Comparar com a sucessora" ou "com a anterior": só a norma que tem tabela de correspondência. Também
  // no painel, o link troca a tela (o Comparar é tela cheia, como o ⤢): duas normas lado a lado não cabem nele.
  const indice = useIndiceExplorar();
  const comparacoes = indice.fase === "lido" ? comparacoesDe(id, indice.valor.normas) : [];

  return (
    <ComCarga carga={ficha} titulo="Não foi possível ler esta norma">
      {({ dados }) => {
        const { norma, relacoes, sucessoras, transicoes, alteracoes_anotadas: anotadas } = dados;
        const fonteOficial = norma.fonte_url;
        const selos = selosDaNorma(dados);
        const lido = dispositivo.fase === "lido" ? dispositivo.valor.dados.dispositivos[0] : undefined;
        const citacao =
          fragmento === null
            ? referenciaDaNorma(norma)
            : lido === undefined
              ? null
              : citacaoDoDispositivo({ dispositivo: lido, norma, nomeCurto: nomeCurtoLink(link) });
        const naoAchado =
          fragmento !== null &&
          ((documento.fase === "lido" && !documento.valor.dados.ancoras.some((a) => a.id === fragmento)) ||
            (dispositivo.fase === "lido" && lido === undefined));
        const texto = documento.fase === "lido" ? documento.valor.dados : null;
        const temIndice = texto !== null && !conteudoDoIndice(texto).vazio;
        const temLateral =
          temIndice ||
          transicoes.length > 0 ||
          sucessoras.length > 0 ||
          relacoes.saida.length > 0 ||
          relacoes.entrada.length > 0;
        return (
          <article aria-label="Norma" className="space-y-8">
            <Cabecalho
              tipo={
                [norma.tipo_documento, norma.orgao]
                  .filter(Boolean)
                  .map((p) => primeiraMaiuscula(p!))
                  .join(", ") || "Norma"
              }
              titulo={norma.titulo}
              resumo={
                norma.ementa ? (
                  <p className="max-w-[68ch] in-[.painel-leitura]:max-w-none text-quote" data-conteudo>
                    {norma.ementa}
                  </p>
                ) : null
              }
              acoes={
                <>
                  <BotaoCopiar texto={citacao} />
                  {fonteOficial !== null ? <LinkExterno href={fonteOficial}>Ver na fonte oficial</LinkExterno> : null}
                  {comparacoes.map((c) => (
                    <Link
                      key={`${c.a}:${c.b}`}
                      to="/explorar/comparar"
                      search={{ a: c.a, b: c.b }}
                      className="inline-flex items-center gap-1 link-grifo text-small"
                    >
                      <Columns2Icon aria-hidden className="size-3.5" /> {c.titulo}
                    </Link>
                  ))}
                </>
              }
            >
              <Situacao selos={selos} />
              <Fatos>
                {datasDoCabecalho(norma).map((d) => (
                  <span key={d}>{d}</span>
                ))}
                {norma.fonte_referencia !== null ? <span>Fonte: {norma.fonte_referencia}</span> : null}
              </Fatos>
              <MetadadosEditoriais norma={norma} aoAbrirLink={aoAbrirLink} />
              <AlteracoesAnotadas
                alteracoes={anotadas}
                ancoras={documento.fase === "lido" ? documento.valor.dados.ancoras : null}
                aoAbrirLink={aoAbrirLink}
              />
            </Cabecalho>

            <Corpo
              lateral={
                temLateral ? (
                  <>
                    {/* O índice primeiro: é ele que acompanha a leitura; as relações se leem uma vez. */}
                    {texto !== null && temIndice ? (
                      <>
                        <Sumario documento={texto} modo="lateral" />
                        <Sumario documento={texto} modo="recolhido" />
                      </>
                    ) : null}

                    {sucessoras.length > 0 ? (
                      <Secao titulo="Normas que a substituem">
                        <p className="flex flex-wrap gap-1.5 text-sm">
                          {sucessoras.map((s) => (
                            <BotaoLink key={s} link={linkDaNorma(s)} aoAbrirLink={aoAbrirLink} />
                          ))}
                        </p>
                      </Secao>
                    ) : null}

                    <Relacoes saida={relacoes.saida} entrada={relacoes.entrada} aoAbrirLink={aoAbrirLink} />

                    {transicoes.length > 0 ? (
                      <Secao titulo="Regras de transição">
                        <ul className="divide-y divide-border text-sm">
                          {transicoes.map((t) => (
                            <li key={t.id} className="space-y-1 py-2.5 first:pt-0">
                              <p>{t.regra}</p>
                              <p className="text-muted-foreground text-small">
                                Para: {t.aplica_a.replace(/\.$/, "")}. Situação:{" "}
                                {situacaoDaTransicao(t.situacao_na_data)}
                                {t.inicio_em
                                  ? `; começa em ${dataCurta(t.inicio_em)}`
                                  : "; começa com a publicação da norma, que a aguarda"}
                                {t.fim_em ? `; termina em ${dataCurta(t.fim_em)}` : ""}.{" "}
                                <BotaoLink link={t.link} aoAbrirLink={aoAbrirLink}>
                                  Ver o dispositivo
                                </BotaoLink>
                              </p>
                            </li>
                          ))}
                        </ul>
                      </Secao>
                    ) : null}
                  </>
                ) : null
              }
            >
              {naoAchado ? (
                <Alert variant="warning">
                  <AlertTitle>Trecho não encontrado</AlertTitle>
                  <AlertDescription>
                    O {dispositivoPorExtenso(fragmento)} não está no texto desta norma na base. Abaixo, a norma inteira.
                  </AlertDescription>
                </Alert>
              ) : fragmento !== null ? (
                <FaixaTrecho rotulo={dispositivoPorExtenso(fragmento)} alvo={fragmento} />
              ) : null}

              {temTexto ? (
                // sem título por cima: o arquivo já abre com "Resumo" e "Texto da norma"
                <ComCarga carga={documento} titulo="Não foi possível ler o texto da norma">
                  {({ dados: doc }) => (
                    <Documento
                      documento={doc}
                      alvo={naoAchado ? null : fragmento}
                      aoAbrirLink={aoAbrirLink}
                      rotulo="Texto da norma"
                    />
                  )}
                </ComCarga>
              ) : (
                <p className="text-muted-foreground text-sm">
                  O texto desta norma não está na base: ela guarda só a referência. Consulte a fonte oficial.
                </p>
              )}
            </Corpo>
          </article>
        );
      }}
    </ComCarga>
  );
}

/* ================================================================== PPC */

function LeitorPpc({
  chave,
  fragmento,
  aoAbrirLink,
}: {
  readonly chave: string;
  readonly fragmento: string | null;
  readonly aoAbrirLink: AoAbrirLink;
}) {
  const api = useApi();
  const linkPpc = `ifpr://ppc/${chave}`;
  const indice = useCarga(`ppc:${chave}`, () => api.chamar((c) => c.lerPpc({ ppc: chave })));
  const documento = useCarga(`documento:${linkPpc}`, () => api.chamar((c) => c.lerDocumento({ link: linkPpc })));
  // `campus/curso` (sem versão) é o PPC vigente: as seções têm o ID da versão, que vem de `lerPpc`.
  const versao = indice.fase === "lido" ? indice.valor.dados.ppc.id.replace(/^ppc:/, "") : null;
  const secao = useCarga(fragmento === null || versao === null ? null : `secao:${versao}#${fragmento}`, () =>
    api.chamar((c) => c.lerSecao({ id: `${versao}#${fragmento}` })),
  );
  const explorar = useIndiceExplorar();
  const doIndice =
    explorar.fase === "lido" && versao !== null ? explorar.valor.ppcs.find((p) => p.chave === versao) : undefined;
  const pdfOriginal = doIndice?.fonte_url ?? null;

  return (
    <ComCarga carga={indice} titulo="Não foi possível ler este PPC">
      {({ dados }) => {
        const { ppc, secoes, fatos } = dados;
        const atual = fragmento === null ? undefined : secoes.find((s) => s.id === `${versao}#${fragmento}`);
        const citacao =
          fragmento === null
            ? citacaoDoPpc({ curso: ppc.nome, campus: ppc.campus })
            : secao.fase === "lido"
              ? citacaoDoPpc({ curso: ppc.nome, campus: ppc.campus, secao: secao.valor.dados.secao })
              : null;
        const suap = fatos.suap;
        const divergenciasSuap = fatos.cruzamento.filter((c) => nomeResultado(c.resultado).alerta);
        const matrizesComUrl = (suap?.matrizes ?? []).filter((m) => m.url !== null);
        const temLateral = secoes.length > 0 || suap !== null;
        return (
          <article aria-label="PPC" className="space-y-8">
            <Cabecalho
              tipo="Projeto Pedagógico de Curso"
              titulo={ppc.nome}
              acoes={
                <>
                  <BotaoCopiar texto={citacao} />
                  {ppc.curso !== null ? (
                    <BotaoLink link={ppc.curso} aoAbrirLink={aoAbrirLink}>
                      Ficha do curso
                    </BotaoLink>
                  ) : null}
                  {pdfOriginal !== null ? <LinkExterno href={pdfOriginal}>Ver o PDF original</LinkExterno> : null}
                </>
              }
            >
              <Fatos>
                <span>Campus {ppc.campus}</span>
                {[ppc.nivel, ppc.forma].filter(Boolean).map((p) => (
                  <span key={p}>{primeiraMaiuscula(p!)}</span>
                ))}
                {doIndice?.ano != null ? <span>Documento de {doIndice.ano}</span> : null}
              </Fatos>
              {divergenciasSuap.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="warning" size="lg">
                    {divergenciasSuap.length === 1
                      ? "1 divergência com o SUAP"
                      : `${divergenciasSuap.length} divergências com o SUAP`}
                  </Badge>
                </div>
              ) : null}
              {doIndice !== undefined && !doIndice.vigente ? (
                <Alert variant="warning">
                  <AlertTitle>PPC substituído</AlertTitle>
                  <AlertDescription>
                    O curso tem um PPC mais novo
                    {doIndice.substituido_por !== null ? (
                      <>
                        {": "}
                        <BotaoLink link={doIndice.substituido_por} aoAbrirLink={aoAbrirLink} />
                      </>
                    ) : null}
                    . Esta versão fica na base para consulta.
                  </AlertDescription>
                </Alert>
              ) : null}
            </Cabecalho>

            <Corpo
              lateral={
                temLateral ? (
                  <>
                    {suap !== null ? (
                      <section
                        aria-label="Vínculo com o SUAP"
                        className="space-y-2.5 rounded-xl border border-border bg-muted/50 p-3 text-sm"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="font-semibold text-foreground text-small">Vínculo SUAP</h3>
                          {suap.codigo !== null ? <BotaoCodigoSuap codigo={suap.codigo} prefixo={false} /> : null}
                        </div>
                        {divergenciasSuap.length > 0 ? (
                          <ul className="space-y-1.5 text-small">
                            {divergenciasSuap.map((c) => (
                              <li key={c.aspecto} className="border-warning border-l-2 pl-2">
                                <span className="font-medium">{nomeAspecto(c.aspecto)}:</span> {c.valor_ppc ?? "—"}{" "}
                                (PPC) × {c.valor_suap ?? "—"} (SUAP)
                              </li>
                            ))}
                          </ul>
                        ) : suap.matrizes.length > 0 ? (
                          <p className="text-muted-foreground text-small">Sem divergências com o SUAP.</p>
                        ) : (
                          <p className="text-muted-foreground text-small">Sem matriz ativa registrada no SUAP.</p>
                        )}
                        {suap.coletado_em !== null || suap.matrizes.length > 0 ? (
                          <p className="text-muted-foreground text-micro">
                            {[
                              suap.coletado_em !== null
                                ? `Coletado em ${dataCurta(suap.coletado_em.slice(0, 10))}`
                                : null,
                              suap.matrizes.length > 0
                                ? suap.matrizes.length === 1
                                  ? "1 matriz ativa"
                                  : `${suap.matrizes.length} matrizes ativas`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        ) : null}
                        <div className="flex flex-col items-start gap-1.5 pt-0.5 text-small">
                          {ppc.curso !== null ? (
                            <BotaoLink link={ppc.curso} aoAbrirLink={aoAbrirLink}>
                              Ver comparação na ficha do curso
                            </BotaoLink>
                          ) : null}
                          {matrizesComUrl.slice(0, 2).map((m) => (
                            <LinkExterno key={m.matriz_id} href={m.url!}>
                              Abrir matriz #{m.matriz_id} no SUAP
                            </LinkExterno>
                          ))}
                          {matrizesComUrl.length > 2 ? (
                            <details className="w-full text-micro">
                              <summary className="cursor-pointer text-muted-foreground">
                                Mais {matrizesComUrl.length - 2} matrizes no SUAP
                              </summary>
                              <ul className="mt-1 space-y-1">
                                {matrizesComUrl.slice(2).map((m) => (
                                  <li key={m.matriz_id}>
                                    <LinkExterno href={m.url!}>Abrir matriz #{m.matriz_id} no SUAP</LinkExterno>
                                  </li>
                                ))}
                              </ul>
                            </details>
                          ) : null}
                        </div>
                      </section>
                    ) : null}
                    {secoes.length > 0 ? (
                      <>
                        {/* Com largura, o índice fica aberto ao lado do texto; no painel estreito, recolhido. */}
                        <nav aria-label="Seções do PPC" className="hidden space-y-1.5 @4xl:block">
                          <h3 className="font-semibold text-muted-foreground text-small">Seções ({secoes.length})</h3>
                          <ul>
                            {secoes.map((s) => (
                              <li key={s.id}>
                                <button
                                  type="button"
                                  data-link={s.link}
                                  aria-current={s.id === atual?.id ? "location" : undefined}
                                  onClick={(evento) => aoAbrirLink(s.link, ondeDoClique(evento))}
                                  className="block w-full rounded-md px-2 py-1 text-left text-muted-foreground text-small hover:bg-muted hover:text-foreground aria-[current]:bg-accent aria-[current]:font-semibold aria-[current]:text-accent-foreground"
                                >
                                  {s.titulo}
                                </button>
                              </li>
                            ))}
                          </ul>
                        </nav>
                        <details className="rounded-md border border-border p-2 text-sm @4xl:hidden">
                          <summary className="cursor-pointer font-semibold">Seções do índice ({secoes.length})</summary>
                          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
                            {secoes.map((s) => (
                              <li key={s.id}>
                                <BotaoLink link={s.link} aoAbrirLink={aoAbrirLink}>
                                  {s.titulo}
                                </BotaoLink>
                              </li>
                            ))}
                          </ul>
                        </details>
                      </>
                    ) : null}
                  </>
                ) : null
              }
            >
              {fragmento !== null && atual === undefined ? (
                <Alert variant="warning">
                  <AlertTitle>Seção não encontrada</AlertTitle>
                  <AlertDescription>
                    Esta seção não está no índice do PPC. Abaixo, o documento inteiro.
                  </AlertDescription>
                </Alert>
              ) : atual !== undefined ? (
                <FaixaTrecho rotulo={atual.titulo} alvo={fragmento!} />
              ) : null}

              <Secao titulo="Texto do PPC">
                <ComCarga carga={documento} titulo="Não foi possível ler o texto do PPC">
                  {({ dados: doc }) => (
                    <Documento
                      documento={doc}
                      alvo={atual === undefined ? null : fragmento}
                      aoAbrirLink={aoAbrirLink}
                      rotulo="Texto do PPC"
                    />
                  )}
                </ComCarga>
              </Secao>
            </Corpo>
          </article>
        );
      }}
    </ComCarga>
  );
}

/* ================================================================== curso, CNCT, campus e os módulos */

/** O conteúdo de um link no leitor, pelo tipo. */
export function ConteudoLink({ link, aoAbrirLink }: { readonly link: string; readonly aoAbrirLink: AoAbrirLink }) {
  const partes = desmontarLink(link);
  if (partes?.tipo === "norma") {
    return <LeitorNorma id={partes.caminho} fragmento={partes.fragmento} link={link} aoAbrirLink={aoAbrirLink} />;
  }
  if (partes?.tipo === "ppc") {
    return <LeitorPpc chave={partes.caminho} fragmento={partes.fragmento} aoAbrirLink={aoAbrirLink} />;
  }
  const doModulo = partes === null ? undefined : linkDeModulo(partes.tipo);
  if (partes !== null && doModulo !== undefined) {
    return <doModulo.Leitor caminho={partes.caminho} fragmento={partes.fragmento} aoAbrirLink={aoAbrirLink} />;
  }
  if (partes?.tipo === "curso") return <FichaCurso id={partes.caminho} aoAbrirLink={aoAbrirLink} />;
  if (partes?.tipo === "campus") return <FichaCampus id={partes.caminho} aoAbrirLink={aoAbrirLink} />;
  if (partes?.tipo === "cnct") return <FichaCnct slug={partes.caminho} aoAbrirLink={aoAbrirLink} />;
  return (
    <Alert variant="error">
      <AlertTitle>Não foi possível ler este link</AlertTitle>
      <AlertDescription>O link não aponta para nada da base.</AlertDescription>
    </Alert>
  );
}
