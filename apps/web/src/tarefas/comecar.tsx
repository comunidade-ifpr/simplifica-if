/**
 * O começo de uma tarefa (M1.9), comum à caixa do Início e ao formulário da tarefa: a pasta em
 * `Documentos/Simplifica IF/<título>` (`pasta.criar`), os anexos copiados para ela (`pasta.anexar`), a
 * conversa com a tarefa e o pedido enviado. E os dois controles do começo: a escolha da IA e os anexos,
 * com o aviso de dado pessoal (M1.13, `conferencia.ts`).
 */
import type { Provider } from "@simplifica-if/contratos-app";
import { descreverContagem } from "@simplifica-if/dados-pessoais/detector";
import { PaperclipIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useId } from "react";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import type { Api } from "../conexao/api.ts";
import type { ControleConversa } from "../conversa/ControleConversa.ts";
import { ponteDesktop } from "../ponte-desktop.ts";
import { DESCRICOES, PROVIDERS } from "../providers.ts";
import { LEMBRETE_ANEXO } from "../components/AvisoUso.tsx";
import { cn } from "../lib/utils.ts";
import { type ConferenciaAnexos, temAchados } from "./conferencia.ts";
import { usePreferencias } from "./perfil.ts";

export async function comecarTarefa(
  api: Api,
  conversa: ControleConversa,
  pedido: {
    readonly titulo: string;
    readonly tarefa: string;
    readonly provider: Provider;
    readonly anexos: ReadonlyArray<string>;
    readonly texto: string;
  },
): Promise<string> {
  const { pasta } = await api.chamar((cliente) => cliente["pasta.criar"]({ titulo: pedido.titulo }));
  for (const arquivo of pedido.anexos) {
    await api.chamar((cliente) => cliente["pasta.anexar"]({ pasta, arquivo }));
  }
  return conversa.comecarTarefa({ provider: pedido.provider, pasta, tarefa: pedido.tarefa, pedido: pedido.texto });
}

/** O nome do arquivo de um caminho (macOS ou Windows). */
export const nomeArquivo = (caminho: string): string => caminho.split(/[\\/]/).at(-1) ?? caminho;

const NOMES_IA: Readonly<Record<Provider, string>> = {
  claude: "Claude",
  codex: "ChatGPT",
  antigravity: "Gemini (mais lento)",
};

export function EscolhaIa({
  valor,
  aoMudar,
}: {
  readonly valor: Provider;
  readonly aoMudar: (provider: Provider) => void;
}) {
  const id = useId();
  // As IAs que a pessoa deixou de usar no app (Configurações › Sua IA) saem da lista, menos a escolhida.
  const desligadas = usePreferencias().preferencias?.iasDesligadas ?? [];
  const opcoes = PROVIDERS.filter((provider) => provider === valor || !desligadas.includes(provider));
  return (
    <span className="flex items-center gap-1.5 text-sm">
      <label htmlFor={id} className="text-muted-foreground">
        IA
      </label>
      <select
        id={id}
        value={valor}
        onChange={(evento) => aoMudar(evento.currentTarget.value as Provider)}
        className="h-8 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title={DESCRICOES[valor].nome}
      >
        {opcoes.map((provider) => (
          <option key={provider} value={provider}>
            {NOMES_IA[provider]}
          </option>
        ))}
      </select>
    </span>
  );
}

const NOMES_TIPO_DADO = {
  cpf: "CPF",
  rg: "RG",
  telefone: "Celular",
  email: "E-mail pessoal",
} as const;

/**
 * O aviso de um anexo com dado pessoal (M1.13): quantos e onde, com os trechos mascarados, e a decisão
 * da pessoa. Não bloqueia: PPCs e normas trazem nomes e contatos de atos oficiais.
 */
