# Mapa de fichas da revisão de PPC

Este mapa organiza as fichas por tópicos semânticos, sem depender da numeração das seções do PPC.
A numeração observada em um PPC específico deve ser detectada na rodada de análise, não codificada na ficha.

Gerado em: 2026-11-16T15:42:32+00:00

## Como usar

- Use os tópicos para localizar rapidamente quais fichas tratam de estágio, avaliação, AEE, infraestrutura, referências e outros temas.
- Use `aliases_titulo` e `termos_busca` de `topicos-fichas.json` para localizar a seção correspondente mesmo quando o PPC usar outro título ou outra numeração.
- Fichas transversais aparecem em tópicos próprios ou em mais de um tópico quando ajudam a cruzar seções.

## Execução no app

O campo `execucao` de cada ficha diz como ela roda na revisão do app (M1.11): `D`, só código, com verificador em `packages/ppc/src/verificadores`; `S`, o código acha o trecho e a IA confirma; `J`, julgamento da IA sobre as seções.

- `D` (12): `CT-CURR-02`, `CT-CURR-16`, `CT-CURR-18`, `CT-CURR-22`, `CT-IDENT-01`, `CT-IDENT-08`, `CT-IDENT-13`, `CT-SUP-09`, `CT-SUP-12`, `CT-SUP-14`, `CT-SUP-21`, `CT-SUP-24`
- `S` (38): `CT-CURR-01`, `CT-CURR-03`, `CT-CURR-05`, `CT-CURR-06`, `CT-CURR-10`, `CT-CURR-11`, `CT-CURR-13`, `CT-CURR-15`, `CT-CURR-17`, `CT-CURR-20`, `CT-CURR-21`, `CT-CURR-23`, `CT-CURR-26`, `CT-CURR-27`, `CT-IDENT-02`, `CT-IDENT-09`, `CT-IDENT-11`, `CT-IDENT-14`, `CT-IDENT-15`, `CT-IDENT-16`, `CT-IDENT-17`, `CT-IDENT-18`, `CT-IDENT-19`, `CT-SUP-01`, `CT-SUP-02`, `CT-SUP-03`, `CT-SUP-04`, `CT-SUP-06`, `CT-SUP-08`, `CT-SUP-10`, `CT-SUP-11`, `CT-SUP-13`, `CT-SUP-16`, `CT-SUP-18`, `CT-SUP-22`, `CT-SUP-23`, `CT-SUP-25`, `CT-SUP-26`
- `J` (30): `CT-CURR-04`, `CT-CURR-07`, `CT-CURR-08`, `CT-CURR-09`, `CT-CURR-12`, `CT-CURR-14`, `CT-CURR-19`, `CT-CURR-24`, `CT-CURR-25`, `CT-IDENT-03`, `CT-IDENT-04`, `CT-IDENT-05`, `CT-IDENT-06`, `CT-IDENT-07`, `CT-IDENT-10`, `CT-IDENT-12`, `CT-SUP-05`, `CT-SUP-07`, `CT-SUP-15`, `CT-SUP-17`, `CT-SUP-19`, `CT-SUP-20`, `CT-TRANS-01`, `CT-TRANS-02`, `CT-TRANS-03`, `CT-TRANS-04`, `CT-TRANS-05`, `CT-TRANS-06`, `CT-TRANS-07`, `CT-TRANS-08`

## Avaliação institucional

### Avaliação do PPC e acompanhamento de egressos

Agrupa fichas que verificam avaliação periódica do projeto pedagógico, acompanhamento de egressos, revisão curricular e retroalimentação institucional.

- Tipo de escopo: `tematico`
- Aliases de título: `avaliação do PPC`, `avaliação do curso`, `acompanhamento de egressos`, `autoavaliação`
- Termos de busca: `egresso`, `autoavaliação`, `avaliação do PPC`, `revisão curricular`, `CPA`, `acompanhamento`, `indicadores`

- `CT-SUP-08` (OBRIG, suporte, S) - Avaliação periódica do PPC e acompanhamento de egressos
- `CT-IDENT-18` (OBRIG, identidade, S) - Acompanhamento de egressos previsto com finalidade formativa
- `CT-TRANS-05` (BLOQ, transversal, J) - Riscos globais e ajustes prioritários

