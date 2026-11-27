/**
 * A linha do acompanhamento no Word, com a revisão acompanhando um arquivo: qual, o que o último
 * salvamento mudou ("Salvo às 14:32 · 2 pontos resolvidos, 1 novo") ou por que não deu para conferir, o
 * pedido do arquivo de novo depois de fechar o app e "Reconferir com a IA" as pendências da IA marcadas
 * "Feito" (a conferência ao salvar é só a do código: a da IA custa tempo e cota, e vem por pedido).
 *
 * Quem a usa a monta com `key` da lista: a estimativa aberta é de uma lista só.
 */
import { EyeIcon } from "lucide-react";
import { useRef, useState } from "react";
import { AvisoErro } from "../../components/AvisoErro.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Spinner } from "../../components/ui/spinner.tsx";
import { horaDe } from "../../lib/formato.ts";
import { nomeDoArquivo, plural } from "../../lib/texto.ts";
import { ponteDesktop } from "../../ponte-desktop.ts";
import { useRevisao } from "./contexto.ts";
import { textoEstimativaAcao } from "./ia.ts";
import { feitasDaIa, textoConferencia } from "./lista.ts";

export function Acompanhamento() {
  const [estado, revisao] = useRevisao();
  const [estimativa, setEstimativa] = useState<string | undefined>(undefined);
  // Cada pedido de estimativa tem a sua vez: a que chega depois de "Cancelar" não reabre o painel.
  const vez = useRef(0);
  const lista = estado.lista;
  if (lista === undefined || lista.arquivoAcompanhado === null) return null;
  const a = estado.acompanhamento;
  const nome = nomeDoArquivo(lista.arquivoAcompanhado);
  const feitas = feitasDaIa(lista);
  const ponte = ponteDesktop();

  const fecharEstimativa = () => {
    vez.current += 1;
    setEstimativa(undefined);
  };

  const pedirEstimativa = () => {
    const minha = (vez.current += 1);
    const naVez = (texto: string) => {
      if (vez.current === minha) setEstimativa(texto);
    };
    setEstimativa("");
    void Promise.all(feitas.map((v) => revisao.estimarAcao(v.chave, "revisarDeNovo")))
      .then((todas) =>
        naVez(
          textoEstimativaAcao({
            provider: todas[0]!.provider,
            tokensEntrada: todas.reduce((t, e) => t + e.tokensEntrada, 0),
            tokensSaida: todas.reduce((t, e) => t + e.tokensSaida, 0),
            segundos: todas.reduce((t, e) => t + e.segundos, 0),
            custoUsd: todas.some((e) => e.custoUsd === null) ? null : todas.reduce((t, e) => t + (e.custoUsd ?? 0), 0),
          }),
        ),
      )
      .catch(() => naVez(""));
  };

  return (
    <section
      aria-label="Acompanhamento no Word"
      className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4"
    >
      <p className="flex items-start gap-2 text-body">
        <EyeIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span>
          Acompanhando “{nome}” no Word. Cada vez que você salva, o app confere de novo, sem IA, e a lista se atualiza.
        </span>
      </p>
      <p role="status" className="text-small tabular-nums">
        {a.ultima === undefined ? (
          <span className="text-muted-foreground">Salve no Word para conferir.</span>
        ) : (
          <span className={a.ultima.tipo === "falhou" ? "text-grav-conferir-texto" : ""}>
            {textoConferencia(a.ultima, horaDe(a.ultima.em))}
          </span>
        )}
      </p>
      {a.pedeArquivo ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-small">
            Para continuar acompanhando, escolha de novo “{nome}”: depois que o app é fechado, ele pede o arquivo outra
            vez.
          </p>
          {ponte === undefined ? null : (
            <Button size="sm" variant="outline" onClick={() => void revisao.escolherAcompanhadoDeNovo()}>
              Escolher o arquivo de novo
            </Button>
          )}
        </div>
      ) : null}
      {a.erro === undefined ? null : <AvisoErro erro={a.erro} />}
      {feitas.length === 0 ? null : (
        <div className="flex flex-col items-start gap-2 border-border border-t pt-2">
          <p className="text-small">
            {plural(feitas.length, "ponto da conferência com IA marcado", "pontos da conferência com IA marcados")} como
            feito. O salvamento confere só o automático; a IA pode conferir {feitas.length === 1 ? "ele" : "eles"} de
            novo no arquivo salvo.
          </p>
          {estimativa === undefined ? (
            <Button size="sm" variant="outline" disabled={a.reconferindo || a.pedeArquivo} onClick={pedirEstimativa}>
              Reconferir com a IA
            </Button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground text-small">Um por vez, no arquivo salvo. {estimativa}</span>
              <Button
                size="sm"
                disabled={a.reconferindo || a.pedeArquivo}
                onClick={() => void revisao.reconferirComIa(feitas.map((v) => v.chave)).then(fecharEstimativa)}
              >
                {a.reconferindo ? <Spinner /> : null}{" "}
                {feitas.length === 1 ? "Reconferir" : `Reconferir os ${feitas.length}`}
              </Button>
              <Button size="sm" variant="ghost" disabled={a.reconferindo} onClick={fecharEstimativa}>
                Cancelar
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
