# SUAP IFPR

Esta skill localiza procedimentos na documentação oficial do IFPR e orienta a navegação autenticada no SUAP. A cobertura aprofundada inclui Ensino, Cursos, Coordenação de Curso, Registro Acadêmico e consultas profissionais de docentes, técnicos administrativos e outros servidores.

## Configuração

Defina na raiz do projeto, em `.env.local`:

```dotenv
SUAP_USUARIO=seu_usuario
SUAP_SENHA=sua_senha
```

Variáveis já presentes no processo têm precedência sobre `.env.local`. A skill nunca deve imprimir os valores. Confira apenas a presença da configuração com:

```bash
python3 .agents/skills/suap-ifpr/scripts/tutoriais.py config
```

O login automatizado cobre apenas usuário e senha. CAPTCHA, autenticação em duas etapas, Gov.br e troca obrigatória de senha exigem intervenção humana.

## Uso

Exemplos de solicitação:

```text
Use $suap-ifpr para localizar no SUAP os dados gerais deste curso.
Use $suap-ifpr para descobrir como matricular um aluno avulso em um diário.
Use $suap-ifpr para consultar as vagas cadastradas para este curso, sem alterar dados.
Use $suap-ifpr para informar o cargo, os cursos e as disciplinas atuais de uma pessoa docente.
Use $suap-ifpr para consultar cargo, função, situação e setor de uma pessoa servidora.
```

A skill consulta por padrão. Operações que escrevem no SUAP dependem de pedido explícito e de confirmação antes do envio final.

### Consulta rápida de docentes

O comando `professor` pesquisa o nome completo, abre a ficha de Ensino, seleciona um período e enriquece o resultado com os dados funcionais que o perfil autenticado puder consultar:

```bash
python3 .agents/skills/suap-ifpr/scripts/suap.py professor "NOME COMPLETO"
python3 .agents/skills/suap-ifpr/scripts/suap.py professor "NOME COMPLETO" --ano 2026 --periodo 2
python3 .agents/skills/suap-ifpr/scripts/suap.py professor "NOME COMPLETO" --ano 2026 --periodo 2 --json
```

Sem `--ano` e `--periodo`, o comando usa o período mais recente disponível na ficha. Os dois argumentos devem ser fornecidos juntos. Em caso de homônimos, use `--campus UNIDADE` para desambiguar. O resultado separa os cursos exibidos em `Cursos Lecionados` — uma relação sem filtro de período na tela atual — das disciplinas ativas do período escolhido.

A busca exige correspondência exata do nome, desconsiderando caixa e acentos. Homônimos interrompem a consulta para que a unidade seja refinada. O vínculo funcional é aceito somente quando está dentro do conteúdo da ficha pesquisada e a página de destino confirma o mesmo nome; links do menu do usuário autenticado são ignorados. CPF, matrícula, e-mail, telefone, IDs internos e números de diário não fazem parte da saída.

### Consulta rápida de servidores

O comando `servidor` pesquisa docentes, técnicos administrativos e outros servidores em Gestão de Pessoas e retorna somente dados profissionais permitidos:

```bash
python3 .agents/skills/suap-ifpr/scripts/suap.py servidor "NOME"
python3 .agents/skills/suap-ifpr/scripts/suap.py servidor "NOME" --campus UNIDADE
python3 .agents/skills/suap-ifpr/scripts/suap.py servidor "NOME" --json
```

A pesquisa tenta primeiro o nome informado e pode usar o último termo para localizar nomes oficiais com termos intermediários. Só aceita correspondência parcial quando todos os termos informados pertencem a uma única pessoa. A ficha individual precisa confirmar o mesmo nome da listagem.

A saída pode conter cargo, função, situação, setores, regime, jornada, datas funcionais, classe/padrão, grupo do cargo e participação no PGD. Ela nunca inclui contatos, matrícula, documentos, endereço, dados bancários, código da vaga, fotos ou IDs internos. O índice oficial atual não contém um tutorial específico para essa consulta; o caminho `Gestão de Pessoas > Servidores > Visualizar` foi confirmado na interface autenticada.

## Catálogo de tutoriais

`references/tutoriais.json` é um índice de descoberta. Ele guarda somente metadados da categoria SUAP e aponta para o conteúdo vivo no portal oficial.

Pesquisar:

```bash
python3 .agents/skills/suap-ifpr/scripts/tutoriais.py buscar matriz curricular
python3 .agents/skills/suap-ifpr/scripts/tutoriais.py buscar --json diploma digital
```

Atualizar explicitamente o índice:

```bash
python3 .agents/skills/suap-ifpr/scripts/tutoriais.py atualizar
```

A atualização usa a API REST pública do WordPress, percorre a categoria raiz `SUAP` e todas as suas subcategorias e grava uma saída determinística. Ela não copia o corpo dos artigos, imagens ou anexos.

## Validação

```bash
python3 .agents/skills/suap-ifpr/scripts/tutoriais.py validar
python3 -m unittest discover -s .agents/skills/suap-ifpr/tests -v
codex_skills_dir="${CODEX_HOME:-$HOME/.codex}/skills"
uv run --no-project --with pyyaml python "$codex_skills_dir/.system/skill-creator/scripts/quick_validate.py" .agents/skills/suap-ifpr
```

O smoke test faz login, mantém os cookies apenas em memória e consulta uma página de curso sem enviar formulários de alteração. A saída mostra somente o título e o caminho da página:

```bash
python3 .agents/skills/suap-ifpr/scripts/tutoriais.py auth-check
```

Smoke test da consulta docente, também somente leitura:

```bash
python3 .agents/skills/suap-ifpr/scripts/suap.py professor "NOME COMPLETO" --ano 2026 --periodo 2 --json
```

Smoke test da consulta profissional de qualquer servidor:

```bash
python3 .agents/skills/suap-ifpr/scripts/suap.py servidor "NOME" --json
```

## Segurança

- `.env.local` deve permanecer fora do Git.
- Credenciais não devem aparecer em argumentos de linha de comando nem em logs.
- Não salve cookies, HTML autenticado ou exportações com dados pessoais dentro da skill.
- Quando o perfil não puder acessar uma tela, registre a limitação de permissão; não trate a tela como inexistente.
- As consultas de docentes e servidores mantêm os cookies somente em memória e não gravam respostas autenticadas no disco.