## Condições de oferta

### Corpo docente, equipe técnica e gestão do curso

Organiza fichas sobre docentes, titulação, habilitação, coordenação, colegiado/NDE equivalente, equipe pedagógica e capacidade de gestão da oferta.

- Tipo de escopo: `tematico`
- Aliases de título: `corpo docente`, `equipe técnica`, `gestão do curso`, `coordenação do curso`, `colegiado`
- Termos de busca: `docente`, `professor`, `titulação`, `habilitação`, `coordenação`, `colegiado`, `equipe pedagógica`, `técnicos administrativos`

- `CT-SUP-05` (OBRIG, suporte, J) - Corpo docente compatível com a oferta formativa
- `CT-SUP-06` (OBRIG, suporte, S) - Governança acadêmica do curso
- `CT-SUP-15` (OBRIG, suporte, J) - Habilitação docente compatível com os componentes da oferta
- `CT-SUP-16` (OBRIG, suporte, S) - Quantitativo e disponibilidade docente sustentam a oferta
- `CT-SUP-17` (OBRIG, suporte, J) - Formação pedagógica e desenvolvimento docente previstos
- `CT-SUP-23` (OBRIG, suporte, S) - Coordenação do curso com atribuições, regime e participação institucional explicitados
- `CT-TRANS-04` (BLOQ, transversal, J) - Coerência entre currículo, corpo docente e infraestrutura

### Infraestrutura, laboratórios e acervo

Reúne fichas sobre espaços físicos, laboratórios, equipamentos, biblioteca, acervo, acessibilidade espacial e suficiência da infraestrutura.

- Tipo de escopo: `tematico`
- Aliases de título: `infraestrutura`, `laboratórios`, `biblioteca`, `acervo`, `instalações físicas`
- Termos de busca: `laboratório`, `equipamento`, `biblioteca`, `acervo`, `sala de aula`, `infraestrutura`, `acessibilidade física`

- `CT-SUP-07` (OBRIG, suporte, J) - Infraestrutura compatível com os componentes formativos
- `CT-SUP-11` (REC, suporte, S) - Acessibilidade física e arquitetônica
- `CT-SUP-22` (OBRIG, suporte, S) - Infraestrutura mínima CNCT atendida ou justificada
- `CT-SUP-25` (OBRIG, suporte, S) - Biblioteca descrita com acessibilidade física e condições de acesso
- `CT-TRANS-04` (BLOQ, transversal, J) - Coerência entre currículo, corpo docente e infraestrutura
- `CT-TRANS-07` (REC, transversal, J) - Dimensionamento de vagas compatível com infraestrutura e interesse público

## Fundamentação normativa

### Referências, base legal e normas institucionais

Concentra fichas que conferem fundamentação legal, vigência normativa, referências bibliográficas/normativas e coerência com atos institucionais.

- Tipo de escopo: `multitematico`
- Aliases de título: `base legal`, `fundamentação legal`, `referências`, `referências normativas`, `legislação`
- Termos de busca: `lei`, `resolução`, `portaria`, `parecer`, `norma`, `referências`, `DCNEPT`, `DCN da EPT`, `DCNEM`, `CNCT`, `IFPR`

- `CT-IDENT-08` (OBRIG, identidade, D) - Base legal atualizada nas seções de identidade
- `CT-IDENT-19` (OBRIG, identidade, S) - Registro profissional descrito com conselho e base aplicável
- `CT-SUP-09` (OBRIG, suporte, D) - Referências com vigência normativa observável
- `CT-SUP-12` (OBRIG, suporte, D) - Referências com vigência normativa atualizada
- `CT-SUP-13` (OBRIG, suporte, S) - Referências com aderência formal mínima à ABNT
- `CT-SUP-14` (OBRIG, suporte, D) - Referências institucionais e referenciais essenciais do curso
- `CT-SUP-21` (OBRIG, suporte, D) - Legislação profissional CNCT tratada quando aplicável
- `CT-SUP-24` (OBRIG, suporte, D) - Política de assistência estudantil adequada à Resolução CONSUP/IFPR nº 239/2025
- `CT-TRANS-06` (REC, transversal, J) - Síntese argumentativa para a conclusão da revisão

