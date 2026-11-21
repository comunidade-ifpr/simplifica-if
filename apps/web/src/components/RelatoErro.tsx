/**
 * "Isto está errado" (M1.12): o relato de uma resposta para a equipe que cuida da base.
 *
 * O servidor monta o rascunho da conversa gravada (`relato.preparar`: pergunta, resposta, fontes,
 * versões e o destino da política). Aqui a pessoa escreve o que está errado, retira os trechos que não
 * quer mandar (trechos, fontes, versões) e vê o relato exatamente como vai sair (`montarRelato`, com
 * `@menções` e `#referências` entre crases). O app não confere dado pessoal: perto de "Abrir no GitHub",
 * um texto fixo diz que o relato fica público e o que não pôr nele. Depois:
 *
 * - **Abrir no GitHub:** com o repositório da curadoria na política, abre `issues/new` já preenchida no
 *   navegador do sistema; a pessoa revisa e envia com a própria conta (o app não guarda token). O
 *   relato é registrado antes de a página abrir. Relato grande demais para a URL vai pela área de
 *   transferência, com o pedido de colar.
 * - **Salvar o relato:** um `.md` em `Documentos/Simplifica IF/Relatos de erro/`, fora da pasta da
 *   tarefa (a IA não o lê nos próximos turnos).
 * - **Copiar o relato:** o texto, para mandar por e-mail ou mensagem.
 *
 * Cada envio fica registrado no servidor local (`relato.registrar`) e marca o 👎 da resposta.
 */
import {
  ESCOLHAS_INICIAIS,
  type EscolhasRelato,
  montarRelato,
  montarUrlIssue,
  NOMES_PROVIDER,
  type RascunhoRelato,
  type ViaRelato,
  trechosDe,
} from "@simplifica-if/contratos-app";
import { CopyIcon, ExternalLinkIcon, FlagIcon, SaveIcon, TriangleAlertIcon } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { explicarErro, type MensagemErro } from "../conexao/erros.ts";
import { useApi } from "../contexto.tsx";
import { abrirExterno } from "../ponte-desktop.ts";
import { AvisoErro } from "./AvisoErro.tsx";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert.tsx";
import { Button } from "./ui/button.tsx";
import { Spinner } from "./ui/spinner.tsx";
import { Textarea } from "./ui/textarea.tsx";

const alternar = <A,>(conjunto: ReadonlySet<A>, valor: A): ReadonlySet<A> => {
  const novo = new Set(conjunto);
  if (novo.has(valor)) novo.delete(valor);
  else novo.add(valor);
  return novo;
};

