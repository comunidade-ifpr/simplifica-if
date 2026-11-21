/**
 * O formulário do perfil (M1.8), nas boas-vindas e em Configurações › Seu perfil, na ordem do SUAP: o
 * campus ou a pró-reitoria (os campi da base, de `sobreABase`, e `PRO_REITORIAS`), a categoria e o
 * cargo e a função de gestão, se houver. Tudo se traduz no `publico` dos manifestos (`publicosDoPerfil`). Nada daqui vai à IA: o perfil fica no
 * servidor local.
 */
import {
  CATEGORIAS,
  type CargoPerfil,
  type CategoriaPerfil,
  cargosDaCategoria,
  FUNCOES,
  type FuncaoPerfil,
  type ItemPerfil,
  OUTRO_CARGO,
  type Perfil,
  PRO_REITORIAS,
  ROTULOS_CATEGORIA,
  ROTULOS_FUNCAO,
} from "@simplifica-if/contratos-app";
import { type FormEvent, type ReactNode, useEffect, useId, useState } from "react";
import { explicarErro, type MensagemErro } from "../conexao/erros.ts";
import { useApi, useEstadoConexao } from "../contexto.tsx";
import { AvisoErro } from "./AvisoErro.tsx";
import { Button } from "./ui/button.tsx";
import { Spinner } from "./ui/spinner.tsx";

/** O cargo que a categoria sugere ao ser escolhida: quase todo docente do IFPR é professor EBTT. */
const CARGO_SUGERIDO: Readonly<Record<CategoriaPerfil, CargoPerfil | undefined>> = {
  docente: "professor-ebtt",
  "tecnico-administrativo": undefined,
};

const classeOpcao =
  "flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm has-checked:border-primary has-checked:bg-primary/6 has-focus-visible:ring-2 has-focus-visible:ring-ring";

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
  const [categoria, setCategoria] = useState<CategoriaPerfil | undefined>(inicial?.categoria);
  const [cargo, setCargo] = useState<CargoPerfil | undefined>(inicial?.cargo);
  const [funcao, setFuncao] = useState<FuncaoPerfil | undefined>(inicial?.funcao);
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

  const trocarCategoria = (nova: CategoriaPerfil) => {
    setCategoria(nova);
    setCargo(CARGO_SUGERIDO[nova]);
  };

  const campiDaBase = campi?.filter((item) => item.id !== "reitoria");
  const reitoria = campi?.find((item) => item.id === "reitoria");
  const unidades: ReadonlyArray<ItemPerfil> = [...(campi ?? []), ...PRO_REITORIAS];

  const gravar = async (evento: FormEvent) => {
    evento.preventDefault();
    setGravando(true);
    setErro(undefined);
    const doCampus = unidades.find((item) => item.id === campus);
    const perfil: Perfil = {
      ...(doCampus === undefined ? {} : { campus: { id: doCampus.id, nome: doCampus.nome } }),
      ...(categoria === undefined ? {} : { categoria }),
      ...(categoria === undefined || cargo === undefined ? {} : { cargo }),
      ...(funcao === undefined ? {} : { funcao }),
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
          Campus ou pró-reitoria
        </label>
        <select
          id={`${id}-campus`}
          className={classeSelect}
          value={campus}
          onChange={(evento) => setCampus(evento.currentTarget.value)}
          disabled={campi === undefined}
        >
          <option value="">{campi === undefined ? "Carregando os campi…" : "Escolha onde você trabalha"}</option>
          <optgroup label="Campi">
            {campiDaBase?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.nome}
              </option>
            ))}
          </optgroup>
          <optgroup label="Reitoria">
            {reitoria === undefined ? null : <option value={reitoria.id}>{reitoria.nome}</option>}
            {PRO_REITORIAS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.nome}
              </option>
            ))}
          </optgroup>
        </select>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 font-medium text-sm">Categoria</legend>
        <div className="grid max-w-xl gap-1.5 sm:grid-cols-2">
          {CATEGORIAS.map((opcao) => (
            <label key={opcao} className={classeOpcao}>
              <input
                type="radio"
                name={`${id}-categoria`}
                value={opcao}
                checked={categoria === opcao}
                onChange={() => trocarCategoria(opcao)}
                className="accent-primary"
              />
              {ROTULOS_CATEGORIA[opcao]}
            </label>
          ))}
        </div>
      </fieldset>

      {categoria === undefined ? null : (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-cargo`} className="font-medium text-sm">
            Cargo
          </label>
          <select
            id={`${id}-cargo`}
            className={classeSelect}
            value={cargo ?? ""}
            onChange={(evento) => {
              const valor = evento.currentTarget.value;
              setCargo(valor === "" ? undefined : (valor as CargoPerfil));
            }}
          >
            <option value="">Escolha o cargo</option>
            {cargosDaCategoria(categoria).map((opcao) => (
              <option key={opcao.id} value={opcao.id}>
                {opcao.rotulo}
              </option>
            ))}
            <option value={OUTRO_CARGO}>Outro cargo</option>
          </select>
        </div>
      )}

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 font-medium text-sm">Função de gestão</legend>
        <div className="grid max-w-xl gap-1.5 sm:grid-cols-2">
          {[...FUNCOES, undefined].map((opcao) => (
            <label key={opcao ?? "nenhuma"} className={classeOpcao}>
              <input
                type="radio"
                name={`${id}-funcao`}
                value={opcao ?? ""}
                checked={funcao === opcao}
                onChange={() => setFuncao(opcao)}
                className="accent-primary"
              />
              {opcao === undefined ? "Nenhuma das opções" : ROTULOS_FUNCAO[opcao]}
            </label>
          ))}
        </div>
      </fieldset>

      <p className="max-w-prose text-muted-foreground text-sm">
        O perfil fica <strong>só neste computador</strong> e define as tarefas que aparecem primeiro.
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