## Identidade do curso

### Identificação e características da oferta

Localiza fichas sobre denominação, eixo tecnológico, forma de oferta, carga horária, duração, modalidade, turno, vagas e requisitos de acesso.

- Tipo de escopo: `tematico`
- Aliases de título: `identificação do curso`, `características do curso`, `dados do curso`, `apresentação do curso`, `oferta do curso`
- Termos de busca: `denominação`, `eixo tecnológico`, `forma de oferta`, `modalidade`, `vagas`, `turno`, `carga horária`, `duração`, `requisitos de acesso`, `formato de oferta`, `semipresencial`, `a distância`, `prazo de integralização`

- `CT-IDENT-01` (OBRIG, identidade, D) - Denominação do curso alinhada ao CNCT
- `CT-IDENT-02` (OBRIG, identidade, S) - Coerência da apresentação institucional do curso
- `CT-IDENT-09` (REC, identidade, S) - Modalidade coerente com a narrativa do PPC
- `CT-IDENT-13` (OBRIG, identidade, D) - Eixo tecnológico compatível com o CNCT
- `CT-IDENT-16` (OBRIG, identidade, S) - Forma de ingresso e política institucional de acesso explicitadas
- `CT-IDENT-17` (OBRIG, identidade, S) - Política de cotas referenciada sem desatualização ou erro material
- `CT-CURR-02` (BLOQ, curriculo, D) - Carga horária total apresentada com consistência
- `CT-CURR-16` (OBRIG, curriculo, D) - Pré-requisitos de ingresso compatíveis com o CNCT
- `CT-CURR-23` (OBRIG, curriculo, S) - Distribuição semanal das aulas e contraturnos explicitada
- `CT-TRANS-07` (REC, transversal, J) - Dimensionamento de vagas compatível com infraestrutura e interesse público
- `CT-CURR-27` (OBRIG, curriculo, S) - Formato de oferta e carga horária não presencial compatíveis com as DCN da EPT

### Justificativa, objetivos e demanda social

Agrupa fichas que avaliam justificativa institucional, demanda regional, objetivos geral/específicos e coerência entre finalidade do curso e percurso formativo.

- Tipo de escopo: `tematico`
- Aliases de título: `justificativa`, `objetivos`, `objetivo geral`, `objetivos específicos`, `demanda social`
- Termos de busca: `demanda`, `arranjo produtivo`, `desenvolvimento regional`, `objetivo geral`, `objetivos específicos`, `finalidade do curso`

- `CT-IDENT-03` (OBRIG, identidade, J) - Justificativa baseada em demanda territorial e formativa
- `CT-IDENT-04` (OBRIG, identidade, J) - Objetivos formativos claros e operacionais
- `CT-TRANS-01` (BLOQ, transversal, J) - Coerência entre objetivos, perfil do egresso e matriz
- `CT-TRANS-05` (BLOQ, transversal, J) - Riscos globais e ajustes prioritários

### Perfil do egresso, competências e mundo do trabalho

Conecta perfil profissional, competências, campos de atuação, Catálogo Nacional de Cursos Técnicos, verticalização e aderência ao mundo do trabalho.

- Tipo de escopo: `multitematico`
- Aliases de título: `perfil do egresso`, `perfil profissional`, `competências profissionais`, `campo de atuação`, `mundo do trabalho`
- Termos de busca: `competências`, `perfil profissional de conclusão`, `campo de atuação`, `ocupações`, `CNCT`, `verticalização`, `mundo do trabalho`

