"""Conversão DOCX -> Markdown e artefatos estruturais da Revisão de PPC."""

from .artefatos import ConversaoArtefatos
from .conversion_service import ConversionService
from .markdown_normalizer import MarkdownNormalizer

__all__ = ["ConversaoArtefatos", "ConversionService", "MarkdownNormalizer"]
