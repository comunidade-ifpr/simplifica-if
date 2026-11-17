/**
 * O conteúdo do leitor `ifpr://` (M1.6), por tipo de link. Tudo vem do `GrupoLeitura` pelo RPC do
 * servidor local, direto da base, sem passar pela IA:
 *
 * - **norma** (com ou sem `#dispositivo`): `fichaNorma` (selo de vigência, relações navegáveis,
 *   sucessoras, regras de transição), `lerDocumento` (o texto inteiro, com o dispositivo destacado) e,
 *   com dispositivo, `lerDispositivos` (o texto com o caput, para "Copiar citação");
 * - **ppc** (com ou sem `#secao`): `lerPpc` (curso, campus e o índice das seções), `lerDocumento` e,
 *   com seção, `lerSecao` (para a citação);
 * - **curso, cnct, campus, ficha**: as telas próprias de `Fichas.tsx` (do Explorar); o texto do `lerLink`
 *   (o mesmo do `resources/read` do MCP) fica para um link de outro tipo.
 */
import type { LinkLido } from "@simplifica-if/contratos-app";
import { CheckIcon, ClipboardCopyIcon, ExternalLinkIcon, LocateFixedIcon } from "lucide-react";
import { useState } from "react";
import { useApi } from "../contexto.tsx";
import { abrirFora, Markdown } from "../components/Markdown.tsx";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { dispositivoPorExtenso, nomeCurtoLink } from "../tarefas/textos.ts";
import { useCarga } from "./carga.ts";
import { Documento } from "./Documento.tsx";
import { FichaCampus, FichaCnct, FichaCurso, FichaRevisao } from "./Fichas.tsx";
import { BotaoLink, ComCarga, Secao } from "./pecas.tsx";
import {
  citacaoDaNorma,
  citacaoDoDispositivo,
  citacaoDoPpc,
  dataCurta,
  datasDoCabecalho,
  nomeDaRelacao,
  type Relacao,
  selosDaNorma,
  situacaoDaTransicao,
} from "./textos.ts";

/** Um link `ifpr://` desmontado. */
export interface LinkDesmontado {
  readonly tipo: string;
  readonly caminho: string;
  readonly fragmento: string | null;
}

export function desmontarLink(link: string): LinkDesmontado | null {
  const m = /^ifpr:\/\/([a-z]+)\/([^#]+)(?:#(.+))?$/i.exec(link);
  return m ? { tipo: m[1]!.toLowerCase(), caminho: m[2]!, fragmento: m[3] ?? null } : null;
}

const TIPOS: Readonly<Record<LinkLido["tipo"], string>> = {
  norma: "Norma",
  dispositivo: "Dispositivo de norma",
  curso: "Curso",
  ppc: "PPC",
  secao: "Seção de PPC",
  cnct: "Catálogo Nacional de Cursos Técnicos",
  campus: "Campus",
  ficha: "Ficha de análise",
};

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
      <Button size="sm" variant="outline" disabled={texto === null} onClick={copiar} className="nao-imprimir">
        {estado === "copiada" ? <CheckIcon /> : <ClipboardCopyIcon />}
        {estado === "copiada" ? "Citação copiada" : "Copiar citação"}
      </Button>
      {estado === "falhou" ? (
        <span role="alert" className="text-destructive-foreground text-xs">
          Não foi possível copiar. Selecione o texto e copie com Ctrl+C.
        </span>
      ) : null}
    </div>
  );
}

/** A faixa do trecho citado: o que está destacado e "Ir ao trecho". */
function FaixaTrecho({ rotulo, alvo }: { readonly rotulo: string; readonly alvo: string }) {
  return (
    <div className="nao-imprimir flex flex-wrap items-center gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm">
      <span className="min-w-0 flex-1">
        Trecho citado: <strong>{rotulo}</strong>, destacado no texto.
      </span>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => document.getElementById(alvo)?.scrollIntoView({ block: "start", behavior: "smooth" })}
      >
        <LocateFixedIcon /> Ir ao trecho
      </Button>
    </div>
  );
}

const linkDaNorma = (id: string, dispositivo?: string | null) =>
  `ifpr://norma/${id}${dispositivo ? `#${dispositivo.replace(/^#/, "")}` : ""}`;

/* ================================================================== norma */