- `CT-IDENT-07` (OBRIG, identidade, J) - Perfil do egresso descrito com competências e atuação
- `CT-IDENT-10` (OBRIG, identidade, J) - Competências do egresso alinhadas à habilitação profissional
- `CT-IDENT-11` (OBRIG, identidade, S) - Campos de atuação profissional do egresso estão explicitados
- `CT-IDENT-12` (OBRIG, identidade, J) - Perfil do egresso redigido com clareza e especificidade
- `CT-IDENT-14` (OBRIG, identidade, S) - Ocupações CBO compatíveis com a identidade profissional
- `CT-IDENT-15` (OBRIG, identidade, S) - Diploma técnico explicita habilitação profissional e eixo tecnológico
- `CT-IDENT-18` (OBRIG, identidade, S) - Acompanhamento de egressos previsto com finalidade formativa
- `CT-IDENT-19` (OBRIG, identidade, S) - Registro profissional descrito com conselho e base aplicável
- `CT-CURR-04` (BLOQ, curriculo, J) - Componentes curriculares alinhados ao perfil profissional
- `CT-CURR-25` (OBRIG, curriculo, J) - Campos de estágio e equivalência coerentes com o perfil profissional
- `CT-SUP-21` (OBRIG, suporte, D) - Legislação profissional CNCT tratada quando aplicável
- `CT-TRANS-01` (BLOQ, transversal, J) - Coerência entre objetivos, perfil do egresso e matriz
- `CT-TRANS-08` (OBRIG, transversal, J) - Coerência teórico-prática entre concepção, perfil e matriz

## Organização curricular

### Aproveitamento, certificação intermediária e trabalho final

Reúne fichas sobre aproveitamento de estudos, certificação intermediária, terminalidade, trabalho final ou instrumentos equivalentes quando previstos.

- Tipo de escopo: `condicional`
- Aliases de título: `aproveitamento de estudos`, `certificação intermediária`, `terminalidade`, `trabalho final de curso`, `TFC`
- Termos de busca: `aproveitamento`, `certificação`, `terminalidade`, `trabalho final`, `TFC`, `certificado intermediário`, `competências já desenvolvidas`

- `CT-CURR-13` (OBRIG, curriculo, S) - Aproveitamento de estudos com critérios e procedimento definidos
- `CT-CURR-14` (OBRIG, curriculo, J) - Projeto final, TCC/TFC ou componente equivalente disciplinado quando previsto
- `CT-CURR-15` (REC, curriculo, S) - Certificação de conhecimentos anteriores tratada, quando aplicável
- `CT-CURR-17` (REC, curriculo, S) - Itinerários formativos coerentes com o CNCT

### Ementário, bibliografias e conteúdos

Localiza fichas que analisam ementas, objetivos de componentes, conteúdos, bibliografia básica/complementar e atualização do acervo.

- Tipo de escopo: `tematico`
- Aliases de título: `ementário`, `ementas`, `bibliografia`, `bibliografias`, `programas dos componentes`
- Termos de busca: `ementa`, `conteúdo programático`, `bibliografia básica`, `bibliografia complementar`, `acervo`, `livros`

- `CT-CURR-05` (BLOQ, curriculo, S) - Ementas completas e auditáveis
- `CT-CURR-06` (OBRIG, curriculo, S) - Bibliografia básica e complementar minimamente suficiente
- `CT-SUP-13` (OBRIG, suporte, S) - Referências com aderência formal mínima à ABNT
- `CT-TRANS-03` (BLOQ, transversal, J) - Coerência interna entre ementas e bibliografias do currículo

### Estágio curricular

Agrupa fichas que avaliam decisão de obrigatoriedade, carga horária, convênios, campos pretendidos, orientação, supervisão e coerência normativa do estágio.

- Tipo de escopo: `condicional`
- Aliases de título: `estágio`, `estágio curricular`, `estágio obrigatório`, `estágio não obrigatório`, `prática de estágio`
- Termos de busca: `estágio`, `termo de compromisso`, `plano de estágio`, `orientação de estágio`, `supervisão de estágio`, `concedente`, `agente de integração`, `convênio`

- `CT-CURR-20` (OBRIG, curriculo, S) - Decisão sobre estágio e carga horária compatíveis com o CNCT
- `CT-CURR-21` (OBRIG, curriculo, S) - Convênios e trâmites de estágio descritos quando houver estágio
- `CT-CURR-24` (OBRIG, curriculo, J) - Organização pedagógica e orientação do estágio obrigatório
- `CT-CURR-25` (OBRIG, curriculo, J) - Campos de estágio e equivalência coerentes com o perfil profissional

