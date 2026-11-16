# Precisão dos verificadores D

Medida nos **110 PPCs técnicos da base** (cursos de nível médio com PPC convertido em `dados/institucional/cursos`: 82 integrados, 28 subsequentes, 1 sem CNCT), com a base de normas, relações, transições e CNCT do dia, e a vigência na `data_referencia` de `base-conhecimento/config/vigencia.yaml` (13/11/2026). Primeira medição em 16/11/2026; refeita no mesmo dia depois da revisão independente (transição da Res. CNE/CP nº 2/2026, cadeia de sucessoras, ficha responsável pelo marco, CNCT grudado, comentários agrupados).

```bash
node packages/ppc/scripts/pre-conferencia.ts --base            # a tabela abaixo (cerca de 30 ms por PPC)
node packages/ppc/scripts/pre-conferencia.ts --base --check    # confere os números com scripts/precisao-base.json
node packages/ppc/scripts/pre-conferencia.ts --base --gravar   # registra os números novos (depois de conferir uma amostra)
node packages/ppc/scripts/pre-conferencia.ts --base --amostra CT-SUP-12 --estado nao_atende --n 12 --deslocamento 7
node packages/ppc/scripts/pre-conferencia.ts --base --amostra CT-CURR-16 --evidencias --n 8   # os "atende"
```

**Os números exatos não estão no `pnpm test`**: dependem de `dados/` e `base-conhecimento/`, e um PPC, uma norma ou uma relação nova (ou registrar a publicação da Res. CNE/CP nº 2/2026 no DOU) os muda legitimamente. Quem mexer nos verificadores roda `--check`; se mudou, confere uma amostra dos apontamentos novos e grava os dois juntos (`--gravar` e esta tabela). O `pnpm test` (`test/precisao-base.test.ts`) confere só invariantes, que valem com qualquer base: todo trecho é literal da linha, toda fonte resolve (norma no registro, curso no CNCT) e nenhum `nao_atende` vem de norma com vigência a confirmar nem de citação de confiança menor.

## Regras de vigência (depois da revisão)

- **Vigência na data, do `kb`** (`statusEm`), com uma tolerância: o `kb` marca "a confirmar" toda norma sem a data de publicação registrada, inclusive a Res. CONSUP/IFPR nº 190/2024, assinada dois anos e meio antes. O verificador só trata como incerta a data "a confirmar" cujo efeito mínimo (a assinatura) cai a menos de **180 dias** da data de referência: hoje, a Res. CNE/CP nº 2/2026 (assinada em 11/11/2026), a revogação da 1/2021 e da 1/2014 por ela. Efeito "a confirmar" mais antigo vale como presumido (a falta do dado não é incerteza jurídica). `src/verificadores/vigencia.ts`.
- **Transição.** Revogação incerta, ou norma revogada com transição em curso que a preserva (prazo de adequação, faculdade de adequação, ressalva de revogação: arts. 70 e 71 da 2/2026; art. 42 da 2/2024 para a 3/2018), sai `a_conferir`, com o texto da transição e o critério da ficha: PPC elaborado antes da vigência atende, com recomendação de atualização. A ausência da 2/2026 nunca é `nao_atende` enquanto ela estiver a confirmar.
- **Revogação recente sem transição (16/11/2026, decisão da revisão).** Revogação total com menos de 12 meses na data de referência e sem regra de transição registrada sai `a_conferir` quando pode ser posterior ao PPC: posterior à data dele (`dataPpc`; na base, o `ano_documento` do curso, tomado como o fim do ano) ou, sem a data, sempre. Mensagem: "Cita …, revogada em <data> pela …. Se o PPC foi elaborado antes dessa data, pode manter a citação; recomenda-se atualizar." Revogação mais antiga continua `nao_atende`: o PPC revisto agora já devia citar a sucessora. Medido nos 110 PPCs: **27 apontamentos** de CT-SUP-12 passaram de `nao_atende` para `a_conferir` (todas revogações pela Res. CONSUP/IFPR nº 271/2026, de 04/02/2026: 39/2012, 13/2011, 2/2014 e outras; Ivaiporã, PPC de 2024, entre eles) e **1 PPC** mudou de estado (93 → 92 com `nao_atende`). A leitura sem o limite de 12 meses ("posterior à data do PPC", só) levaria a CT-SUP-12 de 93 para 18 PPCs com `nao_atende` (198 → 22 apontamentos), porque quase todo PPC da base é anterior à revogação que cita; ficou de fora.
- **Quem eleva.** Só a ficha responsável pelo marco (`fichas_responsaveis` de `marcos-normativos.json`; fora de marco, CT-SUP-12) dá `nao_atende`; CT-IDENT-08 e CT-SUP-09, fichas de base legal, registram o mesmo fato como `a_conferir`. CT-SUP-24 é a responsável pela 11/2009 e pela 53/2011; CT-SUP-12 as registra.
- **Cadeia.** Qualquer sucessora da cadeia citada (a 1/2021 para a 6/2012, mesmo revogada) torna a revogada `a_conferir`; a mensagem nomeia a sucessora direta e a atual ("Res. CNE/CP nº 1/2021, hoje sucedida pela Res. CNE/CP nº 2/2026").
- **Comentários.** `achadosParaComentarios` junta os apontamentos do mesmo trecho (ou, sem trecho, da mesma norma ausente) num item, com `fichas` e a gravidade da ficha que dá `nao_atende`. Nos 110 PPCs: 1.294 apontamentos viram 972 comentários (310 com mais de uma ficha); antes, 142 trechos tinham dois comentários; agora, nenhum.