function AvisoAnexo({
  arquivo,
  conferencia,
  aoRetirar,
}: {
  readonly arquivo: string;
  readonly conferencia: ConferenciaAnexos;
  readonly aoRetirar: () => void;
}) {
  const estado = conferencia.estado(arquivo);
  const nome = nomeArquivo(arquivo);
  if (estado?.fase === "falhou") {
    return (
      <p className="text-muted-foreground text-xs">
        {nome}: não foi possível procurar dados pessoais ({estado.erro.texto}) Confira o arquivo antes de enviar.
      </p>
    );
  }
  if (estado?.fase !== "pronta") return null;
  const resultado = estado.resultado;
  if (resultado.situacao === "nao-conferido") {
    return (
      <p className="text-muted-foreground text-xs" data-anexo-nao-conferido>
        {nome}: não conferido. {resultado.motivo} Confira você mesmo se ele tem dado pessoal.
      </p>
    );
  }
  if (resultado.total === 0) return null;
  const contagem = descreverContagem(resultado.porTipo);
  if (conferencia.aceito(arquivo)) {
    return (
      <p className="text-muted-foreground text-xs">
        {nome}: você decidiu enviar mesmo com {contagem}.
      </p>
    );
  }
  const mostrados = resultado.exemplos.length;
  return (
    <Alert variant="warning" role="alert" aria-label={`Aviso sobre ${nome}`}>
      <TriangleAlertIcon />
      <AlertTitle>
        {nome} parece ter dado pessoal: {contagem}.
      </AlertTitle>
      <AlertDescription>
        <ul className="flex flex-col gap-0.5" aria-label={`Onde está em ${nome}`}>
          {resultado.exemplos
            .map((exemplo, ordem) => ({ ...exemplo, ordem }))
            .map((exemplo) => (
              <li key={exemplo.ordem}>
                <span className="font-medium">
                  {NOMES_TIPO_DADO[exemplo.tipo]}, {exemplo.onde}:
                </span>{" "}
                <span className="font-mono text-xs">{exemplo.trecho}</span>
              </li>
            ))}
        </ul>
        {resultado.total > mostrados ? <p>E mais {resultado.total - mostrados}.</p> : null}
        <p>
          O arquivo vai para a pasta da tarefa, e a IA pode lê-lo. PPCs e normas trazem nomes e contatos de atos
          oficiais; se for o caso, pode enviar. Se não, retire o anexo, apague os dados no arquivo e anexe de novo.
        </p>
        <div className="mt-1 flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => conferencia.aceitar(arquivo)}>
            Enviar mesmo assim
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={aoRetirar}>
            Retirar o anexo
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

/** A frase de por que o envio espera, ou `undefined` se nada o segura. */
export function esperaDosAnexos(conferencia: ConferenciaAnexos, anexos: ReadonlyArray<string>): string | undefined {
  const pendentes = conferencia.pendentes(anexos);
  if (pendentes.length === 0) return undefined;
  return pendentes.some((arquivo) => conferencia.estado(arquivo)?.fase === "conferindo")
    ? "Procurando dados pessoais no anexo…"
    : "Antes de enviar, decida sobre o aviso do anexo.";
}

/**
 * "Anexar arquivo…" (só no app: o diálogo do sistema; o processo principal libera o arquivo no
 * servidor) e a lista dos escolhidos, com "Tirar". Cada escolhido passa pelo detector de dados pessoais
 * (M1.13), e o aviso aparece logo abaixo.
 */
export function Anexos({
  anexos,
  aoMudar,
  conferencia,
  aceita,
  rotulo = "Anexar arquivo…",
}: {
  readonly anexos: ReadonlyArray<string>;
  readonly aoMudar: (anexos: ReadonlyArray<string>) => void;
  readonly conferencia: ConferenciaAnexos;
  readonly aceita?: ReadonlyArray<string> | undefined;
  readonly rotulo?: string;
}) {
  const escolher = ponteDesktop()?.escolherAnexo;
  const tirar = (arquivo: string) => aoMudar(anexos.filter((outro) => outro !== arquivo));
  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {escolher === undefined ? (
          <span className="text-muted-foreground text-xs">Para anexar arquivos, use o app no computador.</span>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={async () => {
              const arquivo = await escolher(aceita);
              if (arquivo !== null && !anexos.includes(arquivo)) {
                aoMudar([...anexos, arquivo]);
                conferencia.conferir(arquivo);
              }
            }}
          >
            <PaperclipIcon /> {rotulo}
          </Button>
        )}
        <span className="text-muted-foreground text-xs" data-lembrete-anexo>
          {LEMBRETE_ANEXO}
        </span>
        {anexos.length === 0 ? null : (
          <ul className="flex flex-wrap gap-1.5" aria-label="Arquivos anexados">
            {anexos.map((arquivo) => {
              const estado = conferencia.estado(arquivo);
              const comAviso = temAchados(estado) && !conferencia.aceito(arquivo);
              return (
                <li
                  key={arquivo}
                  className={cn(
                    "flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs",
                    comAviso && "border-warning/50 bg-warning-surface",
                  )}
                >
                  {estado?.fase === "conferindo" ? (
                    <Spinner size="sm" tone="muted" />
                  ) : comAviso ? (
                    <TriangleAlertIcon aria-hidden className="size-3 text-warning" />
                  ) : (
                    <PaperclipIcon aria-hidden className="size-3" />
                  )}
                  {nomeArquivo(arquivo)}
                  <button
                    type="button"
                    className="rounded-full p-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Tirar ${nomeArquivo(arquivo)}`}
                    onClick={() => tirar(arquivo)}
                  >
                    <XIcon className="size-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {anexos.map((arquivo) => (
        <AvisoAnexo key={arquivo} arquivo={arquivo} conferencia={conferencia} aoRetirar={() => tirar(arquivo)} />
      ))}
    </div>
  );
}
