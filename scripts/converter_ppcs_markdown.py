#!/usr/bin/env python3
"""Converte PPCs referenciados nos JSONs de campus para Markdown.

Cada Markdown sai com o front matter de proveniência (`proveniencia: registrada`): URL de origem,
SHA-256 dos bytes baixados, data da conversão e versão do conversor. O contrato do front matter é
`packages/kb/src/ppcs/front-matter.ts`; a base guarda só o PPC vigente, e versões anteriores ficam
no histórico do git.

Dependência opcional:
    uv venv
    uv pip install -r requirements-ppc.txt
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import re
import tempfile
from http.client import IncompleteRead
from pathlib import Path
from urllib.parse import quote, unquote, urlparse, urlsplit, urlunsplit
from urllib.request import Request, urlopen


# Raiz lógica da base pública: os markdown_path dos campi são relativos a ela.
ROOT = Path(__file__).resolve().parents[1] / "base-conhecimento"
INSTITUCIONAL_ROOT = ROOT / "institucional"
USER_AGENT = "simplifica-if-ppc-converter/1.0"


def google_drive_download_url(url: str) -> str:
    match = re.search(r"/file/d/([^/]+)/", url)
    if not match:
        return url
    return f"https://drive.google.com/uc?export=download&id={match.group(1)}"


def normalize_url(url: str) -> str:
    parts = urlsplit(url)
    path = quote(unquote(parts.path), safe="/:%")
    query = quote(unquote(parts.query), safe="=&?/:+,%")
    return urlunsplit((parts.scheme, parts.netloc, path, query, parts.fragment))


def suffix_for_url(url: str, content_type: str | None) -> str:
    parsed = urlparse(url)
    path = unquote(parsed.path)
    suffix = Path(path).suffix
    if suffix:
        return suffix
    if content_type and "pdf" in content_type.lower():
        return ".pdf"
    return ".bin"


def download_source(url: str, tmpdir: Path) -> tuple[Path, str]:
    source_url = normalize_url(google_drive_download_url(url))
    request = Request(source_url, headers={"User-Agent": USER_AGENT})
    content = b""
    suffix = ".bin"
    last_error: Exception | None = None
    for _attempt in range(3):
        try:
            with urlopen(request, timeout=60) as response:
                content = response.read()
                suffix = suffix_for_url(response.geturl(), response.headers.get("Content-Type"))
            break
        except IncompleteRead as exc:
            last_error = exc
    else:
        if last_error is not None:
            raise last_error
    source_path = tmpdir / f"ppc{suffix}"
    source_path.write_bytes(content)
    return source_path, hashlib.sha256(content).hexdigest()


def extracted_text_is_weak(markdown: str) -> bool:
    markdown = re.sub(r"\*\*==> picture \[[^\]]+\] intentionally omitted <==\*\*", "", markdown)
    text = re.sub(r"\s+", "", markdown)
    return len(text) < 500


def convert_file(source_path: Path, force_ocr: bool = False) -> tuple[str, str]:
    """Markdown convertido e a descrição do conversor (versões e uso de OCR)."""
    try:
        import pymupdf
        import pymupdf4llm
    except ImportError as exc:
        raise SystemExit("Instale as dependências opcionais com: uv venv && uv pip install -r requirements-ppc.txt") from exc

    def conversor(ocr: str) -> str:
        versao_llm = getattr(pymupdf4llm, "__version__", "?")
        versao_pdf = getattr(pymupdf, "__version__", None) or getattr(pymupdf, "VersionBind", "?")
        versoes = f"pymupdf4llm {versao_llm}; pymupdf {versao_pdf}"
        return f"scripts/converter_ppcs_markdown.py; {versoes}; ocr {ocr}"

    if force_ocr:
        return pymupdf4llm.to_markdown(str(source_path), force_ocr=True, use_ocr=True), conversor("forcado")

    markdown = pymupdf4llm.to_markdown(str(source_path), use_ocr=False)
    if extracted_text_is_weak(markdown):
        return pymupdf4llm.to_markdown(str(source_path), use_ocr=True), conversor("automatico")
    return markdown, conversor("nao")


ESCALAR_SIMPLES = re.compile(r"^[^\W_][\w.\/:@%?=&+-]*$")


def escalar_yaml(valor: str) -> str:
    """Como `serializarFrontMatterPpc` (TypeScript): aspas só quando o YAML simples mudaria o valor."""
    if ESCALAR_SIMPLES.match(valor) and ": " not in valor:
        return valor
    return json.dumps(valor, ensure_ascii=False)


def front_matter_proveniencia(markdown_path: str, url: str, sha256: str, conversor: str, data: str) -> str:
    """Front matter de proveniência registrada, na ordem de `CAMPOS_PROVENIENCIA`."""
    campus_id, curso_slug = Path(markdown_path).with_suffix("").parts[-2:]
    campos = [
        ("id", f"ppc:{campus_id}/{curso_slug}"),
        ("fonte_url", url),
        ("fonte_sha256", sha256),
        ("convertido_em", data),
        ("conversor", conversor),
        ("proveniencia", "registrada"),
    ]
    return "---\n" + "".join(f"{campo}: {escalar_yaml(valor)}\n" for campo, valor in campos) + "---\n"


def set_conversion_error(ppc: dict[str, object], message: str) -> None:
    ppc["conversao"] = {
        "status": "erro",
        "mensagem_erro": message,
    }


def iter_campus_paths(campus_filter: str | None) -> list[Path]:
    campi_root = INSTITUCIONAL_ROOT / "ifpr" / "campi"
    if campus_filter:
        return [campi_root / f"{campus_filter}.json"]
    return sorted(path for path in campi_root.glob("*.json") if path.name != "index.json")


def sanitize_markdown(markdown: str) -> str:
    markdown = markdown.replace("\x00", "")
    local_file_scheme = "file:" + "//"
    markdown = re.sub(r"<?" + re.escape(local_file_scheme) + r"[^)\]\s>]+>?", "", markdown)
    markdown = post_process_markdown(markdown)
    return markdown


def post_process_markdown(markdown: str) -> str:
    """Remove artefatos recorrentes do conversor preservando texto OCR útil.

    O PyMuPDF4LLM marca imagens omitidas e pode envolver o texto extraído por OCR
    em blocos "Start/End of picture text". O texto desses blocos às vezes contém
    matrizes, quadros e formulários importantes, então removemos só os marcadores.
    """

    markdown = re.sub(
        r"^[ \t]*(?:\*\*)?\d{1,4}(?:\*\*)?[ \t]*\n"
        r"(?:[ \t]*\n)?"
        r"[ \t]*\*\*==> picture \[[0-9]+ x [0-9]+\] intentionally omitted <==\*\*[ \t]*\n",
        "",
        markdown,
        flags=re.MULTILINE,
    )
    markdown = re.sub(
        r"^[ \t]*\*\*==> picture \[[0-9]+ x [0-9]+\] intentionally omitted <==\*\*[ \t]*\n"
        r"(?:[ \t]*\n)?"
        r"[ \t]*(?:\*\*)?\d{1,4}(?:\*\*)?[ \t]*\n",
        "",
        markdown,
        flags=re.MULTILINE,
    )
    markdown = re.sub(
        r"^[ \t]*\*\*==> picture \[[0-9]+ x [0-9]+\] intentionally omitted <==\*\*[ \t]*\n",
        "",
        markdown,
        flags=re.MULTILINE,
    )
    markdown = markdown.replace("**----- Start of picture text -----**<br>\n", "")
    markdown = markdown.replace("**----- End of picture text -----**<br>\n", "")
    markdown = re.sub(r"^[ \t]*eme<br>[ \t]*\n?", "", markdown, flags=re.MULTILINE)
    markdown = re.sub(
        r"^\|\|\*\*INSTITUTO FEDERAL DO PARANÁ\*\*\|[ \t]*Pró-Reitoria de Ensino[ \t]*-\*\*PROENS\*\*\|\|\|[ \t]*\n",
        "",
        markdown,
        flags=re.MULTILINE,
    )
    markdown = re.sub(
        r"[ \t]*\*\*INSTITUTO FEDERAL DO PARANÁ\*\*[ \t]*\|[ \t]*Pró-Reitoria de Ensino[ \t]*-[ \t]*\*\*PROENS\*\*[ \t]*",
        " ",
        markdown,
    )
    markdown = re.sub(r"^\|{7,}\n", "", markdown, flags=re.MULTILINE)
    markdown = re.sub(r"[ \t]+$", "", markdown, flags=re.MULTILINE)
    markdown = re.sub(r"\n{3,}", "\n\n", markdown)
    return markdown


def should_convert(curso: dict[str, object], curso_filter: str | None, force: bool, retry_errors: bool) -> bool:
    if curso_filter and curso.get("curso_slug") != curso_filter:
        return False
    ppc = curso.get("ppc")
    if not isinstance(ppc, dict):
        return False
    conversao = ppc.get("conversao")
    if force:
        return True
    if not isinstance(conversao, dict):
        return True
    status = conversao.get("status")
    return status == "pendente" or (retry_errors and status == "erro")


def convert_ppcs(
    campus_path: Path,
    curso_filter: str | None,
    force: bool,
    retry_errors: bool,
    force_ocr: bool,
    dry_run: bool,
) -> int:
    data = json.loads(campus_path.read_text(encoding="utf-8"))
    campus_id = data.get("id")
    if not isinstance(campus_id, str):
        return 0

    changed = False
    converted = 0
    for curso in data.get("cursos", []):
        if not isinstance(curso, dict) or not should_convert(curso, curso_filter, force, retry_errors):
            continue
        ppc = curso["ppc"]
        if not isinstance(ppc, dict):
            continue
        url = ppc.get("url")
        markdown_path = ppc.get("markdown_path")
        if not isinstance(url, str) or not isinstance(markdown_path, str):
            continue

        target = ROOT / markdown_path
        print(f"{campus_id}/{curso.get('id')}: {url} -> {markdown_path}", flush=True)
        if dry_run:
            converted += 1
            continue

        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            with tempfile.TemporaryDirectory() as tmp:
                source_path, sha256 = download_source(url, Path(tmp))
                convertido, conversor = convert_file(source_path, force_ocr=force_ocr)
                markdown = sanitize_markdown(convertido)
        except Exception as exc:
            if target.exists():
                target.unlink()
            message = f"Falha na conversão: {exc.__class__.__name__}: {exc}"
            set_conversion_error(ppc, message)
            campus_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"{campus_id}/{curso.get('id')}: erro - {message}", flush=True)
            converted += 1
            changed = True
            continue
        if not markdown.strip():
            if target.exists():
                target.unlink()
            set_conversion_error(
                ppc,
                "Conversão sem texto extraído; provável PDF digitalizado ou baseado em imagens que exige OCR.",
            )
            campus_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"{campus_id}/{curso.get('id')}: sem texto extraído", flush=True)
            converted += 1
            changed = True
            continue
        data = datetime.date.today().isoformat()
        target.write_text(front_matter_proveniencia(markdown_path, url, sha256, conversor, data) + markdown, encoding="utf-8")
        ppc["conversao"] = {
            "status": "convertido",
        }
        campus_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"{campus_id}/{curso.get('id')}: convertido", flush=True)
        changed = True
        converted += 1

    if changed:
        campus_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return converted


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--campus", help="Filtra por id do campus, ex.: colombo")
    parser.add_argument("--curso", help="Filtra por id do curso")
    parser.add_argument("--force", action="store_true", help="Reconverte PPCs já marcados como convertidos")
    parser.add_argument("--retry-errors", action="store_true", help="Reprocessa PPCs marcados com status de erro")
    parser.add_argument("--force-ocr", action="store_true", help="Força OCR em todas as páginas")
    parser.add_argument("--dry-run", action="store_true", help="Mostra o que seria convertido sem escrever arquivos")
    args = parser.parse_args()

    total = 0
    for campus_path in iter_campus_paths(args.campus):
        if campus_path.exists():
            total += convert_ppcs(
                campus_path,
                args.curso,
                args.force,
                args.retry_errors,
                args.force_ocr,
                args.dry_run,
            )
    print(f"PPCs processados: {total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
