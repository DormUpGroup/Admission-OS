from app.services.operations.accompaniment import (
    can_accept_to_cohort,
    intake_aliases,
    normalize_intake_key,
)


def test_normalize_intake_key_collapses_year_forms() -> None:
    assert normalize_intake_key("2027/28") == "2027/28"
    assert normalize_intake_key("2027/2028") == "2027/28"
    assert normalize_intake_key(" 2027 - 28 ") == "2027/28"


def test_intake_aliases_include_common_spellings() -> None:
    aliases = intake_aliases("2027/28")
    assert "2027/28" in aliases
    assert "2027/2028" in aliases


def test_can_accept_to_cohort_blocks_full_intake() -> None:
    assert can_accept_to_cohort(2, None) == (True, None)
    assert can_accept_to_cohort(2, 3) == (True, None)
    ok, reason = can_accept_to_cohort(3, 3)
    assert ok is False
    assert reason == "Мест в наборе нет"
