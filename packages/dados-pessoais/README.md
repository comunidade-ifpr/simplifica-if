# @simplifica-if/dados-pessoais

Detector local de dados pessoais do app Simplifica IF: procura CPF, RG, celular e e-mail fora do domínio do IFPR num texto, sem rede e sem IA. Serve a duas coisas:

- **Aviso ao anexar (M1.13):** o servidor local (`apps/server`, `pasta.conferirAnexo`) lê o arquivo escolhido num `Worker` com limites e devolve à interface quantos achados de cada tipo e onde, com os trechos mascarados. A pessoa decide: "Enviar mesmo assim" ou "Retirar o anexo".
- **"Isto está errado" (M1.12):** a interface confere o relato montado antes de enviá-lo e avisa se ele tem dado pessoal.

O detector **avisa, não bloqueia**: PPCs e normas trazem nomes, cargos e contatos de atos oficiais, e a decisão é da pessoa.

| Módulo | Papel |
|---|---|
| `src/detector.ts` | As regras, as máscaras (`529.***.***-**`, `(41) *****-**32`, `m***@g***.com`), o trecho mascarado em volta de cada achado e o resumo de um documento. Sem Node: a interface o importa. |
| `src/arquivo.ts` | O texto de um arquivo em segmentos com o lugar (`parágrafo 12`, `tabela 2, linha 5`, `linha 40`): `.docx` pelo `@simplifica-if/docx` (com `LIMITES_PADRAO`), `.md`, `.txt`, `.csv`, `.json`. Os demais saem "não conferido", com o motivo. |
| `scripts/medir-ppcs.ts` | A medição contra os PPCs da base. |

## Regras

| Tipo | Conta quando |
|---|---|
| CPF | `000.000.000-00` com os dois dígitos verificadores válidos (e não todos iguais). Outra grafia (`00000000000`, `000000000-00`) só com "CPF" logo antes: onze dígitos com DV válido aparecem por acaso em 1 de cada 100 números. |
| RG | Só com "RG", "R.G.", "Registro Geral" ou "Carteira/Cédula de Identidade" logo antes, e de 5 a 13 dígitos (não há formato nacional nem dígito conferível). |
| Celular | Nove dígitos começando por 9, com DDD que existe (entre parênteses, com `+55` ou sem parênteses) ou, sem DDD, logo depois de "telefone", "fone", "celular", "WhatsApp" ou "contato". |
| E-mail | Todo endereço fora de `ifpr.edu.br` e dos subdomínios dele. |

Ficam de fora, por exigirem fronteira de número dos dois lados: processo SEI (`23411.012345/2024-12`), CNPJ, SIAPE, datas, CEP, códigos de curso, cargas horárias e números de portaria. **Telefone fixo não conta:** nos PPCs ele é o do campus, da secretaria ou de órgão parceiro (ver a medição).

## Medição nos PPCs da base (17/11/2026)

`node packages/dados-pessoais/scripts/medir-ppcs.ts` sobre os 202 PPCs convertidos de `base-conhecimento/institucional/ifpr/ppcs/` (o script imprime só contagens; com `--amostras`, as formas mascaradas, sem o trecho em volta):

| | Achados | PPCs | % dos PPCs |
|---|---:|---:|---:|
| CPF | 26 | 4 | 2,0% |
| RG | 26 | 3 | 1,5% |
| Celular | 42 | 29 | 14,4% |
| E-mail fora do IFPR | 13 | 4 | 2,0% |
| **Algum aviso** | 107 | **35** | **17,3%** |

- **CPF e RG:** conferidos pelo rótulo antes do número (sem expor o valor), são verdadeiros: os PPCs trazem "carteira de identidade nº … e CPF nº …" (ou "portador do RG nº …") de pessoas, em declarações e termos dentro do PPC publicado. Vale a curadoria olhar esses PPCs.
- **E-mail:** endereços de instituições parceiras de estágio (hospitais, outras instituições de ensino). Pela regra, contam; a pessoa decide.
- **Celular:** números de coordenação ou de contato pessoal; não há como separar sem o contexto.
- **Com o telefone fixo**, os avisos iriam a 61,4% dos PPCs (244 telefones, 200 deles fixos, quase todos do campus). Um aviso que aparece quase sempre deixa de ser lido; por isso o fixo ficou de fora.

## Limites conhecidos

- No `.docx`, só o corpo do documento: cabeçalho, rodapé, notas e comentários do Word não são lidos.
- PDF, planilhas, apresentações, ODF e imagens não são conferidos (não há leitor de PDF no repositório); a interface diz que o arquivo não foi conferido.
- Nomes de pessoas, endereços, matrículas, notas e laudos não são detectados: o aviso de uso (M1.8) continua sendo a orientação principal.
- O RG depende do rótulo; um RG solto não é achado. O CPF sem formato também.

```bash
pnpm --filter @simplifica-if/dados-pessoais test
node packages/dados-pessoais/scripts/medir-ppcs.ts
```
