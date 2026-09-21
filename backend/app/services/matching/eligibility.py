from app.schemas.matching import (
    EligibilityRequest,
    EligibilityResponse,
    RequirementEvaluation,
    RequirementInput,
)
from app.services.matching.compare import (
    UNKNOWN,
    compare_language_level,
    compare_numeric_requirement,
    deadline_status,
    is_unknown,
)

ASPIRATIONAL_TYPES = {
    "LANGUAGE",
    "SAT",
    "TOLC",
    "ADMISSION_TEST",
    "INTERVIEW",
    "PORTFOLIO",
    "CURRICULAR_CREDITS",
    "SUBJECT_PREREQUISITE",
    "ACADEMIC_GRADE",
}


def degrees_compatible(desired: str, program: str) -> bool:
    return desired == program or (desired == "FOUNDATION" and program == "OTHER")


def _language_from_profile(request: EligibilityRequest, language: str) -> str:
    if language.lower() in {"english", "en"}:
        return str(request.profile.english_level)
    if language.lower() in {"italian", "it"}:
        return str(request.profile.italian_level)
    return UNKNOWN


def evaluate_requirement(
    request: EligibilityRequest, requirement: RequirementInput
) -> RequirementEvaluation:
    description = requirement.description or requirement.type
    base = {
        "type": requirement.type,
        "description": description,
        "required": requirement.required,
        "source_url": requirement.source_url,
    }
    value = requirement.value
    match requirement.type:
        case "LANGUAGE":
            level = str(value.get("level") or value.get("minLevel") or "")
            language = str(value.get("language") or "English")
            status = compare_language_level(_language_from_profile(request, language), level)
        case "SAT":
            minimum = value.get("score", value.get("min", value.get("minimum")))
            required_score = float(minimum) if isinstance(minimum, (int, float)) else None
            status = compare_numeric_requirement(
                request.profile.sat, requirement.operator, required_score
            )
        case "TOLC":
            test = str(value.get("test") or "TOLC")
            minimum = value.get("score", value.get("min"))
            required_score = float(minimum) if isinstance(minimum, (int, float)) else None
            status = compare_numeric_requirement(
                request.profile.tolc.get(test, UNKNOWN), requirement.operator, required_score
            )
        case "EDUCATION":
            required_level = str(value.get("degreeLevel") or value.get("level") or "")
            if not required_level or is_unknown(request.profile.desired_degree_level):
                status = "UNKNOWN"
            else:
                status = (
                    "MET"
                    if degrees_compatible(request.profile.desired_degree_level, required_level)
                    else "NOT_MET"
                )
        case "CITIZENSHIP" | "RESIDENCY_STATUS":
            categories = [str(item) for item in value.get("categories", [])]
            if request.profile.applicant_category == "UNKNOWN" or not categories:
                status = "UNKNOWN"
            else:
                status = "MET" if request.profile.applicant_category in categories else "NOT_MET"
        case _:
            status = "UNKNOWN"
    return RequirementEvaluation(**base, status=status)


def _same_place(first: str, second: str) -> bool:
    return first.strip().lower() == second.strip().lower()


def evaluate_eligibility(request: EligibilityRequest) -> EligibilityResponse:
    evaluations = [
        evaluate_requirement(request, requirement) for requirement in request.requirements
    ]
    risks: list[str] = []
    profile = request.profile

    if profile.applicant_category == "UNKNOWN":
        risks.extend(["APPLICANT_CATEGORY_UNVERIFIED", "CURATOR_REVIEW_REQUIRED"])

    if not is_unknown(profile.desired_degree_level) and profile.desired_degree_level != "OTHER":
        if not degrees_compatible(profile.desired_degree_level, request.program_degree_level):
            evaluations.insert(
                0,
                RequirementEvaluation(
                    type="EDUCATION",
                    description=(
                        f"Programme is {request.program_degree_level}, student seeks "
                        f"{profile.desired_degree_level}"
                    ),
                    status="NOT_MET",
                    required=True,
                    hard_exclusion=True,
                ),
            )

    if request.campus_city and any(
        _same_place(city, request.campus_city) for city in profile.excluded_cities
    ):
        evaluations.append(
            RequirementEvaluation(
                type="OTHER",
                description=f"City {request.campus_city} is in student's avoid list",
                status="NOT_MET",
                required=True,
                hard_exclusion=True,
            )
        )
    elif request.region and any(
        _same_place(region, request.region) for region in profile.excluded_regions
    ):
        evaluations.append(
            RequirementEvaluation(
                type="OTHER",
                description=f"Region {request.region} is excluded by student preferences",
                status="NOT_MET",
                required=True,
                hard_exclusion=True,
            )
        )

    preferences = [language.lower() for language in profile.preferred_teaching_languages]
    if preferences and request.teaching_languages:
        has_overlap = any(
            preference in language.lower() or language.lower() in preference
            for language in request.teaching_languages
            for preference in preferences
        )
        if not has_overlap:
            evaluations.append(
                RequirementEvaluation(
                    type="LANGUAGE",
                    description=(
                        f"Teaching language {', '.join(request.teaching_languages)} vs preference "
                        f"{', '.join(profile.preferred_teaching_languages)}"
                    ),
                    status="NOT_MET",
                    required=True,
                    hard_exclusion=True,
                )
            )

    if request.using_previous_year:
        risks.extend(["USING_PREVIOUS_YEAR_DATA", "CURATOR_REVIEW_REQUIRED"])
    else:
        deadline_states = [
            deadline_status(cycle.application_deadline)
            for cycle in request.cycles
            if not cycle.applicant_category
            or cycle.applicant_category == "ALL"
            or profile.applicant_category == "UNKNOWN"
            or cycle.applicant_category == profile.applicant_category
        ]
        if "SOON" in deadline_states:
            risks.append("DEADLINE_SOON")
        elif [item for item in deadline_states if item != "UNKNOWN"] and all(
            item == "PASSED" for item in deadline_states if item != "UNKNOWN"
        ):
            risks.append("CURATOR_REVIEW_REQUIRED")

    if any(item.hard_exclusion and item.status == "NOT_MET" for item in evaluations):
        return EligibilityResponse(status="NOT_ELIGIBLE", evaluations=evaluations, risks=risks)

    blocking_unknown = [
        item
        for item in evaluations
        if item.required
        and item.status == "UNKNOWN"
        and item.type not in ASPIRATIONAL_TYPES | {"CITIZENSHIP", "RESIDENCY_STATUS", "OTHER"}
    ]
    needs_review = bool(
        blocking_unknown
        or profile.applicant_category == "UNKNOWN"
        or request.using_previous_year
    )
    if needs_review or request.data_confidence != "HIGH":
        status = "NEEDS_REVIEW" if needs_review else "LIKELY_ELIGIBLE"
        return EligibilityResponse(status=status, evaluations=evaluations, risks=risks)
    return EligibilityResponse(status="ELIGIBLE", evaluations=evaluations, risks=risks)
