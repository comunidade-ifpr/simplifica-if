// Casca dos testes das regras: cada caso roda no `RuleTester` do oxlint, no próprio processo, em vez de
// um `oxlint` por caso (o harness do T3 levava ~40 s de CPU para os ~100 casos).
// Um caso inválido passa se a regra reportar pelo menos uma vez; `assertion` recebe as mensagens, uma
// por linha, no formato do oxlint (`simplifica-if(regra): mensagem`).

import type { Context, Diagnostic, Rule } from "@oxlint/plugins";
import { it } from "@effect/vitest";
import { RuleTester } from "vite-plus/lint/plugins-dev";

import plugin from "../index.ts";

RuleTester.describe = (_texto, fn) => fn();
RuleTester.it = (texto, fn) => it(texto, fn);

const tester = new RuleTester();

interface RuleHarness {
  readonly valid: (name: string, source: string) => void;
  readonly invalid: (name: string, source: string, assertion?: (output: string) => void) => void;
}

interface RuleHarnessOptions {
  readonly filename?: string;
  readonly ruleOptions?: NonNullable<RuleTester.ValidTestCase["options"]>;
}

/** A regra com o `report` interceptado: guarda toda mensagem e só repassa as que `repassar` deixar. */
const interceptar = (nome: string, regra: Rule, mensagens: Array<string>, repassar: () => boolean): Rule => {
  // O alvo do Proxy é um objeto vazio: o contexto do oxlint é congelado, e o Proxy não pode trocar
  // uma propriedade congelada do próprio alvo.
  const contexto = (alvo: Context): Context =>
    new Proxy({} as Context, {
      get(_vazio, chave) {
        if (chave !== "report") return Reflect.get(alvo, chave, alvo);
        return (diagnostico: Diagnostic) => {
          mensagens.push(`simplifica-if(${nome}): ${"message" in diagnostico ? diagnostico.message : ""}`);
          if (repassar()) alvo.report(diagnostico);
        };
      },
    });
  if ("createOnce" in regra) {
    return { ...regra, createOnce: (alvo: Context) => regra.createOnce(contexto(alvo)) };
  }
  return { ...regra, create: (alvo: Context) => regra.create(contexto(alvo)) };
};

export const createOxlintRuleHarness = (ruleName: string, options: RuleHarnessOptions = {}): RuleHarness => {
  const nomeCurto = ruleName.replace(/^simplifica-if\//u, "");
  const regra = plugin.rules[nomeCurto];
  if (regra === undefined) throw new Error(`Regra desconhecida: ${ruleName}`);
  const caso = (name: string, code: string) => ({
    name,
    code,
    filename: options.filename ?? "fixture.ts",
    ...(options.ruleOptions ? { options: options.ruleOptions } : {}),
  });

  return {
    valid(name, source) {
      tester.run(ruleName, regra, { valid: [caso(name, source)], invalid: [] });
    },
    invalid(name, source, assertion) {
      const mensagens: Array<string> = [];
      // Só a primeira mensagem vai ao RuleTester, que confere o número exato de erros (`errors: 1`).
      const interceptada = interceptar(nomeCurto, regra, mensagens, () => mensagens.length === 1);
      tester.run(ruleName, interceptada, {
        valid: [],
        invalid: [
          {
            ...caso(name, source),
            errors: 1,
            // Sem mensagem, o próprio RuleTester já falhou ("Should have 1 error"), com o erro mais claro.
            after: () => {
              if (mensagens.length > 0) assertion?.(mensagens.join("\n"));
            },
          },
        ],
      });
    },
  };
};
