/**
 * O formulário do perfil (M1.8), nas boas-vindas e em Configurações › Seu perfil: o campus (os campi
 * da base, de `sobreABase`), a função (`FUNCOES`, que se traduz no `publico` dos manifestos) e os
 * cursos do campus escolhido (de `listarCursos`). Nada daqui vai à IA: o perfil fica no servidor local.
 */
import {
  DESCRICOES_FUNCAO,
  FUNCOES,
  type FuncaoPerfil,
  type ItemPerfil,
  MAXIMO_CURSOS_PERFIL,
  type Perfil,
} from "@simplifica-if/contratos-app";
import { type FormEvent, type ReactNode, useEffect, useId, useState } from "react";
import type { Api } from "../conexao/api.ts";
import { explicarErro, type MensagemErro } from "../conexao/erros.ts";
import { useApi, useEstadoConexao } from "../contexto.tsx";
import { AvisoErro } from "./AvisoErro.tsx";
import { Button } from "./ui/button.tsx";
import { Spinner } from "./ui/spinner.tsx";

interface CursoDaBase extends ItemPerfil {
  /** "médio, subsequente", para distinguir cursos de mesmo nome. */
  readonly detalhe: string;
}

/** Os cursos de um campus, de todas as páginas de `listarCursos`, em ordem de nome. */
async function cursosDoCampus(api: Api, campus: string): Promise<ReadonlyArray<CursoDaBase>> {
  const cursos: Array<CursoDaBase> = [];
  let cursor: string | undefined;
  for (let pagina = 0; pagina < 10; pagina++) {
    const resposta = await api.chamar((cliente) =>
      cliente.listarCursos({ campus, limite: 100, ...(cursor === undefined ? {} : { cursor }) }),
    );
    for (const curso of resposta.dados.cursos) {
      const detalhe = [curso.nivel, curso.forma_oferta].filter((parte): parte is string => !!parte).join(", ");
      cursos.push({ id: curso.id, nome: curso.nome, detalhe });
    }
    cursor = resposta.pagina?.cursor;
    if (cursor === undefined) break;
  }
  return cursos.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

const classeSelect =
  "h-9 w-full max-w-sm rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function FormPerfil({
  inicial,
  rotuloGravar,
  aoGravar,
  secundaria,
}: {
  readonly inicial: Perfil | undefined;
  readonly rotuloGravar: string;
  readonly aoGravar: (perfil: Perfil) => Promise<unknown>;
  /** Outra ação ao lado de gravar: "Pular" nas boas-vindas, "Apagar o perfil" em Configurações. */
  readonly secundaria?: ReactNode;
}) {
  const api = useApi();
  const conectado = useEstadoConexao().fase === "conectada";
  const id = useId();
  const [campi, setCampi] = useState<ReadonlyArray<ItemPerfil>>();
  const [campus, setCampus] = useState(inicial?.campus?.id ?? "");
  const [funcao, setFuncao] = useState<FuncaoPerfil | undefined>(inicial?.funcao);
  // Os cursos com o campus a que pertencem: ao trocar de campus, os do anterior deixam de valer.
  const [cursosCarregados, setCursosCarregados] = useState<{
    readonly campus: string;
    readonly lista: ReadonlyArray<CursoDaBase>;
  }>();
  const cursos = cursosCarregados?.campus === campus ? cursosCarregados.lista : undefined;
  const [escolhidos, setEscolhidos] = useState<ReadonlyArray<string>>(inicial?.cursos.map((curso) => curso.id) ?? []);
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<MensagemErro>();

  useEffect(() => {
    if (!conectado) return;
    let vale = true;
    api
      .chamar((cliente) => cliente.sobreABase({}))
      .then(
        (resposta) => vale && setCampi(resposta.dados.campi.map(({ id: idCampus, nome }) => ({ id: idCampus, nome }))),
        (falha: unknown) => vale && setErro(explicarErro(falha)),
      );
    return () => {
      vale = false;
    };
  }, [api, conectado]);

  useEffect(() => {
    if (!conectado || campus === "") return;
    let vale = true;
    cursosDoCampus(api, campus).then(
      (lista) => vale && setCursosCarregados({ campus, lista }),
      (falha: unknown) => vale && setErro(explicarErro(falha)),
    );
    return () => {
      vale = false;
    };
  }, [api, conectado, campus]);

  const trocarCampus = (novo: string) => {
    setCampus(novo);
    setEscolhidos([]);
  };

  const gravar = async (evento: FormEvent) => {
    evento.preventDefault();
    setGravando(true);
    setErro(undefined);
    const doCampus = campi?.find((item) => item.id === campus);
    const perfil: Perfil = {
      ...(doCampus === undefined ? {} : { campus: doCampus }),
      ...(funcao === undefined ? {} : { funcao }),
      cursos: (cursos ?? [])
        .filter((curso) => escolhidos.includes(curso.id))
        .map(({ id: idCurso, nome }) => ({ id: idCurso, nome })),
    };
    try {
      await aoGravar(perfil);
    } catch (falha) {
      setErro(explicarErro(falha));
    } finally {
      setGravando(false);
    }
  };

  return (
    <form onSubmit={gravar} aria-label="Seu perfil" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-campus`} className="font-medium text-sm">
          Campus
        </label>
        <select
          id={`${id}-campus`}
          className={classeSelect}
          value={campus}
          onChange={(evento) => trocarCampus(evento.currentTarget.value)}
          disabled={campi === undefined}
        >
          <option value="">{campi === undefined ? "Carregando os campi…" : "Escolha o campus"}</option>
          {campi?.map((item) => (
            <option key={item.id} value={item.id}>
              {item.nome}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 font-medium text-sm">Sua função</legend>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {FUNCOES.map((opcao) => (
            <label
              key={opcao}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm has-checked:border-primary has-checked:bg-primary/6"
            >
              <input
                type="radio"
                name={`${id}-funcao`}
                value={opcao}
                checked={funcao === opcao}
                onChange={() => setFuncao(opcao)}
                className="accent-primary"
              />
              {DESCRICOES_FUNCAO[opcao].rotulo}
            </label>
          ))}
        </div>
      </fieldset>

      {campus === "" ? null : (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 font-medium text-sm">
            Seus cursos <span className="font-normal text-muted-foreground">(opcional)</span>
          </legend>
          {cursos === undefined ? (
            <p className="flex items-center gap-2 text-muted-foreground text-sm">
              <Spinner size="sm" /> Carregando os cursos do campus…
            </p>
          ) : cursos.length === 0 ? (
            <p className="text-muted-foreground text-sm">A base não tem cursos deste campus.</p>
          ) : (
            <ul className="grid max-h-64 gap-1 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-2">
              {cursos.map((curso) => (
                <li key={curso.id}>
                  <label className="flex items-start gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent">
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-primary"
                      checked={escolhidos.includes(curso.id)}
                      disabled={!escolhidos.includes(curso.id) && escolhidos.length >= MAXIMO_CURSOS_PERFIL}
                      onChange={(evento) =>
                        setEscolhidos(
                          evento.currentTarget.checked
                            ? [...escolhidos, curso.id]
                            : escolhidos.filter((outro) => outro !== curso.id),
                        )
                      }
                    />
                    <span>
                      {curso.nome}
                      {curso.detalhe === "" ? null : (
                        <span className="block text-muted-foreground text-xs">{curso.detalhe}</span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      )}

      <p className="max-w-prose text-muted-foreground text-sm">
        O perfil fica <strong>só neste computador</strong> e não vai para a IA. Serve para o Início mostrar primeiro as
        tarefas da sua função.
      </p>
      {erro === undefined ? null : <AvisoErro erro={erro} />}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={gravando}>
          {gravando ? <Spinner /> : null}
          {rotuloGravar}
        </Button>
        {secundaria}
      </div>
    </form>
  );
}
