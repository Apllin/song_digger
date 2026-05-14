"""Unit tests for SoundCloud adapter helpers."""
import pytest

from app.adapters.soundcloud import _clean_title, _split_query


# ── _split_query ──────────────────────────────────────────────────────────────

def test_split_query_artist_track():
    assert _split_query("Ignez - Lightworker") == ("Ignez", "Lightworker")


def test_split_query_artist_only():
    assert _split_query("Surgeon") == ("Surgeon", None)


def test_split_query_artist_only():
    assert _split_query("Dani Duran") == ("Dani Duran", None)


def test_split_query_trailing_separator():
    assert _split_query("Ignez - ") == ("Ignez", None)


# ── _clean_title ──────────────────────────────────────────────────────────────

def test_clean_title_premiere_prefix():
    assert _clean_title("PREMIERE: Ignez - Lightworker") == "Ignez - Lightworker"


def test_clean_title_premiere_with_catalog_suffix():
    assert _clean_title("PREMIERE: Ignez - Lightworker [SOMOV010]") == "Ignez - Lightworker"


def test_clean_title_exclusive_prefix():
    assert _clean_title("EXCLUSIVE: Surgeon - Vortex") == "Surgeon - Vortex"


def test_clean_title_free_download_prefix():
    assert _clean_title("FREE DOWNLOAD: Some Track") == "Some Track"


def test_clean_title_free_dl_prefix():
    assert _clean_title("FREE DL: Some Track") == "Some Track"


def test_clean_title_pipe_prefix_with_free_dl_suffix():
    assert _clean_title("PREMIERE | BENZA - Henko [Free DL]") == "BENZA - Henko"


def test_clean_title_free_download_paren_suffix():
    assert _clean_title("VOICEX - Loose Battery (Free Download)") == "VOICEX - Loose Battery"


def test_clean_title_catalog_then_free_download_suffix():
    # Promo suffix stripped first to expose catalog number.
    assert _clean_title("Josh Burke - Catatonic Lover [MY01] (FREE DOWNLOAD)") == "Josh Burke - Catatonic Lover"


def test_clean_title_bracketed_prefix():
    assert _clean_title("[FREE DL] MAURER X LAUTLOS - OVERDRIVE") == "MAURER X LAUTLOS - OVERDRIVE"


def test_clean_title_label_name_suffix():
    assert _clean_title("Dreams Take Over [Divinity Records]") == "Dreams Take Over"


def test_clean_title_catalog_suffix_only():
    assert _clean_title("Ignez - Lightworker [SOMOV010]") == "Ignez - Lightworker"


def test_clean_title_no_change():
    assert _clean_title("Surgeon - Vortex") == "Surgeon - Vortex"


def test_clean_title_remix_suffix_preserved():
    # Remix suffix must not be stripped — it identifies a distinct recording.
    result = _clean_title("Ignez - Lightworker (Surgeon Remix)")
    assert result == "Ignez - Lightworker (Surgeon Remix)"


def test_clean_title_radio_edit_stripped():
    assert _clean_title("Buurman Uit Berlijn [Radio Edit] (feat. Joost)") == "Buurman Uit Berlijn"
