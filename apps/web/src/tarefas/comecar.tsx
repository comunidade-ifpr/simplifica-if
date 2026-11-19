/**
 * O começo de uma tarefa (M1.9), comum à caixa do Início e ao formulário da tarefa: a pasta em
 * `Documentos/Simplifica IF/<título>` (`pasta.criar`), os anexos copiados para ela (`pasta.anexar`), a
 * conversa com a tarefa e o pedido enviado. E os controles do começo: a escolha da IA, com o modelo e
 * o raciocínio, e os anexos.
 */
import type { ModeloProvider, Provider } from "@simplifica-if/contratos-app";
import { ChevronDownIcon, PaperclipIcon, XIcon } from "lucide-react";
import { useId } from "react";
import { MarcaIa } from "../components/MarcaIa.tsx";
import { Button } from "../components/ui/button.tsx";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../components/ui/menu.tsx";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../components/ui/select.tsx";
import type { Api } from "../conexao/api.ts";
import type { ControleConversa } from "../conversa/ControleConversa.ts";
import { ponteDesktop } from "../ponte-desktop.ts";
import { DESCRICOES, PROVIDERS } from "../providers.ts";
import {
  comModelo,
  comRaciocinio,
  dicaDoModelo,
  type EscolhaDaIa,
  modeloEfetivo,
  rotuloDaEscolha,
  useModelos,
} from "./modelos.ts";
import { usePreferencias } from "./perfil.ts";

export async function comecarTarefa(
  api: Api,
  conversa: ControleConversa,
  pedido: {
    readonly titulo: string;
    readonly tarefa: string;
    readonly ia: EscolhaDaIa;
    readonly anexos: ReadonlyArray<string>;
    readonly texto: string;
  },
): Promise<string> {
  const { pasta } = await api.chamar((cliente) => cliente["pasta.criar"]({ titulo: pedido.titulo }));
  for (const arquivo of pedido.anexos) {
    await api.chamar((cliente) => cliente["pasta.anexar"]({ pasta, arquivo }));
  }
  return conversa.comecarTarefa({ ia: pedido.ia, pasta, tarefa: pedido.tarefa, pedido: pedido.texto });
}

/** O nome do arquivo de um caminho (macOS ou Windows). */
export const nomeArquivo = (caminho: string): string => caminho.split(/[\\/]/).at(-1) ?? caminho;

const NOMES_IA: Readonly<Record<Provider, string>> = {
  claude: "Claude",
  codex: "ChatGPT",
  antigravity: "Gemini",
};

/** O valor da opção "Automático" no grupo dos modelos (nenhum `id` de modelo é vazio). */
const AUTOMATICO = "";

/**
 * O botão do modelo, ao lado da IA: "Automático" (o padrão da conta) ou um dos modelos que a conta
 * oferece e, para o modelo que aceita, o raciocínio "Normal" ou "Aprofundado". Não aparece para a IA
 * que não lista modelos (o Gemini) nem antes de a lista chegar.
 */
