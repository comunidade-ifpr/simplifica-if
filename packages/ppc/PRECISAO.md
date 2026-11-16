# Precisão dos verificadores D

Medida em 16/11/2026 (M1.11, etapa 2) nos **110 PPCs técnicos da base** (cursos de nível médio com PPC convertido em `dados/institucional/cursos`: 82 integrados, 28 subsequentes, 1 sem CNCT), com a base de normas, relações e CNCT do mesmo dia. Os números agregados estão fixados em `test/precisao-base.test.ts`: se um deles mudar, confira uma amostra dos apontamentos novos e atualize os dois juntos.

```bash
node packages/ppc/scripts/pre-conferencia.ts --base                                   # a tabela abaixo
node packages/ppc/scripts/pre-conferencia.ts --base --amostra CT-SUP-24 --estado nao_atende --n 14
node packages/ppc/scripts/pre-conferencia.ts --base --amostra CT-CURR-16 --evidencias --n 8   # os "atende"
```

Tempo: cerca de 30 ms por PPC (3,3 s nos 110), sem IA e sem rede.

## Como ler

- **PPCs**: estado da ficha em cada PPC (o pior dos apontamentos; sem apontamento, o estado do verificador).
- **Apontamentos**: quantos itens (com trecho e fonte) o verificador produziu; um PPC pode ter vários.
- **Conferido à mão**: amostra espalhada pela lista (determinística, `--amostra`), conferida no Markdown do PPC. **VP** = verdadeiro positivo, **FP** = falso positivo. "Útil" vale para `a_conferir`: o item merece a atenção da pessoa, mesmo que não seja problema.
- A base é de PPCs vigentes escritos antes da Res. CNE/CP nº 2/2026 (de 11/11/2026): é de esperar que quase todos citem norma revogada e nenhum cite a DCN da EPT nova. Esses apontamentos são verdadeiros para um PPC que vai à PROENS hoje.

## Tabela

| Ficha | Verificador | PPCs: atende / não atende / a conferir / não se aplica | Apontamentos `nao_atende` / `a_conferir` | Conferido à mão (`nao_atende`) | Mudança pela amostra |
|---|---|---|---|---|---|
| CT-IDENT-01 | `d-denominacao-cnct` | 107 / 0 / 3 / 0 | 0 / 2 | sem achado; os 2 a conferir são de conversão sem a denominação no início | — |
| CT-IDENT-08 | `d-base-legal-identidade` | 0 / 110 / 0 / 0 | 273 / 48 | revogada na identidade: 7 VP de 8 (1 FP, em seção de histórico); sem a DCN da EPT 2026: 110 de 110 VP (nenhum PPC da base a cita); sem a DCNEM: 5 de 5 VP | revogada em seção de histórico passou a a conferir |
| CT-IDENT-13 | `d-eixo-cnct` | 106 / 0 / 4 / 0 | 0 / 3 | só a conferir; dos 3: 2 divergências reais (Umuarama: "Controle e Processos Industriais" × "Produção Industrial"; Barracão: "Gestão de Negócios"), 1 texto colado pela conversão | o valor na linha seguinte ao rótulo passou a contar: de 26 a conferir para 3 |
| CT-CURR-02 | `d-carga-horaria-total` | 90 / 0 / 20 / 0 | 0 / 19 | só a conferir (extração `extraido`); 13 sem CH achada; dos 6 com outro total: 2 divergências reais (1.213 × 1.231 h; 3.401 × 3.334 h), 4 linhas da matriz com subtotal ou hora-aula (útil, a pessoa confere) | alternativas abaixo de 800 h ou na mesma linha do total deixaram de contar; PROEJA sem o mínimo de 3.000 h; de 28 para 19 |
| CT-CURR-16 | `d-requisito-ingresso` | 106 / 0 / 4 / 0 | 0 / 4 | só a conferir; `atende` conferido: 8 de 8 com a evidência certa; dos 5 a conferir olhados antes do ajuste, 3 eram formulação não reconhecida | frase em vez de linha (7 de 7 "fala em ensino médio" eram parágrafos longos sem relação); rótulo com valor na linha seguinte; "término", "formação completa no"; de 21 para 4 |
| CT-CURR-18 | `d-componentes-fgb` | 73 / 0 / 9 / 28 | 0 / 9 | só a conferir; 9 de 9 úteis (Jacarezinho organiza a FGB por área, sem componente; nomes diferentes) | tabelas de seções não curriculares deixaram de contar (um `atende` vinha da tabela de cursos do campus) |
| CT-CURR-22 | `d-aee-componente` | 107 / 3 / 0 / 0 | 3 / 0 | 3 de 3 VP (AEE como linha da matriz e com ementa de componente) | a 1ª versão apontava linhas de ementa e de bibliografia (1 PPC só por bibliografia: FP); agora a célula tem de ser o nome do AEE, e um apontamento por PPC |
| CT-SUP-09 | `d-marcos-nas-referencias` | 0 / 87 / 23 / 0 | 142 / 91 | sem a DCN da EPT 2026 nas referências: 87 de 87 VP; sem a DCNEM: 5 de 5 VP | a Lei nº 14.945/2024 ("quando pertinente") fica a conferir; 23 PPCs sem seção de referências reconhecida ficam a conferir |
| CT-SUP-12 | `d-normas-revogadas` | 3 / 103 / 4 / 0 | 320 / 120 | 10 de 10 VP (cada revogação com evidência literal em `relacoes.yaml`; nenhum desses PPCs cita a sucessora) | idem CT-IDENT-08: seção de histórico fica a conferir (13 apontamentos) |
| CT-SUP-14 | `d-cnct-e-marcos-institucionais` | 70 / 11 / 29 / 0 | 13 / 36 | 13 de 13 VP | "Catálogo Nacional **dos** Cursos Técnicos" (Paranavaí) era FP; sem PDI/PPI/Regimento, mas com resolução do CONSUP, fica a conferir ("norma institucional equivalente") |
| CT-SUP-21 | `d-legislacao-profissional` | 23 / 14 / 73 / 0 | 14 / 73 | 6 de 6 VP depois do ajuste; antes, 5 de 6 citavam o conselho profissional e as atribuições (FP relevante) | sem a lei, mas com o conselho (CFT, CRT, CRA…), fica a conferir; 37 PPCs com legislação que o registro não resolve ficam a conferir |
| CT-SUP-24 | `d-politica-assistencia-estudantil` | 0 / 14 / 96 / 0 | 14 / 96 | 14 de 14 VP (citam a 11/2009 e a 53/2011 na seção de permanência, sem a 239/2025) | sem nenhuma das três fica a conferir (96 PPCs) |

