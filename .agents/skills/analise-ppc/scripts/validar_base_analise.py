from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path
from typing import Any

from common import (
    BASE_ANALISE_DIR,
    BASE_CONHECIMENTO_DIR,
    FICHAS_DIR,
    MARCOS_NORMATIVOS_PATH,
    SCHEMAS_DIR,
    TOPICOS_FICHAS_PATH,
    VALIDACOES_CRUZADAS_DIR,
    read_json,
)


class ErroValidacaoBaseAnalise(ValueError):
    pass


def _tipo_json(valor: Any) -> str:
    if isinstance(valor, bool):
        return "boolean"
    if isinstance(valor, int) and not isinstance(valor, bool):
        return "integer"
    if isinstance(valor, float):
        return "number"
    if isinstance(valor, str):
        return "string"
    if isinstance(valor, list):
        return "array"
    if isinstance(valor, dict):
        return "object"
    if valor is None:
        return "null"
    return type(valor).__name__


def _tipo_compativel(valor: Any, esperado: str | list[str]) -> bool:
    tipos = esperado if isinstance(esperado, list) else [esperado]
    tipo = _tipo_json(valor)
    return tipo in tipos or (tipo == "integer" and "number" in tipos)


def _validar_schema(valor: Any, schema: dict[str, Any], caminho: str = "$") -> list[str]:
    erros: list[str] = []
    alternativas = schema.get("anyOf")
    if isinstance(alternativas, list):
        if any(not _validar_schema(valor, alternativa, caminho) for alternativa in alternativas if isinstance(alternativa, dict)):
            return []
        return [f"{caminho}: não corresponde a nenhuma alternativa de anyOf"]

    esperado = schema.get("type")
    if esperado is not None and not _tipo_compativel(valor, esperado):
        return [f"{caminho}: tipo {_tipo_json(valor)}; esperado {esperado}"]

    enum = schema.get("enum")
    if isinstance(enum, list) and valor not in enum:
        erros.append(f"{caminho}: valor {valor!r} fora do enum")

    if isinstance(valor, (int, float)) and not isinstance(valor, bool):
        minimo = schema.get("minimum")
        maximo = schema.get("maximum")
        if isinstance(minimo, (int, float)) and valor < minimo:
            erros.append(f"{caminho}: valor {valor} menor que {minimo}")
        if isinstance(maximo, (int, float)) and valor > maximo:
            erros.append(f"{caminho}: valor {valor} maior que {maximo}")

    if isinstance(valor, dict):
        required = schema.get("required")
        if isinstance(required, list):
            for campo in required:
                if campo not in valor:
                    erros.append(f"{caminho}: campo obrigatório ausente: {campo}")
        properties = schema.get("properties")
        if isinstance(properties, dict):
            for campo, sub_schema in properties.items():
                if campo in valor and isinstance(sub_schema, dict):
                    erros.extend(_validar_schema(valor[campo], sub_schema, f"{caminho}.{campo}"))

    if isinstance(valor, list):
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            for indice, item in enumerate(valor):
                erros.extend(_validar_schema(item, item_schema, f"{caminho}[{indice}]"))

    return erros


def _carregar_schema(nome: str) -> dict[str, Any]:
    payload = read_json(SCHEMAS_DIR / nome)
    if not isinstance(payload, dict):
        raise ErroValidacaoBaseAnalise(f"Schema inválido: {nome}")
    return payload


def _validar_arquivo_json(path: Path, schema: dict[str, Any]) -> list[str]:
    try:
        payload = read_json(path)
    except json.JSONDecodeError as exc:
        return [f"{path}: JSON inválido: {exc}"]
    return [f"{path}: {erro}" for erro in _validar_schema(payload, schema)]


TIPOS_ESCOPO_TOPICO = {"tematico", "multitematico", "transversal", "condicional"}


