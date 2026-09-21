from app.schemas.matching import EligibilityRequest
from app.services.matching.eligibility import evaluate_eligibility


def test_degree_mismatch_is_a_hard_exclusion() -> None:
    result = evaluate_eligibility(
        EligibilityRequest(
            profile={"desired_degree_level": "MASTER", "applicant_category": "EU_CITIZEN"},
            program_degree_level="BACHELOR",
            data_confidence="HIGH",
        )
    )

    assert result.status == "NOT_ELIGIBLE"
    assert result.evaluations[0].hard_exclusion is True


def test_missing_sat_is_prep_not_a_hard_exclusion() -> None:
    result = evaluate_eligibility(
        EligibilityRequest(
            profile={"desired_degree_level": "BACHELOR", "applicant_category": "EU_CITIZEN"},
            program_degree_level="BACHELOR",
            data_confidence="HIGH",
            requirements=[{"type": "SAT", "required": True, "value": {"minimum": 1200}}],
        )
    )

    assert result.status == "ELIGIBLE"
    assert result.evaluations[0].status == "UNKNOWN"


def test_language_preference_is_a_hard_exclusion() -> None:
    result = evaluate_eligibility(
        EligibilityRequest(
            profile={
                "desired_degree_level": "BACHELOR",
                "applicant_category": "EU_CITIZEN",
                "preferred_teaching_languages": ["English"],
            },
            program_degree_level="BACHELOR",
            teaching_languages=["Italian"],
            data_confidence="HIGH",
        )
    )

    assert result.status == "NOT_ELIGIBLE"