### Matriz curricular, integralização e componentes

Abrange estrutura curricular, carga horária, distribuição por período, componentes obrigatórios, atividades, integralização e coerência da matriz.

- Tipo de escopo: `tematico`
- Aliases de título: `organização curricular`, `matriz curricular`, `estrutura curricular`, `itinerário formativo`, `integralização curricular`
- Termos de busca: `matriz`, `componentes curriculares`, `carga horária`, `integralização`, `período`, `semestre`, `ano`, `atividade curricular`

- `CT-CURR-01` (BLOQ, curriculo, S) - Matriz curricular estruturada e legível
- `CT-CURR-02` (BLOQ, curriculo, D) - Carga horária total apresentada com consistência
- `CT-CURR-03` (BLOQ, curriculo, S) - Distribuição entre formação geral e formação técnica
- `CT-CURR-04` (BLOQ, curriculo, J) - Componentes curriculares alinhados ao perfil profissional
- `CT-CURR-07` (OBRIG, curriculo, J) - Progressão formativa e organização por períodos
- `CT-CURR-10` (OBRIG, curriculo, S) - Representação gráfica coerente com a organização curricular
- `CT-CURR-12` (OBRIG, curriculo, J) - Progressão formativa explicitada na organização curricular
- `CT-CURR-16` (OBRIG, curriculo, D) - Pré-requisitos de ingresso compatíveis com o CNCT
- `CT-CURR-18` (OBRIG, curriculo, D) - Componentes obrigatórios e conteúdos legais da FGB contemplados
- `CT-CURR-19` (OBRIG, curriculo, J) - Integração curricular e práticas profissionais articuladas
- `CT-CURR-23` (OBRIG, curriculo, S) - Distribuição semanal das aulas e contraturnos explicitada
- `CT-TRANS-03` (BLOQ, transversal, J) - Coerência interna entre ementas e bibliografias do currículo
- `CT-TRANS-04` (BLOQ, transversal, J) - Coerência entre currículo, corpo docente e infraestrutura
- `CT-CURR-27` (OBRIG, curriculo, S) - Formato de oferta e carga horária não presencial compatíveis com as DCN da EPT

## Projeto pedagógico

### Avaliação do processo de ensino-aprendizagem

Organiza fichas voltadas a critérios, instrumentos, recuperação, avaliação contínua, coerência metodológica e tratamento de necessidades educacionais específicas.

- Tipo de escopo: `tematico`
- Aliases de título: `avaliação`, `avaliação da aprendizagem`, `avaliação do processo de ensino-aprendizagem`, `recuperação de estudos`, `progressão parcial`, `regime de dependência`
- Termos de busca: `avaliação`, `instrumentos avaliativos`, `critérios`, `recuperação`, `progressão`, `progressão parcial`, `dependência`, `regime de dependência`, `conselho de classe`, `necessidades educacionais específicas`

- `CT-SUP-01` (OBRIG, suporte, S) - Sistema de avaliação coerente com o IFPR
- `CT-SUP-02` (OBRIG, suporte, S) - Frequência mínima e recuperação da aprendizagem
- `CT-SUP-26` (OBRIG, suporte, S) - Progressão parcial e dependência descritas conforme a forma de oferta
- `CT-TRANS-02` (BLOQ, transversal, J) - Coerência entre concepção, metodologias e avaliação

### Concepção pedagógica e metodologias

Reúne fichas sobre concepção de Educação Profissional e Tecnológica, integração entre teoria e prática, metodologias, práticas profissionais e coerência pedagógica.

- Tipo de escopo: `tematico`
- Aliases de título: `concepção do curso`, `concepção pedagógica`, `metodologia`, `metodologias de ensino`, `práticas profissionais`
- Termos de busca: `trabalho como princípio educativo`, `pesquisa como princípio pedagógico`, `integração teoria prática`, `metodologias`, `prática profissional`, `projeto integrador`

