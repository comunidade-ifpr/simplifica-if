# Vetores do minisign real

Gerados em 16/11/2026 com o minisign 0.12 oficial (imagem `jedisct1/minisign`, do autor), sem chave privada no repositório:

```bash
docker run --rm -v "$PWD":/v -w /v jedisct1/minisign -G -W -p /v/minisign-0.12.pub -s /tmp/x.key
docker run --rm -v "$PWD":/v -w /v jedisct1/minisign -S -s /tmp/x.key -m /v/beta.json -t "vetor do minisign 0.12"
```

`minisign.test.ts` confere que o app aceita esta assinatura e recusa o arquivo alterado. Na mesma data, conferido à mão no sentido inverso (não automatizado, porque pede o Docker): `minisign -V` aceitou uma assinatura da fábrica; o `minisign -S` assinou com uma chave gerada pela fábrica, cifrada com senha; e a fábrica leu uma chave cifrada do `minisign -G` com a senha `senha-é` (bytes UTF-8 como digitados, sem normalização).