function EscolhaModelo({
  valor,
  aoMudar,
  modelos,
  compacta,
}: {
  readonly valor: EscolhaDaIa;
  readonly aoMudar: (escolha: EscolhaDaIa) => void;
  readonly modelos: ReadonlyArray<ModeloProvider>;
  readonly compacta: boolean;
}) {
  const rotulo = rotuloDaEscolha(valor, modelos);
  const aceitaRaciocinio = modeloEfetivo(modelos, valor.modelo)?.esforcoAprofundado !== undefined;
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant={compacta ? "ghost" : "outline"}
            className={compacta ? "rounded-full font-medium text-muted-foreground" : undefined}
          />
        }
        aria-label={`Modelo: ${rotulo}`}
        title={`Modelo: ${rotulo}`}
      >
        {rotulo}
        <ChevronDownIcon aria-hidden className="-me-1 size-3.5 opacity-70" />
      </MenuTrigger>
      <MenuPopup>
        <MenuGroup>
          <MenuGroupLabel>Modelo</MenuGroupLabel>
          <MenuRadioGroup
            value={valor.modelo ?? AUTOMATICO}
            onValueChange={(modelo: string) =>
              aoMudar(comModelo(valor, modelos, modelo === AUTOMATICO ? undefined : modelo))
            }
          >
            <MenuRadioItem value={AUTOMATICO} dica="recomendado">
              Automático
            </MenuRadioItem>
            {modelos.map((modelo) => (
              <MenuRadioItem key={modelo.id} value={modelo.id} dica={dicaDoModelo(modelo.nome)}>
                {modelo.nome}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
        {aceitaRaciocinio ? (
          <>
            <MenuSeparator />
            <MenuGroup>
              <MenuGroupLabel>Raciocínio</MenuGroupLabel>
              <MenuRadioGroup
                value={valor.esforco === undefined ? "normal" : "aprofundado"}
                onValueChange={(raciocinio: string) =>
                  aoMudar(comRaciocinio(valor, modelos, raciocinio === "aprofundado"))
                }
              >
                <MenuRadioItem value="normal">Normal</MenuRadioItem>
                <MenuRadioItem value="aprofundado" dica="demora mais">
                  Aprofundado
                </MenuRadioItem>
              </MenuRadioGroup>
            </MenuGroup>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

/**
 * A escolha da IA, com a marca de cada uma ao lado do nome (no botão e na lista), e, ao lado, a do
 * modelo (`EscolhaModelo`). A da IA é o `Select` do Base UI (combobox com teclado e leitor de tela),
 * não o `<select>` nativo, cujas opções não aceitam ícone. Trocar de IA volta o modelo a "Automático".
 * `compacta` (na caixa de pedido): só a marca, o nome e um chevron, discretos, e o rótulo "IA" só para o
 * leitor de tela.
 */
export function EscolhaIa({
  valor: escolhida,
  aoMudar: aoEscolher,
  compacta = false,
}: {
  readonly valor: EscolhaDaIa;
  readonly aoMudar: (escolha: EscolhaDaIa) => void;
  readonly compacta?: boolean;
}) {
  const id = useId();
  const valor = escolhida.provider;
  const aoMudar = (provider: Provider) => provider !== valor && aoEscolher({ provider });
  const modelos = useModelos(valor);
  const modelo =
    modelos.length === 0 ? null : (
      <EscolhaModelo valor={escolhida} aoMudar={aoEscolher} modelos={modelos} compacta={compacta} />
    );
  // As IAs que a pessoa deixou de usar no app (Configurações › Sua IA) saem da lista, menos a escolhida.
  const desligadas = usePreferencias().preferencias?.iasDesligadas ?? [];
  const opcoes = PROVIDERS.filter((provider) => provider === valor || !desligadas.includes(provider));
  const escolha = (
    <Select
      value={valor}
      onValueChange={(provider) => provider !== null && aoMudar(provider)}
      itemToStringLabel={(provider: Provider) => NOMES_IA[provider]}
    >
      <SelectTrigger
        id={id}
        variant={compacta ? "ghost" : "default"}
        size="sm"
        className={compacta ? "w-auto rounded-full font-medium" : "w-auto min-w-0"}
        title={`IA: ${DESCRICOES[valor].nome}`}
        {...(compacta ? { "aria-label": "IA" } : {})}
      >
        <SelectValue className="flex items-center gap-1.5">
          {(provider: Provider) => (
            <>
              <MarcaIa provider={provider} />
              {NOMES_IA[provider]}
            </>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectPopup alignItemWithTrigger={false}>
        {opcoes.map((provider) => (
          <SelectItem key={provider} value={provider}>
            <span className="flex items-center gap-2">
              <MarcaIa provider={provider} />
              {NOMES_IA[provider]}
            </span>
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
  if (compacta)
    return (
      <span className="flex items-center">
        {escolha}
        {modelo}
      </span>
    );
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-sm">
      <label htmlFor={id} className="text-muted-foreground">
        IA
      </label>
      {escolha}
      {modelo}
    </span>
  );
}

/**
 * O clipe de "Anexar arquivo" (só no app: o diálogo do sistema; o processo principal libera o arquivo
 * no servidor), um botão redondo só com o ícone, e a lista dos escolhidos, com "Tirar". Com `rotulo`
 * (o campo de arquivo do formulário da tarefa), o botão mostra o texto ao lado do clipe.
 */
export function Anexos({
  anexos,
  aoMudar,
  aceita,
  rotulo,
}: {
  readonly anexos: ReadonlyArray<string>;
  readonly aoMudar: (anexos: ReadonlyArray<string>) => void;
  readonly aceita?: ReadonlyArray<string> | undefined;
  readonly rotulo?: string | undefined;
}) {
  const escolher = ponteDesktop()?.escolherAnexo;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {escolher === undefined ? (
        <span className="text-muted-foreground text-xs">Para anexar arquivos, use o app no computador.</span>
      ) : (
        <Button
          type="button"
          {...(rotulo === undefined
            ? ({
                variant: "ghost",
                size: "icon-sm-pill",
                className: "text-muted-foreground hover:text-foreground",
                "aria-label": "Anexar arquivo",
                title: "Anexar arquivo",
              } as const)
            : ({ variant: "outline", size: "sm" } as const))}
          onClick={async () => {
            const arquivo = await escolher(aceita);
            if (arquivo !== null && !anexos.includes(arquivo)) aoMudar([...anexos, arquivo]);
          }}
        >
          <PaperclipIcon aria-hidden />
          {rotulo}
        </Button>
      )}
      {anexos.length === 0 ? null : (
        <ul className="flex flex-wrap gap-1.5" aria-label="Arquivos anexados">
          {anexos.map((arquivo) => (
            <li
              key={arquivo}
              className="flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs"
            >
              <PaperclipIcon aria-hidden className="size-3" />
              {nomeArquivo(arquivo)}
              <button
                type="button"
                className="rounded-full p-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Tirar ${nomeArquivo(arquivo)}`}
                onClick={() => aoMudar(anexos.filter((outro) => outro !== arquivo))}
              >
                <XIcon className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