- `CT-IDENT-05` (OBRIG, identidade, J) - Concepção de EPT explicitada
- `CT-IDENT-06` (OBRIG, identidade, J) - Formação integral e princípios norteadores
- `CT-CURR-08` (OBRIG, curriculo, J) - Metodologias e integração curricular compatíveis com a proposta
- `CT-TRANS-02` (BLOQ, transversal, J) - Coerência entre concepção, metodologias e avaliação
- `CT-TRANS-08` (OBRIG, transversal, J) - Coerência teórico-prática entre concepção, perfil e matriz

### Temas transversais, cidadania e direitos humanos

Reúne fichas sobre educação política, direitos da cidadania, direitos humanos, educação ambiental, relações étnico-raciais, cultura afro-brasileira/indígena, diversidade e formação cidadã.

- Tipo de escopo: `transversal`
- Aliases de título: `temas transversais`, `direitos humanos`, `educação ambiental`, `relações étnico-raciais`, `diversidade`, `educação política`, `direitos da cidadania`, `realidade social e política`
- Termos de busca: `direitos humanos`, `educação ambiental`, `relações étnico-raciais`, `história e cultura afro-brasileira`, `história e cultura indígena`, `diversidade`, `educação política`, `direitos da cidadania`, `realidade social e política`, `democracia`, `participação política`

- `CT-CURR-11` (REC, curriculo, S) - Temas transversais e formação cidadã no currículo
- `CT-CURR-26` (OBRIG, curriculo, S) - Educação política e direitos da cidadania no currículo
- `CT-SUP-10` (REC, suporte, S) - Políticas transversais de atendimento e diversidade

## Suporte ao estudante

### AEE, acessibilidade e inclusão

Agrupa fichas sobre atendimento educacional especializado, AICE, adaptação, flexibilização, acessibilidade física/pedagógica/comunicacional e inclusão.

- Tipo de escopo: `multitematico`
- Aliases de título: `atendimento educacional especializado`, `AEE`, `acessibilidade`, `inclusão`, `necessidades educacionais específicas`
- Termos de busca: `AEE`, `AICE`, `adaptação curricular`, `flexibilização`, `acessibilidade`, `inclusão`, `NAPNE`, `tecnologia assistiva`

- `CT-CURR-09` (OBRIG, curriculo, J) - Inclusão, AEE e flexibilização curricular articulados ao currículo
- `CT-CURR-22` (BLOQ, curriculo, D) - AEE não incorporado como componente curricular da matriz ou do histórico
- `CT-SUP-04` (OBRIG, suporte, S) - Inclusão, acessibilidade e AEE na política de atendimento
- `CT-SUP-10` (REC, suporte, S) - Políticas transversais de atendimento e diversidade
- `CT-SUP-11` (REC, suporte, S) - Acessibilidade física e arquitetônica
- `CT-SUP-18` (OBRIG, suporte, S) - Política institucional de inclusão com papéis e normativas definidos
- `CT-SUP-19` (OBRIG, suporte, J) - AEE tratado com procedimentos e público-alvo compatíveis, quando aplicável
- `CT-SUP-20` (OBRIG, suporte, J) - Recursos de acessibilidade e medidas de permanência estão previstos
- `CT-SUP-25` (OBRIG, suporte, S) - Biblioteca descrita com acessibilidade física e condições de acesso

### Assistência estudantil, permanência e êxito

Reúne fichas sobre políticas de permanência, assistência estudantil, acompanhamento discente, ingresso e suporte ao itinerário do estudante.

- Tipo de escopo: `tematico`
- Aliases de título: `assistência estudantil`, `permanência e êxito`, `atendimento ao estudante`, `acompanhamento discente`
- Termos de busca: `permanência`, `êxito`, `assistência estudantil`, `evasão`, `acompanhamento`, `monitoria`, `apoio pedagógico`

- `CT-SUP-03` (OBRIG, suporte, S) - Política de assistência estudantil e acompanhamento
- `CT-SUP-24` (OBRIG, suporte, D) - Política de assistência estudantil adequada à Resolução CONSUP/IFPR nº 239/2025
- `CT-IDENT-17` (OBRIG, identidade, S) - Política de cotas referenciada sem desatualização ou erro material