## Tabela

PPCs: atende / não atende / a conferir / não se aplica. Apontamentos: `nao_atende` / `a_conferir`. **VP** = verdadeiro positivo, **FP** = falso positivo.

| Ficha | Verificador | PPCs, antes → depois | Apontamentos, antes → depois | Amostra conferida à mão (`nao_atende`) |
|---|---|---|---|---|
| CT-IDENT-01 | `d-denominacao-cnct` | 107/0/3/0 → igual | 0/2 → igual | sem achado; os 2 a conferir são de conversão sem a denominação no início |
| CT-IDENT-08 | `d-base-legal-identidade` | 0/110/0/0 → **0/0/110/0** | 273/48 → **0/321** | só registra (ficha de base legal); 1ª amostra: 7 de 8 VP na revogada, 1 FP em seção de histórico (corrigido) |
| CT-IDENT-13 | `d-eixo-cnct` | 106/0/4/0 → igual | 0/3 → igual | só a conferir: 2 divergências reais, 1 texto colado pela conversão |
| CT-CURR-02 | `d-carga-horaria-total` | 90/0/20/0 → igual | 0/19 → igual | só a conferir (extração); a mensagem diz que o art. 29, § 2º da 2/2026 está com vigência a confirmar |
| CT-CURR-16 | `d-requisito-ingresso` | 106/0/4/0 → igual | 0/4 → igual | só a conferir; `atende`: 8 de 8 com a evidência certa |
| CT-CURR-18 | `d-componentes-fgb` | 73/0/9/28 → igual | 0/9 → igual | só a conferir; 9 de 9 úteis (FGB por área, nomes diferentes) |
| CT-CURR-22 | `d-aee-componente` | 107/3/0/0 → igual | 3/0 → igual | 3 de 3 VP |
| CT-SUP-09 | `d-marcos-nas-referencias` | 0/87/23/0 → **0/0/110/0** | 142/91 → **0/233** | as DCN são marcos da CT-SUP-12: aqui só registro; a LDB, que daria `nao_atende`, está nas referências de todos os PPCs com a seção reconhecida |
| CT-SUP-12 | `d-normas-revogadas` | 3/103/4/0 → 0/93/17/0 → **0/92/18/0** | 320/120 → 198/257 → **171/284** | 1ª amostra (deslocamento 0): 10 de 10 VP; **amostra nova (deslocamento 7): 12 de 12 VP** (54/2011, 13/2011, 2/2014, 6/2012 sem a 1/2021 nem a 2/2026; 2 PPCs integrados sem nenhuma norma da linha da DCNEM) |
| CT-SUP-14 | `d-cnct-e-marcos-institucionais` | 70/11/29/0 → igual | 13/36 → **12/36** | 1ª amostra: 13 de 13; **amostra nova: os 12, todos VP** (Campo Largo, "CatalogoNacional dosCursosTécnicos", deixou de ser apontado pelo CNCT) |
| CT-SUP-21 | `d-legislacao-profissional` | 23/14/73/0 → igual | 14/73 → igual | 1ª amostra: 6 de 6; **amostra nova (deslocamento 1): 7 de 7 VP** (Jaguariaíva diz "Registro profissional: não se aplica") |
| CT-SUP-24 | `d-politica-assistencia-estudantil` | 0/14/96/0 → igual | 14/96 → igual | os 14, todos VP |

