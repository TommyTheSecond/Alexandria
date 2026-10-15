"""Scanner checks, one module per family. Check ids and severities follow README section 6."""

from .av import av_clamav, find_clamav
from .base import ScanCheck, fail, ok
from .dup import NearDupIndex, dup_sha256, dup_text
from .meta import ban_source, meta_schema
from .pd import pd_rule, pd_source
from .pdf import MAX_PDF_BYTES, page_count, pdf_active, pdf_magic, pdf_parse, pdf_size
from .spam import spam_keywords, spam_repeat, spam_urls
from .text import TextAnalysis, analyse_text, text_extract, text_match

__all__ = [
    "MAX_PDF_BYTES", "NearDupIndex", "ScanCheck", "TextAnalysis", "analyse_text", "av_clamav", "ban_source",
    "dup_sha256", "dup_text", "fail", "find_clamav", "meta_schema", "ok", "page_count", "pd_rule", "pd_source", "pdf_active",
    "pdf_magic", "pdf_parse", "pdf_size", "spam_keywords", "spam_repeat", "spam_urls", "text_extract", "text_match",
]