/** Os trechos de um texto, cada um com a caixa "Incluir". */
function Trechos({
  titulo,
  texto,
  retirados,
  aoAlternar,
}: {
  readonly titulo: string;
  readonly texto: string;
  readonly retirados: ReadonlySet<number>;
  readonly aoAlternar: (indice: number) => void;
}) {
  const trechos = trechosDe(texto).map((trecho, indice) => ({ indice, trecho }));
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 font-medium text-sm">{titulo}</legend>
      {trechos.map(({ indice, trecho }) => (
        <label
          key={indice}
          className="flex items-start gap-2 rounded-md border border-border px-2 py-1.5 text-sm has-[input:not(:checked)]:text-muted-foreground has-[input:not(:checked)]:line-through"
        >
          <input
            type="checkbox"
            className="mt-0.5 accent-primary"
            checked={!retirados.has(indice)}
            aria-label={`Incluir o trecho ${indice + 1} de ${titulo.toLowerCase()}`}
            onChange={() => aoAlternar(indice)}
          />
          <span data-conteudo className="line-clamp-4 whitespace-pre-wrap">
            {trecho}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function Caixa({
  rotulo,
  marcada,
  aoMudar,
  children,
}: {
  readonly rotulo: string;
  readonly marcada: boolean;
  readonly aoMudar: () => void;
  readonly children: ReactNode;
}) {
  return (
    <label className="flex items-start gap-2 text-sm has-[input:not(:checked)]:text-muted-foreground has-[input:not(:checked)]:line-through">
      <input
        type="checkbox"
        className="mt-0.5 accent-primary"
        checked={marcada}
        aria-label={rotulo}
        onChange={aoMudar}
      />
      <span className="min-w-0 break-all">{children}</span>
    </label>
  );
}

type Envio =
  | { readonly fase: "parado" }
  | { readonly fase: "enviando"; readonly via: ViaRelato }
  | { readonly fase: "feito"; readonly mensagem: string }
  | { readonly fase: "falhou"; readonly erro: MensagemErro };

async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}

function Formulario({
  rascunho,
  aoRegistrado,
  aoFechar,
}: {
  readonly rascunho: RascunhoRelato;
  readonly aoRegistrado: () => void;
  readonly aoFechar: () => void;
}) {
  const api = useApi();
  const idDescricao = useId();
  const [escolhas, setEscolhas] = useState<EscolhasRelato>(ESCOLHAS_INICIAIS);
  const [envio, setEnvio] = useState<Envio>({ fase: "parado" });
  const relato = montarRelato(rascunho, escolhas);
  const textoCompleto = `# ${relato.titulo}\n\n${relato.corpo}`;
  const mudar = (mudanca: Partial<EscolhasRelato>) => {
    setEscolhas((atual) => ({ ...atual, ...mudanca }));
    if (envio.fase !== "enviando") setEnvio({ fase: "parado" });
  };

  const registrar = (via: ViaRelato) =>
    api.chamar((cliente) =>
      cliente["relato.registrar"]({
        sessao: rascunho.sessao,
        turno: rascunho.turno,
        via,
        titulo: relato.titulo,
        corpo: relato.corpo,
      }),
    );

  const enviar = async (via: ViaRelato) => {
    setEnvio({ fase: "enviando", via });
    try {
      let mensagem: string;
      if (via === "github") {
        const { url, completa } = montarUrlIssue(rascunho.repositorio ?? "", rascunho.rotulos, relato);
        // Registrado antes de a página abrir: o registro local não depende de a pessoa enviar.
        await registrar(via);
        const copiou = completa ? true : await copiar(relato.corpo);
        await abrirExterno(url);
        mensagem = completa
          ? "Abrimos a página do GitHub no navegador, já preenchida. Revise e confirme o envio lá, com a sua conta."
          : copiou
            ? "O relato é longo e foi copiado. Na página do GitHub que abrimos, cole-o no campo da descrição (Ctrl+V ou Cmd+V) e confirme o envio."
            : "O relato é longo demais para a página. Use “Copiar o relato” e cole-o no campo da descrição da página que abrimos.";
      } else if (via === "copia") {
        if (!(await copiar(textoCompleto))) {
          setEnvio({
            fase: "falhou",
            erro: { texto: "Não foi possível copiar. Selecione o texto da prévia acima e copie com Ctrl+C ou Cmd+C." },
          });
          return;
        }
        await registrar(via);
        mensagem = "Relato copiado. Cole-o no e-mail ou na mensagem para a equipe que cuida da base.";
      } else {
        const registrado = await registrar(via);
        mensagem = `Relato salvo em Documentos › Simplifica IF › Relatos de erro: ${
          registrado.arquivo?.split(/[\\/]/).at(-1) ?? ""
        }. Ele fica fora da pasta da tarefa, e a IA não o lê.`;
      }
      setEnvio({ fase: "feito", mensagem });
      aoRegistrado();
    } catch (falha) {
      setEnvio({ fase: "falhou", erro: explicarErro(falha) });
    }
  };

  const ocupado = envio.fase === "enviando";
  const versoes = rascunho.versoes;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        O relato é para a equipe que cuida da base do Simplifica IF. Abaixo está exatamente o que vai: tire o que não
        quiser mandar. Anexos e arquivos da pasta da tarefa nunca vão.
      </p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={idDescricao} className="font-medium text-sm">
          O que está errado?
        </label>
        <Textarea
          id={idDescricao}
          rows={3}
          placeholder="Ex.: o art. 20 citado não trata de estágio; o certo é o art. 21 da mesma resolução."
          value={escolhas.descricao}
          onChange={(evento) => mudar({ descricao: evento.currentTarget.value })}
        />
      </div>
      <div className="flex flex-col gap-3" role="group" aria-label="O que vai no relato">
        <Trechos
          titulo="Sua pergunta"
          texto={rascunho.pergunta}
          retirados={escolhas.retiradosPergunta}
          aoAlternar={(indice) => mudar({ retiradosPergunta: alternar(escolhas.retiradosPergunta, indice) })}
        />
        <Trechos
          titulo="A resposta da IA"
          texto={rascunho.resposta}
          retirados={escolhas.retiradosResposta}
          aoAlternar={(indice) => mudar({ retiradosResposta: alternar(escolhas.retiradosResposta, indice) })}
        />
        {rascunho.citacoes.length === 0 ? null : (
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 font-medium text-sm">Fontes citadas</legend>
            <p className="text-muted-foreground text-small">Tirar uma fonte a tira da lista e do texto da resposta.</p>
            {rascunho.citacoes.map((link) => (
              <Caixa
                key={link}
                rotulo={`Incluir a fonte ${link}`}
                marcada={!escolhas.retiradasCitacoes.has(link)}
                aoMudar={() => mudar({ retiradasCitacoes: alternar(escolhas.retiradasCitacoes, link) })}
              >
                <code className="text-small">{link}</code>
              </Caixa>
            ))}
          </fieldset>
        )}
        {rascunho.fontesExternas.length === 0 ? null : (
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 font-medium text-sm">Fontes externas citadas</legend>
            <p className="text-muted-foreground text-small">
              Links de fora da base do IFPR. Tirar uma fonte a tira da lista e do texto da resposta.
            </p>
            {rascunho.fontesExternas.map((link) => (
              <Caixa
                key={link}
                rotulo={`Incluir a fonte externa ${link}`}
                marcada={!escolhas.retiradasCitacoes.has(link)}
                aoMudar={() => mudar({ retiradasCitacoes: alternar(escolhas.retiradasCitacoes, link) })}
              >
                <code className="text-small">{link}</code>
              </Caixa>
            ))}
          </fieldset>
        )}
        <Caixa
          rotulo="Incluir as versões do app, da base, da tarefa e da IA"
          marcada={!escolhas.semVersoes}
          aoMudar={() => mudar({ semVersoes: !escolhas.semVersoes })}
        >
          Versões: app {versoes.app}, base {versoes.base}
          {versoes.baseCommit === null ? "" : ` (revisão da base ${versoes.baseCommit.slice(0, 12)})`}
          {versoes.tarefa === null ? "" : `, ${versoes.tarefa.titulo} ${versoes.tarefa.versao}`},{" "}
          {NOMES_PROVIDER[versoes.provider]}
          {versoes.versaoProvider === null ? "" : ` ${versoes.versaoProvider}`}
        </Caixa>
      </div>
      <section aria-label="Prévia do relato" className="flex flex-col gap-1">
        <h4 className="font-medium text-sm">Assim vai o relato</h4>
        {rascunho.repositorio === null || rascunho.rotulos.length === 0 ? null : (
          <p className="text-muted-foreground text-small">
            No GitHub, com {rascunho.rotulos.length === 1 ? "o rótulo" : "os rótulos"}{" "}
            {rascunho.rotulos.map((rotulo) => (
              <code key={rotulo} className="rounded bg-muted px-1">
                {rotulo}
              </code>
            ))}
            . Menções (@) e números de relato (#) vão entre crases, para não avisar ninguém no GitHub.
          </p>
        )}
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted p-3 text-small">
          {textoCompleto}
        </pre>
        {/* O texto vai no formato da curadoria, com "commit"; o rótulo da tela fica em português (M1.14). */}
        {escolhas.semVersoes || versoes.baseCommit === null ? null : (
          <p className="text-muted-foreground text-small">
            No relato, <code>commit</code> é a revisão da base: o código que a equipe da base usa para achar a versão
            exata.
          </p>
        )}
      </section>
      {rascunho.repositorio === null ? (
        <p className="text-muted-foreground text-sm">
          O envio direto para a equipe da base ainda não está disponível neste app. Salve ou copie o relato e mande para
          a equipe.
        </p>
      ) : (
        <Alert variant="warning" aria-label="O relato fica público">
          <TriangleAlertIcon />
          <AlertTitle>No GitHub, o relato fica público.</AlertTitle>
          <AlertDescription>
            <p>
              Qualquer pessoa na internet pode ler o relato, e os buscadores o indexam. Não ponha nome de estudante nem
              de servidor, nem conteúdo de documento de acesso restrito: retire esses trechos acima antes de abrir.
            </p>
            <p>
              “Abrir no GitHub” abre a página da equipe no navegador, já preenchida; você revisa e envia com a sua
              conta. Sem conta, ou para não publicar, salve ou copie o relato e mande à equipe.
            </p>
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        {rascunho.repositorio === null ? null : (
          <Button type="button" disabled={ocupado} onClick={() => void enviar("github")}>
            {envio.fase === "enviando" && envio.via === "github" ? <Spinner /> : <ExternalLinkIcon />}
            Abrir no GitHub
          </Button>
        )}
        {rascunho.podeSalvar ? (
          <Button
            type="button"
            variant={rascunho.repositorio === null ? "default" : "outline"}
            disabled={ocupado}
            onClick={() => void enviar("arquivo")}
          >
            {envio.fase === "enviando" && envio.via === "arquivo" ? <Spinner /> : <SaveIcon />}
            Salvar o relato
          </Button>
        ) : null}
        <Button type="button" variant="outline" disabled={ocupado} onClick={() => void enviar("copia")}>
          <CopyIcon /> Copiar o relato
        </Button>
        <Button type="button" variant="ghost" onClick={aoFechar}>
          Fechar
        </Button>
      </div>
      {envio.fase === "feito" ? (
        <p role="status" className="text-sm">
          {envio.mensagem}
        </p>
      ) : envio.fase === "falhou" ? (
        <AvisoErro erro={envio.erro} />
      ) : null}
    </div>
  );
}

/** O relato da resposta do `turno`, logo abaixo dela. */
export function RelatoErro({
  sessao,
  turno,
  aoRegistrado,
  aoFechar,
}: {
  readonly sessao: string;
  readonly turno: number;
  readonly aoRegistrado: () => void;
  readonly aoFechar: () => void;
}) {
  const api = useApi();
  const [estado, setEstado] = useState<
    | { readonly fase: "carregando" }
    | { readonly fase: "pronto"; readonly rascunho: RascunhoRelato }
    | { readonly fase: "falhou"; readonly erro: MensagemErro }
  >({ fase: "carregando" });
  useEffect(() => {
    // O componente é de um turno só (a conversa o monta de novo para outro): o estado inicial basta.
    let vivo = true;
    api
      .chamar((cliente) => cliente["relato.preparar"]({ sessao, turno }))
      .then(
        (rascunho) => vivo && setEstado({ fase: "pronto", rascunho }),
        (falha: unknown) => vivo && setEstado({ fase: "falhou", erro: explicarErro(falha) }),
      );
    return () => {
      vivo = false;
    };
  }, [api, sessao, turno]);
  return (
    <section
      aria-label="Relatar um erro nesta resposta"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <h3 className="flex items-center gap-2 font-semibold">
        <FlagIcon aria-hidden className="size-4" /> Isto está errado
      </h3>
      {estado.fase === "carregando" ? (
        <p className="flex items-center gap-2 text-muted-foreground text-sm">
          <Spinner size="sm" /> Preparando o relato…
        </p>
      ) : estado.fase === "falhou" ? (
        <>
          <AvisoErro erro={estado.erro} />
          <div>
            <Button type="button" variant="ghost" onClick={aoFechar}>
              Fechar
            </Button>
          </div>
        </>
      ) : (
        <Formulario rascunho={estado.rascunho} aoRegistrado={aoRegistrado} aoFechar={aoFechar} />
      )}
    </section>
  );
}