## Síntese da revisão

### Síntese transversal e riscos para a revisão

Agrupa fichas que cruzam múltiplos temas para apoiar a síntese do relatório, achados recorrentes e recomendação final.

- Tipo de escopo: `transversal`
- Aliases de título: `síntese transversal`, `conclusão da revisão`, `conclusão da análise`, `recomendação final`, `riscos do PPC`
- Termos de busca: `coerência transversal`, `risco`, `recomendação`, `achados`, `síntese`, `pendências`

- `CT-TRANS-01` (BLOQ, transversal, J) - Coerência entre objetivos, perfil do egresso e matriz
- `CT-TRANS-02` (BLOQ, transversal, J) - Coerência entre concepção, metodologias e avaliação
- `CT-TRANS-03` (BLOQ, transversal, J) - Coerência interna entre ementas e bibliografias do currículo
- `CT-TRANS-04` (BLOQ, transversal, J) - Coerência entre currículo, corpo docente e infraestrutura
- `CT-TRANS-05` (BLOQ, transversal, J) - Riscos globais e ajustes prioritários
- `CT-TRANS-06` (REC, transversal, J) - Síntese argumentativa para a conclusão da revisão
- `CT-TRANS-07` (REC, transversal, J) - Dimensionamento de vagas compatível com infraestrutura e interesse público
- `CT-TRANS-08` (OBRIG, transversal, J) - Coerência teórico-prática entre concepção, perfil e matriz

## Normas citadas pelas fichas

Gerado de `referencias_normativas`. Quando uma norma mudar, estas são as fichas a revisar.