function Relacoes({
  saida,
  entrada,
  aoAbrirLink,
}: {
  readonly saida: ReadonlyArray<Relacao>;
  readonly entrada: ReadonlyArray<Relacao>;
  readonly aoAbrirLink: (link: string) => void;
}) {
  const itens = [
    ...saida.map((r) => ({ r, nome: nomeDaRelacao(r.tipo, "saida"), link: linkDaNorma(r.alvo, r.alvo_dispositivo) })),
    ...entrada.map((r) => ({ r, nome: nomeDaRelacao(r.tipo, "entrada"), link: linkDaNorma(r.origem, r.operador) })),
  ];
  if (itens.length === 0) return null;
  return (
    <Secao titulo="Relações com outras normas">
      <ul className="space-y-1 text-sm">
        {itens.map(({ r, nome, link }) => (
          <li key={`${nome}:${link}:${r.alcance ?? ""}`}>
            <span className="text-muted-foreground">{nome}: </span>
            <BotaoLink link={link} aoAbrirLink={aoAbrirLink} />
            {r.alcance ? <span className="text-muted-foreground"> ({r.alcance})</span> : null}
          </li>
        ))}
      </ul>
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
  readonly aoAbrirLink: (link: string) => void;
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

  return (
    <ComCarga carga={ficha} titulo="Não foi possível ler esta norma">
      {({ dados }) => {
        const { norma, relacoes, sucessoras, transicoes } = dados;
        const selos = selosDaNorma(dados);
        const lido = dispositivo.fase === "lido" ? dispositivo.valor.dados.dispositivos[0] : undefined;
        const citacao =
          fragmento === null
            ? citacaoDaNorma(norma)
            : lido === undefined
              ? null
              : citacaoDoDispositivo({ dispositivo: lido, norma, nomeCurto: nomeCurtoLink(link) });
        const naoAchado =
          fragmento !== null &&
          ((documento.fase === "lido" && !documento.valor.dados.ancoras.some((a) => a.id === fragmento)) ||
            (dispositivo.fase === "lido" && lido === undefined));
        return (
          <article aria-label="Norma" className="leitor-impressao space-y-4">
            <header className="space-y-2">
              <p className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">Norma</p>
              <h2 className="font-semibold text-lg leading-snug">{norma.titulo}</h2>
              {norma.ementa ? <p className="text-muted-foreground text-sm">{norma.ementa}</p> : null}
              <div role="group" className="flex flex-wrap gap-1.5" aria-label="Situação">
                {selos.map((selo) => (
                  <Badge key={selo.rotulo} variant={selo.variante} size="lg" title={selo.detalhe}>
                    {selo.rotulo}
                  </Badge>
                ))}
              </div>
              <ul className="space-y-0.5 text-muted-foreground text-xs">
                {selos.map((selo) => (
                  <li key={selo.rotulo}>{selo.detalhe}</li>
                ))}
              </ul>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                {datasDoCabecalho(norma, documento.fase === "lido" ? documento.valor.dados.datas : null).map((d) => (
                  <span key={d}>{d}</span>
                ))}
                {norma.fonte_oficial ? (
                  <a
                    href={norma.fonte_oficial}
                    rel="noopener noreferrer"
                    target="_blank"
                    className="nao-imprimir inline-flex items-center gap-1 font-semibold text-primary underline underline-offset-2"
                    onClick={(evento) => {
                      evento.preventDefault();
                      abrirFora(norma.fonte_oficial!);
                    }}
                  >
                    Ver na fonte oficial <ExternalLinkIcon aria-hidden className="size-3.5" />
                  </a>
                ) : null}
              </p>
              <BotaoCopiar texto={citacao} />
            </header>

            {transicoes.length > 0 ? (
              <Secao titulo="Regras de transição">
                <ul className="space-y-2 text-sm">
                  {transicoes.map((t) => (
                    <li key={t.id} className="rounded-md border border-border p-2">
                      <p>{t.regra}</p>
                      <p className="mt-1 text-muted-foreground text-xs">
                        Para: {t.aplica_a.replace(/\.$/, "")}. Situação: {situacaoDaTransicao(t.situacao_na_data)}
                        {t.inicio_em ? `; começa em ${dataCurta(t.inicio_em)}` : "; início a confirmar"}
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
              <Secao titulo="Texto da norma">
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
              </Secao>
            ) : (
              <p className="text-muted-foreground text-sm">
                O texto desta norma não está na base: ela guarda só a referência. Consulte a fonte oficial.
              </p>
            )}
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
  readonly aoAbrirLink: (link: string) => void;
}) {
  const api = useApi();
  const linkPpc = `ifpr://ppc/${chave}`;
  const indice = useCarga(`ppc:${chave}`, () => api.chamar((c) => c.lerPpc({ ppc: chave })));
  const documento = useCarga(`documento:${linkPpc}`, () => api.chamar((c) => c.lerDocumento({ link: linkPpc })));
  const secao = useCarga(fragmento === null ? null : `secao:${chave}#${fragmento}`, () =>
    api.chamar((c) => c.lerSecao({ id: `${chave}#${fragmento}` })),
  );

  return (
    <ComCarga carga={indice} titulo="Não foi possível ler este PPC">
      {({ dados }) => {
        const { ppc, secoes } = dados;
        const atual = fragmento === null ? undefined : secoes.find((s) => s.id === `${chave}#${fragmento}`);
        const citacao =
          fragmento === null
            ? citacaoDoPpc({ curso: ppc.nome, campus: ppc.campus })
            : secao.fase === "lido"
              ? citacaoDoPpc({ curso: ppc.nome, campus: ppc.campus, secao: secao.valor.dados.secao })
              : null;
        return (
          <article aria-label="PPC" className="leitor-impressao space-y-4">
            <header className="space-y-2">
              <p className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">
                Projeto Pedagógico de Curso
              </p>
              <h2 className="font-semibold text-lg leading-snug">{ppc.nome}</h2>
              <p className="text-muted-foreground text-sm">
                Campus {ppc.campus} · {ppc.nivel} · {ppc.forma}
              </p>
              <p className="flex flex-wrap items-center gap-2 text-sm">
                {ppc.curso !== null ? (
                  <BotaoLink link={ppc.curso} aoAbrirLink={aoAbrirLink}>
                    Ficha do curso
                  </BotaoLink>
                ) : null}
              </p>
              <BotaoCopiar texto={citacao} />
            </header>

            {secoes.length > 0 ? (
              <details className="nao-imprimir rounded-md border border-border p-2 text-sm">
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
            ) : null}

            {fragmento !== null && atual === undefined ? (
              <Alert variant="warning">
                <AlertTitle>Seção não encontrada</AlertTitle>
                <AlertDescription>Esta seção não está no índice do PPC. Abaixo, o documento inteiro.</AlertDescription>
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
          </article>
        );
      }}
    </ComCarga>
  );
}

/* ================================================================== curso, CNCT, campus, ficha */

function LeitorLink({ link, aoAbrirLink }: { readonly link: string; readonly aoAbrirLink: (link: string) => void }) {
  const api = useApi();
  const lido = useCarga(`link:${link}`, () => api.chamar((c) => c.lerLink({ link })));
  return (
    <ComCarga carga={lido} titulo="Não foi possível ler este link">
      {(valor) => (
        <article aria-label={TIPOS[valor.tipo]} className="leitor-impressao">
          <p className="mb-2 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
            {TIPOS[valor.tipo]}
          </p>
          <Markdown texto={valor.texto} aoAbrirLink={aoAbrirLink} />
        </article>
      )}
    </ComCarga>
  );
}

/** O conteúdo de um link no leitor, pelo tipo. */
export function ConteudoLink({
  link,
  aoAbrirLink,
}: {
  readonly link: string;
  readonly aoAbrirLink: (link: string) => void;
}) {
  const partes = desmontarLink(link);
  if (partes?.tipo === "norma") {
    return <LeitorNorma id={partes.caminho} fragmento={partes.fragmento} link={link} aoAbrirLink={aoAbrirLink} />;
  }
  if (partes?.tipo === "ppc") {
    return <LeitorPpc chave={partes.caminho} fragmento={partes.fragmento} aoAbrirLink={aoAbrirLink} />;
  }
  if (partes?.tipo === "curso") return <FichaCurso id={partes.caminho} aoAbrirLink={aoAbrirLink} />;
  if (partes?.tipo === "campus") return <FichaCampus id={partes.caminho} aoAbrirLink={aoAbrirLink} />;
  if (partes?.tipo === "cnct") return <FichaCnct slug={partes.caminho} aoAbrirLink={aoAbrirLink} />;
  if (partes?.tipo === "ficha") return <FichaRevisao id={partes.caminho} aoAbrirLink={aoAbrirLink} />;
  return <LeitorLink link={link} aoAbrirLink={aoAbrirLink} />;
}