def _validar_topicos_fichas(fichas_por_id: dict[str, dict[str, Any]]) -> list[str]:
    erros: list[str] = []
    ids_fichas = set(fichas_por_id)
    if not TOPICOS_FICHAS_PATH.exists():
        return [f"{TOPICOS_FICHAS_PATH}: arquivo de taxonomia não encontrado"]
    try:
        payload = read_json(TOPICOS_FICHAS_PATH)
    except json.JSONDecodeError as exc:
        return [f"{TOPICOS_FICHAS_PATH}: JSON inválido: {exc}"]
    if not isinstance(payload, dict):
        return [f"{TOPICOS_FICHAS_PATH}: payload deve ser objeto JSON"]
    topicos = payload.get("topicos")
    if not isinstance(topicos, list) or not topicos:
        return [f"{TOPICOS_FICHAS_PATH}: campo `topicos` deve ser lista não vazia"]

    ids_topicos: set[str] = set()
    fichas_cobertas: set[str] = set()
    for indice, topico in enumerate(topicos, start=1):
        if not isinstance(topico, dict):
            erros.append(f"{TOPICOS_FICHAS_PATH}: tópico {indice} deve ser objeto JSON")
            continue
        topico_id = str(topico.get("id") or "").strip()
        if not topico_id:
            erros.append(f"{TOPICOS_FICHAS_PATH}: tópico {indice} sem id")
        elif topico_id in ids_topicos:
            erros.append(f"{TOPICOS_FICHAS_PATH}: tópico duplicado: {topico_id}")
        ids_topicos.add(topico_id)
        for campo in ("titulo", "descricao", "tipo_escopo"):
            if not str(topico.get(campo) or "").strip():
                erros.append(f"{TOPICOS_FICHAS_PATH}: tópico {topico_id or indice} sem `{campo}`")
        tipo_escopo = str(topico.get("tipo_escopo") or "")
        if tipo_escopo and tipo_escopo not in TIPOS_ESCOPO_TOPICO:
            erros.append(f"{TOPICOS_FICHAS_PATH}: tópico {topico_id or indice} tem tipo_escopo inválido: {tipo_escopo}")
        for campo in ("aliases_titulo", "termos_busca", "fichas"):
            valores = topico.get(campo)
            if not isinstance(valores, list):
                erros.append(f"{TOPICOS_FICHAS_PATH}: tópico {topico_id or indice} deve ter `{campo}` como lista")
                continue
            if campo in {"aliases_titulo", "termos_busca"} and not valores:
                erros.append(f"{TOPICOS_FICHAS_PATH}: tópico {topico_id or indice} deve ter `{campo}` não vazio")
            if campo == "fichas":
                if not valores:
                    erros.append(f"{TOPICOS_FICHAS_PATH}: tópico {topico_id or indice} deve citar ao menos uma ficha")
                for ficha_id in valores:
                    ficha_id = str(ficha_id)
                    if ficha_id not in ids_fichas:
                        erros.append(f"{TOPICOS_FICHAS_PATH}: tópico {topico_id or indice} cita ficha desconhecida: {ficha_id}")
                    fichas_cobertas.add(ficha_id)

    faltantes = sorted(ids_fichas - fichas_cobertas)
    if faltantes:
        erros.append(f"{TOPICOS_FICHAS_PATH}: fichas sem tópico temático: {', '.join(faltantes)}")
    for ficha_id, ficha in sorted(fichas_por_id.items()):
        topicos_ficha = ficha.get("topicos_tematicos")
        if "secoes_preferenciais" in ficha:
            erros.append(f"{ficha_id}: campo legado `secoes_preferenciais` não é aceito")
        if not isinstance(topicos_ficha, list) or not topicos_ficha:
            erros.append(f"{ficha_id}: `topicos_tematicos` deve ser lista não vazia")
            continue
        declarados = {str(valor) for valor in topicos_ficha}
        desconhecidos = sorted(declarados - ids_topicos)
        if desconhecidos:
            erros.append(f"{ficha_id}: tópicos desconhecidos: {', '.join(desconhecidos)}")
        esperados = {
            str(topico.get("id"))
            for topico in topicos
            if ficha_id in {str(valor) for valor in topico.get("fichas", [])}
        }
        if declarados != esperados:
            erros.append(
                f"{ficha_id}: topicos_tematicos divergente da taxonomia "
                f"(ficha={sorted(declarados)}, taxonomia={sorted(esperados)})"
            )
        ancoras = ficha.get("ancoras_semanticas")
        if not isinstance(ancoras, list) or not any(str(valor).strip() for valor in ancoras):
            erros.append(f"{ficha_id}: `ancoras_semanticas` deve ser lista não vazia")
    return erros


