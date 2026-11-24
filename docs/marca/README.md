# Marca do Simplifica IF

A identidade "Marca-texto", de 24/11/2026: grafite sobre branco e uma cor só, o amarelo do marca-texto. O app grifa o que aponta para uma fonte da base, e a marca é esse grifo. Não usa as cores do IFPR nem as do governo federal: o projeto é independente. Os arquivos desta pasta, o ícone do app e o logo da interface saem todos de `node apps/desktop/scripts/gerar-marca.ts`; não os edite à mão. O desenho fica em `apps/desktop/scripts/marca/cena.ts`, e os contornos das letras em `marca/glifos.ts`.

| Arquivo | Uso |
|---|---|
| `logo.svg` | logo sobre fundo claro |
| `logo-escuro.svg` | logo sobre fundo escuro |
| `icone.svg` | ícone com relevo, na grade do macOS (placa de 824 numa tela de 1024) |
| `icone-plano.svg` | ícone sem relevo, na placa quase sangrada do Windows (e do favicon); só para 32 px ou menos |

Fora desta pasta: `apps/web/src/marca/logo.svg` e `logo-escuro.svg` (o cabeçalho da interface, em cada tema), `apps/web/public/favicon.svg` e `apps/desktop/recursos/icone.icns` e `icone.ico` (o app empacotado).

## Logo

- **"simplifica"**, em minúsculas e Hanken Grotesk 300, grafite `#17171A`: a leveza.
- **"IF"**, em Hanken Grotesk 800, grafite, grifado: um retângulo amarelo `#FFE45C` por trás, com 0,09 em de folga dos lados e 0,10 em acima e abaixo, e cantos de 0,04 em. O grifo fica a 0,11 em de "simplifica".
- No fundo escuro, "simplifica" em `#F1F1F3`; o grifo continua amarelo cheio, com o "IF" em grafite (14:1).
- Logo plano, sem degradê nem sombra: o relevo é só do ícone.

## Ícone

- "IF" em grafite numa placa amarela: a placa é o grifo. De 48 px para cima, a placa e as letras levam degradê e as letras, uma sombra curta; até 32 px, o desenho plano, com as letras maiores.
- macOS: a placa de 824 px numa tela de 1024, com a sombra externa da grade da Apple. Windows: a placa quase sangrada, sem sombra externa.
- O `.icns` leva 16 e 32 px em ARGB, como o `iconutil` grava, e os demais em PNG; o `.ico`, PNG de 16 a 256 px.

O texto dos SVGs já está em contorno: abrem iguais sem a Hanken Grotesk instalada.

## Paleta

A mesma dos tokens de `apps/web/src/index.css` e de `COR` em `apps/desktop/scripts/marca/cena.ts`.

| Cor | Claro | Escuro | Uso |
|---|---|---|---|
| marca-texto | `#FFE45C` | `#FFE45C` a 32% | o grifo (`--grifo`): link `ifpr://`, trecho citado, aba em que se está, "IF" do logo |
| risco | `#F2C200` | `#FFE45C` | o filete das citações (`--grifo-risco`) |
| sublinhado do link | `#17171A`, 1 px | `#FFE45C`, 2 px | `--link-risco`: o link de texto; o grifo aparece por trás com o mouse ou o foco |
| grafite | `#17171A` | `#F1F1F3` | texto; no claro, também o botão principal e o foco |
| botão principal | `#17171A` | `#FFE45C` | `--primary`: no escuro, o botão é o próprio marca-texto, com o texto em grafite |
| névoa | `#F4F4F5` | `#222226` | superfície de apoio e mensagem da pessoa (`--muted`, `--message`) |
| linha | `#E1E1E5` | `#2F2F36` | bordas |

As cores de estado (ok, corrigir, conferir, informação) são as convencionais e não fazem parte da marca. O "conferir" da revisão de PPC é laranja queimado (`#B4500A`, `#FF9D5C` no escuro), para não se confundir com o amarelo do grifo.

No tema claro, o sublinhado do link é grafite e não amarelo: o amarelo sobre o branco dá 1,7:1, e nenhum amarelo chega a 3:1 sem virar mostarda. O grifo fica para o que aponta para uma fonte da base.