- `br/cne-ceb/res/2024/2` Resolução CNE/CEB nº 2/2024: `CT-CURR-03`, `CT-CURR-11`, `CT-CURR-18`, `CT-CURR-19`, `CT-CURR-27`, `CT-IDENT-08`, `CT-SUP-09`, `CT-SUP-12`, `CT-SUP-14`
- `br/cne-cp/res/2025/2` Resolução CNE/CP nº 2/2025: `CT-IDENT-15` (complementar)
- `br/cne-cp/res/2026/2` Resolução CNE/CP nº 2/2026: `CT-CURR-02`, `CT-CURR-03`, `CT-CURR-06`, `CT-CURR-08`, `CT-CURR-11`, `CT-CURR-12`, `CT-CURR-13`, `CT-CURR-14`, `CT-CURR-15`, `CT-CURR-16`, `CT-CURR-17`, `CT-CURR-19`, `CT-CURR-20`, `CT-CURR-21`, `CT-CURR-24`, `CT-CURR-27`, `CT-IDENT-01`, `CT-IDENT-02`, `CT-IDENT-03`, `CT-IDENT-05`, `CT-IDENT-08`, `CT-IDENT-15`, `CT-IDENT-18`, `CT-SUP-01`, `CT-SUP-02`, `CT-SUP-04`, `CT-SUP-07`, `CT-SUP-08`, `CT-SUP-09`, `CT-SUP-12`, `CT-SUP-14`, `CT-SUP-15`, `CT-SUP-17`, `CT-SUP-20`, `CT-SUP-21`, `CT-SUP-22`, `CT-TRANS-02`, `CT-TRANS-08`
- `br/decreto/1985/90922` Decreto nº 90.922/1985: `CT-IDENT-19`
- `br/lei/1968/5524` Lei nº 5.524/1968: `CT-IDENT-19`
- `br/lei/1996/9394` Lei nº 9.394/1996: `CT-CURR-11`, `CT-CURR-18`, `CT-CURR-26`, `CT-IDENT-08`, `CT-SUP-09`, `CT-SUP-12`, `CT-SUP-17`
- `br/lei/2008/11788` Lei nº 11.788/2008: `CT-CURR-20`, `CT-CURR-21`, `CT-CURR-24`
- `br/lei/2012/12711` Lei nº 12.711/2012: `CT-IDENT-16`, `CT-IDENT-17`
- `br/lei/2015/13146` Lei nº 13.146/2015: `CT-SUP-25`
- `br/lei/2016/13409` Lei nº 13.409/2016: `CT-IDENT-17`
- `br/lei/2018/13639` Lei nº 13.639/2018: `CT-IDENT-19`
- `br/lei/2023/14723` Lei nº 14.723/2023: `CT-IDENT-17`
- `br/lei/2024/14914` Lei nº 14.914/2024: `CT-SUP-24`
- `br/lei/2024/14945` Lei nº 14.945/2024: `CT-CURR-03`, `CT-CURR-11`, `CT-CURR-18`, `CT-IDENT-08`, `CT-SUP-09`, `CT-SUP-12`
- `br/lei/2026/15468` Lei nº 15.468/2026: `CT-CURR-26`
- `cnct:catalogo` Catálogo Nacional de Cursos Técnicos (CNCT): `CT-CURR-02`, `CT-CURR-16`, `CT-CURR-17`, `CT-CURR-20`, `CT-CURR-25`, `CT-IDENT-01`, `CT-IDENT-13`, `CT-IDENT-14`, `CT-IDENT-15`, `CT-IDENT-19`, `CT-SUP-07`, `CT-SUP-14`, `CT-SUP-21`, `CT-SUP-22`, `CT-TRANS-08`
- `externo:abnt/nbr/6023` ABNT NBR 6023: `CT-CURR-06` (complementar), `CT-SUP-13`
- `externo:campus/regulamento-estagio` Regulamento Geral de Estágio do campus: `CT-CURR-21` (complementar), `CT-CURR-24` (complementar), `CT-CURR-25` (complementar)
- `externo:cft/res/2019/89` Resolução CFT nº 89/2019: `CT-IDENT-19`
- `externo:ifpr/manual-competencias` Manual de Competências do IFPR: `CT-SUP-23`
- `externo:ifpr/pdi` Plano de Desenvolvimento Institucional do IFPR: `CT-SUP-14`
- `externo:ifpr/ppi` Projeto Pedagógico Institucional do IFPR: `CT-SUP-14`
- `externo:ifpr/regimento-geral` Regimento Geral do IFPR: `CT-SUP-14`
- `ifpr/consup/res/2017/50` Resolução CONSUP/IFPR nº 50/2017: `CT-SUP-01`, `CT-SUP-26`
- `ifpr/consup/res/2022/64` Resolução CONSUP/IFPR nº 64/2022: `CT-CURR-02`, `CT-CURR-03` (complementar), `CT-CURR-14`, `CT-CURR-19`, `CT-SUP-08`, `CT-SUP-17`
- `ifpr/consup/res/2022/82` Resolução CONSUP/IFPR nº 82/2022: `CT-CURR-20`, `CT-CURR-21`, `CT-CURR-24`, `CT-CURR-25`
- `ifpr/consup/res/2023/148` Resolução CONSUP/IFPR nº 148/2023: `CT-CURR-09`, `CT-CURR-22`, `CT-SUP-04`, `CT-SUP-18`, `CT-SUP-19`, `CT-SUP-20`
- `ifpr/consup/res/2023/159` Resolução CONSUP/IFPR nº 159/2023: `CT-CURR-09`, `CT-CURR-22`, `CT-SUP-04`, `CT-SUP-19`, `CT-SUP-20`
- `ifpr/consup/res/2024/190` Resolução CONSUP/IFPR nº 190/2024: `CT-CURR-13`, `CT-CURR-14`, `CT-CURR-16`, `CT-CURR-27`, `CT-IDENT-02`, `CT-IDENT-16`
- `ifpr/consup/res/2025/239` Resolução CONSUP/IFPR nº 239/2025: `CT-SUP-24`
- `ifpr/proens/nt/2025/1` Nota Técnica PROENS/IFPR nº 1/2025: `CT-CURR-09`, `CT-CURR-22`, `CT-SUP-19`
- `ifpr/proens/portaria/2024/121` Portaria PROENS/IFPR nº 121/2024: `CT-SUP-08`
