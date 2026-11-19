# Marca do Simplifica IF

Decidida em 18/11/2026. Os arquivos desta pasta, o ícone do app e o logo da interface saem todos de `node apps/desktop/scripts/gerar-marca.ts`; não os edite à mão. O desenho fica em `apps/desktop/scripts/marca/cena.ts`, e os contornos das letras em `marca/glifos.ts`.

| Arquivo | Uso |
|---|---|
| `logo.svg` | logo sobre fundo claro |
| `logo-escuro.svg` | logo sobre fundo escuro |
| `icone.svg` | ícone com relevo, na grade do macOS (placa de 824 numa tela de 1024) |
| `icone-plano.svg` | ícone sem relevo, na placa quase sangrada do Windows (e do favicon); só para 32 px ou menos |

Fora desta pasta: `apps/web/src/marca/logo-sobre-verde.svg` (o cabeçalho da interface), `apps/web/public/favicon.svg` e `apps/desktop/recursos/icone.icns` e `icone.ico` (o app empacotado).

## Logo

- **"simplifica"**, em minúsculas e Open Sans 300, cinza `#2D2D2D`: a leveza.
- **"IF"**, em Open Sans 800, verde IFPR `#1F8A42`, colado a "simplifica" com um respiro de 0,06 em: o contraste de peso separa as duas partes.
- **O ponto**, vermelho IFPR `#C72E2E`, colado ao F: o eco do círculo vermelho do símbolo do IFPR.
- No fundo escuro, o verde e o vermelho mais claros (`#4CAF6A`, `#E05252`), porque os do manual somem sobre preto. Sobre o verde, tudo branco e o ponto vermelho com um anel branco: vermelho direto sobre verde "vibra".
- Logo plano, sem degradê nem sombra: o relevo é só do ícone.

## Ícone

- "IF." numa placa branca. De 48 px para cima, as letras e o ponto levam degradê e uma sombra curta; até 32 px, o desenho plano, com as letras maiores.
- macOS: a placa de 824 px numa tela de 1024, com a sombra externa da grade da Apple. Windows: a placa quase sangrada, sem sombra externa.
- O `.icns` leva 16 e 32 px em ARGB, como o `iconutil` grava, e os demais em PNG; o `.ico`, PNG de 16 a 256 px.

O texto dos SVGs já está em contorno: abrem iguais sem a Open Sans instalada.
