# Marca do Simplifica IF

Decidida em 18/11/2026; paleta própria desde 24/11/2026, sem as cores do IFPR. Os arquivos desta pasta, o ícone do app e o logo da interface saem todos de `node apps/desktop/scripts/gerar-marca.ts`; não os edite à mão. O desenho fica em `apps/desktop/scripts/marca/cena.ts`, e os contornos das letras em `marca/glifos.ts`.

| Arquivo | Uso |
|---|---|
| `logo.svg` | logo sobre fundo claro |
| `logo-escuro.svg` | logo sobre fundo escuro |
| `icone.svg` | ícone com relevo, na grade do macOS (placa de 824 numa tela de 1024) |
| `icone-plano.svg` | ícone sem relevo, na placa quase sangrada do Windows (e do favicon); só para 32 px ou menos |

Fora desta pasta: `apps/web/src/marca/logo-sobre-marca.svg` (o cabeçalho da interface), `apps/web/public/favicon.svg` e `apps/desktop/recursos/icone.icns` e `icone.ico` (o app empacotado).

## Logo

- **"simplifica"**, em minúsculas e Open Sans 300, tinta `#1D2B31`: a leveza.
- **"IF"**, em Open Sans 800, petróleo `#11707F`, colado a "simplifica" com um respiro de 0,06 em: o contraste de peso separa as duas partes.
- **O ponto**, cobre `#C96A1C`, colado ao F: o ponto final de quem terminou a tarefa.
- No fundo escuro, o petróleo e o cobre mais claros (`#5FC0CC`, `#F0A050`). Sobre o petróleo do cabeçalho, letras brancas e o ponto no cobre claro (4,6:1).
- Logo plano, sem degradê nem sombra: o relevo é só do ícone.

## Ícone

- "IF." numa placa branca. De 48 px para cima, as letras e o ponto levam degradê e uma sombra curta; até 32 px, o desenho plano, com as letras maiores.
- macOS: a placa de 824 px numa tela de 1024, com a sombra externa da grade da Apple. Windows: a placa quase sangrada, sem sombra externa.
- O `.icns` leva 16 e 32 px em ARGB, como o `iconutil` grava, e os demais em PNG; o `.ico`, PNG de 16 a 256 px.

O texto dos SVGs já está em contorno: abrem iguais sem a Open Sans instalada.

## Paleta

A mesma dos tokens de `apps/web/src/index.css` e de `COR` em `apps/desktop/scripts/marca/cena.ts`. Foi escolhida para não se confundir com a identidade do IFPR (verde e vermelho) nem com a do governo federal (o azul do gov.br): o projeto é independente.

| Cor | Claro | Escuro | Uso |
|---|---|---|---|
| petróleo 900 | `#0B4A55` | `#0C3138` | cabeçalho (`--marca`); branco por cima dá 9,9:1 |
| petróleo 800 | `#0E5A66` | `#13606C` | botão principal (`--primary`) |
| petróleo 700 | `#0D6372` | `#5FC0CC` | link e filete das citações (`--link`) |
| petróleo 600 | `#11707F` | `#5FC0CC` | "IF" do logo, foco (`--ring`) |
| petróleo 100 | `#E3F0F2` | `#17353B` | realce e mensagem (`--accent`, `--message`) |
| cobre | `#C96A1C` | `#F0A050` | o ponto do logo, só na marca |
| tinta | `#1D2B31` | `#ECECEC` | texto |

As cores de estado (ok, corrigir, conferir, informação) são as convencionais, verde, vermelho, âmbar e azul, e não fazem parte da marca.