Triagem (não é ficha): nenhum texto dirigido à IA na base; 78 PPCs com ao menos uma seção do modelo não encontrada (a conferir).

**Resumo:** depois dos ajustes, nenhum falso positivo nas amostras de `nao_atende` (todos os apontamentos de CT-CURR-22, CT-SUP-14, CT-SUP-21 e CT-SUP-24; 10 a 17 por regra nas demais). Cinco regras tinham falso positivo relevante na primeira versão e foram corrigidas ou rebaixadas para `a_conferir` (CT-IDENT-08 e CT-SUP-12 em seção de histórico, CT-CURR-22, CT-SUP-14, CT-SUP-21). Cinco fichas nunca dão `nao_atende`, porque dependem de extração (CT-IDENT-01 sem denominação, CT-IDENT-13, CT-CURR-02, CT-CURR-16, CT-CURR-18).

## Limites conhecidos

- `atende` quer dizer "o código não achou o problema que procura", não "a ficha está atendida": CT-CURR-22 não vê o AEE com outro nome ("Educação Especial" com carga horária "a depender do estudante", Coronel Vivida), e CT-SUP-12 não vê citação que o resolvedor não reconhece. A tela diz "conferidos 12 de 80 critérios".
- Revogada citada sem a sucessora vira `nao_atende`, mesmo se a citação for histórica fora de uma seção de histórico; a mensagem manda conferir as regras de transição. A revogação da Res. CNE/CP nº 1/2021 depende da vigência da Res. CNE/CP nº 2/2026, ainda "a confirmar" na base (`kb vigencia`).
- CT-IDENT-08, CT-SUP-09 e CT-SUP-12 se sobrepõem (as fichas se sobrepõem): a mesma citação pode aparecer em duas fichas. Ao gerar comentários no DOCX, junte os apontamentos com o mesmo trecho.
- Não há gabarito anotado à mão de PPCs inteiros: a precisão é por amostra, sobre a base de PPCs vigentes. Falta medir num PPC escrito sob a Res. CNE/CP nº 2/2026.
