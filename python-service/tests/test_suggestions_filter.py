from app.api.routes.suggestions import _filter_track_matches


def test_keeps_exact_match():
    suggestions = ["Surgeon - Flatliner"]
    assert _filter_track_matches(suggestions, "Surgeon", "Flatliner") == [
        "Surgeon - Flatliner"
    ]


def test_keeps_paren_remix_suffix():
    suggestions = [
        "Surgeon - Flatliner",
        "Surgeon - Flatliner (Regis Remix)",
        "Surgeon - Flatliner [Cover]",
        "Surgeon - Flatliner - Original Mix",
        "Surgeon - Flatliner (Remastered 2020)",
    ]
    out = _filter_track_matches(suggestions, "Surgeon", "Flatliner")
    assert out == suggestions


def test_keeps_feat_suffix():
    suggestions = [
        "Surgeon - Flatliner feat. Regis",
        "Surgeon - Flatliner ft. Regis",
        "Surgeon - Flatliner featuring Regis",
    ]
    out = _filter_track_matches(suggestions, "Surgeon", "Flatliner")
    assert out == suggestions


def test_drops_unrelated_artist():
    suggestions = ["Aphex Twin - Flatliner"]
    assert _filter_track_matches(suggestions, "Surgeon", "Flatliner") == []


def test_drops_different_track_with_same_prefix():
    # "Flatliner Two" has " Two" suffix — not a recognized remix/version marker
    suggestions = ["Surgeon - Flatliner Two"]
    assert _filter_track_matches(suggestions, "Surgeon", "Flatliner") == []


def test_drops_unrelated_track_with_matching_artist():
    suggestions = ["Surgeon - Magneze"]
    assert _filter_track_matches(suggestions, "Surgeon", "Flatliner") == []


def test_artist_substring_match():
    # Collaboration credit — artist appears as substring
    suggestions = ["Surgeon, Regis - Flatliner (Live)"]
    assert _filter_track_matches(suggestions, "Surgeon", "Flatliner") == suggestions


def test_case_insensitive():
    suggestions = ["SURGEON - FLATLINER (REMIX)"]
    assert _filter_track_matches(suggestions, "surgeon", "flatliner") == suggestions


def test_drops_suggestions_without_separator():
    suggestions = ["Surgeon"]
    assert _filter_track_matches(suggestions, "Surgeon", "Flatliner") == []