MANIFEST_NORMAS_PATH = BASE_CONHECIMENTO_DIR / "manifest.json"

# Órgãos genéricos que não distinguem a norma (leis da Presidência, colegiado do IFPR).
_TOKENS_ORGAO_GENERICOS = {"consup", "presidencia", "da", "republica"}
_TIPOS_NORMA = ("resolucao", "lei", "portaria", "decreto", "nota tecnica", "parecer", "instrucao normativa")


def _normalizar_referencia(texto: str) -> str:
    """Normaliza grafias equivalentes de uma citação normativa para comparação.

    Remove acentos e caixa, expande "res.", tira o marcador "nº"/"n°"/"n." antes do número, remove pontos de milhar,
    reduz "nº 1, de 5 de janeiro de 2021" a "1/2021" e tira zeros à esquerda.
    """
    sem_acento = unicodedata.normalize("NFKD", str(texto)).encode("ascii", "ignore").decode("ascii").casefold()
    s = re.sub(r"\bres\.\s*", "resolucao ", sem_acento)
    s = re.sub(r"\bn\s*[o.]*\s*(?=\d)", "", s)
    s = re.sub(r"(?<=\d)\.(?=\d{3}\b)", "", s)
    s = re.sub(r"(\d+),?\s+de\s+\d{1,2}o?\s+de\s+[a-z]+\s+de\s+(\d{4})", r"\1/\2", s)
    s = re.sub(r"\b0+(\d)", r"\1", s)
    return re.sub(r"\s+", " ", s).strip()


def _chave_estruturada(texto: str) -> tuple[str, str, str] | None:
    """Extrai (tipo, número, ano) de uma citação normalizada, ou None se não houver padrão N/AAAA."""
    s = _normalizar_referencia(texto)
    tipo = next((t for t in _TIPOS_NORMA if s.startswith(t)), None)
    numero_ano = re.search(r"(\d+)\s*/\s*(\d{4})\b", s)
    if not tipo or not numero_ano:
        return None
    return tipo, numero_ano.group(1), numero_ano.group(2)


def _tokens_orgao(orgao: str) -> set[str]:
    return {tok for tok in re.split(r"[/\s]+", _normalizar_referencia(orgao)) if tok} - _TOKENS_ORGAO_GENERICOS


def _carregar_manifest_normas(path: Path = MANIFEST_NORMAS_PATH) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    payload = read_json(path)
    return [item for item in payload if isinstance(item, dict)] if isinstance(payload, list) else []