O que mudou em CT-SUP-12, por norma (apontamentos): a 1/2021 (37) e a 1/2014 (15) passaram de `nao_atende` para `a_conferir` (revogação pela 2/2026, a confirmar, com a transição dos arts. 70 e 71); a 3/2018 (29), pela transição do art. 42 da 2/2024; a 11/2009 (18) e a 53/2011 (12), porque a responsável é a CT-SUP-24; a 6/2012 com a 1/2021 citada (15), pela cadeia. Ficaram `nao_atende`: 54/2011 (86), 6/2012 sem sucessora citada (60), 36/2019 (11), 13/2011 (8), 39/2012 (7), 2/2014 (7), Portaria PROENS nº 26/2021 (5) e outras (depois, as revogadas pela 271/2026, como a 13/2011, a 39/2012 e a 2/2014, passaram a `a_conferir` pela regra da revogação recente: 27 apontamentos); e, novo, 9 PPCs integrados que não citam nenhuma norma da linha da DCNEM.

Triagem (não é ficha): nenhum texto dirigido à IA na base; 78 PPCs com ao menos uma seção do modelo não encontrada (a conferir).

**Resumo:** nenhum falso positivo nas amostras de `nao_atende`, nas duas medições. `nao_atende` sai hoje de cinco fichas (CT-SUP-12, CT-SUP-14, CT-SUP-21, CT-SUP-24, CT-CURR-22); as outras sete só registram ou dependem de extração.

## Limites conhecidos

- `atende` quer dizer "o código não achou o problema que procura", não "a ficha está atendida": CT-CURR-22 não vê o AEE com outro nome ("Educação Especial" com carga horária "a depender do estudante", Coronel Vivida), e CT-SUP-12 não vê citação que o resolvedor não reconhece. A tela diz "conferidos 12 de 80 critérios".
- O código não sabe a data do PPC (capa, histórico, processo): por isso a transição da 2/2026 fica a conferir, e não `atende` com recomendação. Quando a publicação no DOU for registrada e os 180 dias passarem, a 1/2021 volta a ser pendência na CT-SUP-12, e os números mudam (`--check`).
- Revogada citada sem a sucessora vira `nao_atende`, mesmo se a citação for histórica fora de uma seção de histórico.
- O rótulo de seção de um trecho pode vir errado quando a segmentação toma uma linha numerada por título (ex.: `pitanga/tecnico-em-desenvolvimento-de-sistemas`, linha 2294, na "seção" "1 ) Aprovação em Processo Seletivo…"). O trecho e a linha estão certos; só o rótulo, que vem do `kb` (`segmentarPpc`), não foi corrigido aqui.
- Não há gabarito anotado à mão de PPCs inteiros: a precisão é por amostra, sobre a base de PPCs vigentes. Falta medir num PPC escrito sob a Res. CNE/CP nº 2/2026.
