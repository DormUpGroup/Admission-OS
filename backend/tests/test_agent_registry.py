from app.mcp import tools as _tools  # noqa: F401
from app.mcp.registry import list_tools
from app.orchestration.registry import AGENT_SPECS, agent_for_event


def test_all_planned_agent_roles_are_registered() -> None:
    assert {spec.key for spec in AGENT_SPECS} == {
        "intake",
        "scheduling",
        "onboarding",
        "document",
        "follow_up",
        "case_manager",
        "program",
        "country_policy",
        "communication",
        "case_summary",
        "analytics",
        "qa_safety",
    }


def test_mvp_roles_and_safety_are_enabled() -> None:
    enabled = {spec.key for spec in AGENT_SPECS if spec.enabled}
    assert enabled == {
        "intake",
        "scheduling",
        "onboarding",
        "document",
        "follow_up",
        "case_manager",
        "qa_safety",
    }
    assert agent_for_event("message.received.v1").key == "intake"
    assert agent_for_event("unknown.event.v1") is None


def test_every_enabled_agent_tool_is_registered() -> None:
    registered = {tool.name for tool in list_tools()}
    for spec in AGENT_SPECS:
        if spec.enabled:
            assert set(spec.tools) <= registered, spec.key
