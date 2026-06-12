from app.core.title_norm import strip_recording_suffixes


class TestBracketedForms:
    def test_strips_original_mix(self):
        assert strip_recording_suffixes("Grid (Original Mix)") == "Grid"
        assert strip_recording_suffixes("Grid [Original Mix]") == "Grid"

    def test_strips_extended_radio_remaster(self):
        assert strip_recording_suffixes("Track (Extended Mix)") == "Track"
        assert strip_recording_suffixes("Track (Radio Edit)") == "Track"
        assert strip_recording_suffixes("Track (Remastered)") == "Track"
        assert strip_recording_suffixes("Track (Remastered 2019)") == "Track"

    def test_strips_feat(self):
        assert strip_recording_suffixes("Track (feat. Someone)") == "Track"
        assert strip_recording_suffixes("Track (ft. Someone)") == "Track"

    def test_preserves_distinct_recordings(self):
        assert strip_recording_suffixes("Track (Remix)") == "Track (Remix)"
        assert strip_recording_suffixes("Track (Dub)") == "Track (Dub)"
        assert strip_recording_suffixes("Track (Live)") == "Track (Live)"


class TestHyphenForms:
    def test_strips_hyphen_original_mix(self):
        # Spotify/Apple/Yandex catalogue form — what Last.fm scrobbles often look like.
        assert strip_recording_suffixes("Lunfardo - Original Mix") == "Lunfardo"
        assert strip_recording_suffixes("Track - Extended Mix") == "Track"
        assert strip_recording_suffixes("Track - Radio Edit") == "Track"
        assert strip_recording_suffixes("Track - Remastered 2019") == "Track"

    def test_handles_en_and_em_dash(self):
        assert strip_recording_suffixes("Track – Original Mix") == "Track"
        assert strip_recording_suffixes("Track — Radio Edit") == "Track"

    def test_preserves_distinct_recordings_in_hyphen_form(self):
        assert strip_recording_suffixes("Track - Remix") == "Track - Remix"
        assert strip_recording_suffixes("Track - Live") == "Track - Live"
        assert strip_recording_suffixes("Track - Acoustic Version") == "Track - Acoustic Version"


class TestBareFeat:
    def test_strips_bare_feat_ft_featuring(self):
        assert strip_recording_suffixes("Track feat. Someone") == "Track"
        assert strip_recording_suffixes("Track ft. A & B") == "Track"
        assert strip_recording_suffixes("Track featuring X") == "Track"


class TestCrossSourceFusion:
    """Real cross-source pairs that should normalise to the same key."""

    def test_lastfm_bare_vs_cosine_parens(self):
        # Last.fm: "Lunfardo"; Cosine: "Lunfardo (Original Mix)"
        assert strip_recording_suffixes("Lunfardo") == strip_recording_suffixes("Lunfardo (Original Mix)")

    def test_lastfm_hyphen_vs_cosine_parens(self):
        # Last.fm: "Lunfardo - Original Mix"; Cosine: "Lunfardo (Original Mix)"
        assert strip_recording_suffixes("Lunfardo - Original Mix") == strip_recording_suffixes("Lunfardo (Original Mix)")

    def test_lastfm_feat_bare_vs_parens(self):
        # Last.fm: "Track feat. X"; Cosine: "Track (feat. X)"
        assert strip_recording_suffixes("Track feat. X") == strip_recording_suffixes("Track (feat. X)")