def _norma_da_referencia(referencia: str, manifest: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Associa uma referência de ficha à norma do manifesto.

    Primeiro por (tipo, número, ano), exigindo que os tokens distintivos do órgão (ex.: "cne" e "cp", "ifpr")
    apareçam na referência; depois, como reserva, pelo título ou alias com número que inicia a referência. Siglas
    sem número (ex.: "DCNEPT") não são usadas para casar, porque são ambíguas entre versões da norma.
    """
    texto = _normalizar_referencia(referencia)
    chave = _chave_estruturada(referencia)
    if chave:
        tokens_ref = set(re.split(r"[/\s,;()]+", texto))
        candidatas = []
        for norma in manifest:
            chave_norma = _chave_estruturada(f"{norma.get('tipo_documento', '')} {norma.get('numero', '')}/{norma.get('ano', '')}")
            if chave_norma == chave and _tokens_orgao(str(norma.get("orgao") or "")) <= tokens_ref:
                candidatas.append(norma)
        if candidatas:
            return candidatas[0]
    melhor: tuple[int, dict[str, Any]] | None = None
    for norma in manifest:
        for chave_texto in [norma.get("title"), *(norma.get("aliases") or [])]:
            alvo = _normalizar_referencia(str(chave_texto or ""))
            if not alvo or not re.search(r"\d", alvo) or not texto.startswith(alvo):
                continue
            if len(texto) > len(alvo) and texto[len(alvo)].isalnum():
                continue
            if melhor is None or len(alvo) > melhor[0]:
                melhor = (len(alvo), norma)
    return melhor[1] if melhor else None


def _carregar_marcos(path: Path = MARCOS_NORMATIVOS_PATH) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        payload = read_json(path)
    except json.JSONDecodeError:
        return []
    marcos = payload.get("marcos") if isinstance(payload, dict) else None
    return [marco for marco in marcos if isinstance(marco, dict)] if isinstance(marcos, list) else []


def _validar_referencias_vigentes(
    fichas_por_id: dict[str, dict[str, Any]],
    manifest: list[dict[str, Any]],
    marcos: list[dict[str, Any]] | None = None,
) -> list[str]:
    """Barra em `referencias_normativas` norma revogada no manifesto, norma substituída por um marco e dispositivo revogado."""
    marcos = marcos or []
    substituidas = {
        chave: (str(texto), str(marco.get("id")))
        for marco in marcos
        for texto in [*(marco.get("substitui") or []), *(marco.get("antecessoras_historicas") or [])]
        if (chave := _chave_estruturada(str(texto)))
    }
    dispositivos = {
        _normalizar_referencia(str(texto)): str(marco.get("id"))
        for marco in marcos
        for texto in marco.get("dispositivos_revogados") or []
    }
    erros: list[str] = []
    for ficha_id, ficha in sorted(fichas_por_id.items()):
        for referencia in ficha.get("referencias_normativas") or []:
            referencia = str(referencia)
            normalizada = _normalizar_referencia(referencia)
            norma = _norma_da_referencia(referencia, manifest)
            chave = _chave_estruturada(referencia)
            if norma and norma.get("status_vigencia") == "revogada":
                erros.append(
                    f"{ficha_id}: `referencias_normativas` cita norma revogada: {referencia} "
                    f"(veja `revogada_por` em base-conhecimento/{norma.get('path', '')}; "
                    "atualize a ficha e base-analise/marcos-normativos.json)"
                )
            elif chave in substituidas:
                texto, marco_id = substituidas[chave]
                erros.append(
                    f"{ficha_id}: `referencias_normativas` cita norma substituída no marco {marco_id}: {referencia} ({texto})"
                )
            for dispositivo, marco_id in dispositivos.items():
                if normalizada.startswith(dispositivo):
                    erros.append(
                        f"{ficha_id}: `referencias_normativas` cita dispositivo revogado (marco {marco_id}): {referencia}"
                    )
    return erros


def _validar_marcos_normativos(
    manifest: list[dict[str, Any]],
    path: Path = MARCOS_NORMATIVOS_PATH,
    fichas_por_id: dict[str, dict[str, Any]] | None = None,
) -> list[str]:
    if not path.exists():
        return [f"{path}: registro de marcos normativos não encontrado"]
    try:
        payload = read_json(path)
    except json.JSONDecodeError as exc:
        return [f"{path}: JSON inválido: {exc}"]
    erros = [f"{path}: {erro}" for erro in _validar_schema(payload, _carregar_schema("marcos-normativos.schema.json"))]
    if erros:
        return erros
    ids: set[str] = set()
    for marco in payload["marcos"]:
        marco_id = str(marco["id"])
        if marco_id in ids:
            erros.append(f"{path}: marco duplicado: {marco_id}")
        ids.add(marco_id)
        vigente = str(marco["vigente"])
        norma = _norma_da_referencia(vigente, manifest)
        if norma is None:
            erros.append(f"{path}: marco {marco_id}: norma vigente fora do manifesto da base: {vigente}")
        elif norma.get("status_vigencia") == "revogada":
            erros.append(f"{path}: marco {marco_id}: norma marcada como vigente está revogada no manifesto: {vigente}")
        for substituida in marco["substitui"]:
            norma = _norma_da_referencia(str(substituida), manifest)
            if norma and norma.get("status_vigencia") == "vigente":
                erros.append(
                    f"{path}: marco {marco_id}: norma listada como substituída está vigente no manifesto: {substituida}"
                )
        if fichas_por_id is not None:
            for campo in ("fichas_responsaveis", "fichas_base_legal"):
                for ficha_id in marco.get(campo) or []:
                    if ficha_id not in fichas_por_id:
                        erros.append(f"{path}: marco {marco_id}: `{campo}` cita ficha desconhecida: {ficha_id}")
    return erros


def validar_base_analise() -> list[str]:
    erros: list[str] = []
    schema_ficha = _carregar_schema("ficha.schema.json")
    schema_validacao = _carregar_schema("validacao-cruzada.schema.json")
    schema_resultado = _carregar_schema("resultado-lote.schema.json")
    schema_alertas = _carregar_schema("alertas-transversais.schema.json")

    for schema_path in sorted(SCHEMAS_DIR.glob("*.schema.json")):
        payload = read_json(schema_path)
        if not isinstance(payload, dict) or payload.get("type") != "object":
            erros.append(f"{schema_path}: schema deve ser objeto com type=object")

    fichas_por_id: dict[str, dict[str, Any]] = {}
    for ficha_path in sorted(FICHAS_DIR.glob("*.json")):
        erros.extend(_validar_arquivo_json(ficha_path, schema_ficha))
        payload = read_json(ficha_path)
        ficha_id = str(payload.get("id") or "")
        if ficha_id in fichas_por_id:
            erros.append(f"{ficha_path}: ficha duplicada: {ficha_id}")
        fichas_por_id[ficha_id] = payload
    erros.extend(_validar_topicos_fichas(fichas_por_id))
    manifest = _carregar_manifest_normas()
    if not manifest:
        erros.append(f"{MANIFEST_NORMAS_PATH}: manifesto de normas não encontrado; checagem de vigência não executada")
    else:
        erros.extend(_validar_referencias_vigentes(fichas_por_id, manifest, _carregar_marcos()))
        erros.extend(_validar_marcos_normativos(manifest, fichas_por_id=fichas_por_id))

    ids_validacoes: set[str] = set()
    for validacao_path in sorted(VALIDACOES_CRUZADAS_DIR.glob("*.json")):
        erros.extend(_validar_arquivo_json(validacao_path, schema_validacao))
        payload = read_json(validacao_path)
        validacao_id = str(payload.get("id") or "")
        if validacao_id in ids_validacoes:
            erros.append(f"{validacao_path}: validação cruzada duplicada: {validacao_id}")
        ids_validacoes.add(validacao_id)

    erros.extend(_validar_arquivo_json(BASE_ANALISE_DIR / "contratos" / "resposta_lote.exemplo.json", schema_resultado))
    erros.extend(
        _validar_schema(
            {
                "alertas_transversais": [
                    {
                        "id": "ALERTA-001",
                        "validacao_id": "VC-EXEMPLO",
                        "titulo": "Alerta transversal",
                        "criticidade": "OBRIG",
                        "descricao": "Descrição objetiva.",
                        "fichas_relacionadas": ["CT-IDENT-01"],
                        "evidencias": ["Evidência textual."],
                        "revisao_humana_obrigatoria": True,
                    }
                ]
            },
            schema_alertas,
        )
    )
    return erros


def main() -> int:
    erros = validar_base_analise()
    if erros:
        for erro in erros:
            print(erro)
        return 1
    print("Base de análise válida.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
