import pytest

from app.mcp import tools as _tools  # noqa: F401
from app.mcp.registry import invoke_tool
from app.orchestration.safety import evaluate_outbound_text


@pytest.mark.parametrize(
    "text",
    [
        "Мы гарантируем визу после оплаты.",
        "Ваш документ одобрен.",
        "Visa guaranteed for every applicant.",
        "Оплата подтверждена, можете не проверять кабинет.",
    ],
)
def test_safety_blocks_prohibited_claims(text: str) -> None:
    decision = evaluate_outbound_text(text)
    assert decision.status == "BLOCKED"
    assert decision.risk_class == "FORBIDDEN"


def test_safety_requires_approval_for_free_form_and_allows_template() -> None:
    assert evaluate_outbound_text("Пришлите, пожалуйста, паспорт.").status == (
        "APPROVAL_REQUIRED"
    )
    assert evaluate_outbound_text(
        "Напоминаем о документе.", template_key="document-reminder-v1"
    ).status == "ALLOWED"


async def test_mcp_rejects_tool_without_required_scope() -> None:
    from app.mcp.principal import McpPrincipal

    principal = McpPrincipal(
        agent_run_id="run_1",
        agent_key="intake",
        agent_version="1.0.0",
        allowed_tools=frozenset({"lead.get"}),
        allowed_scopes=frozenset(),
        lead_id="lead_1",
    )
    with pytest.raises(PermissionError, match="leads:read"):
        await invoke_tool(  # type: ignore[arg-type]
            None,
            name="lead.get",
            arguments={"lead_id": "lead_1"},
            principal=principal,
        )


async def test_mcp_contract_rejects_unknown_arguments_before_handler() -> None:
    from app.mcp.principal import McpPrincipal

    principal = McpPrincipal(
        agent_run_id="run_1",
        agent_key="intake",
        agent_version="1.0.0",
        allowed_tools=frozenset({"lead.get"}),
        allowed_scopes=frozenset({"leads:read"}),
        lead_id="lead_1",
    )
    with pytest.raises(ValueError, match="Unknown arguments"):
        await invoke_tool(  # type: ignore[arg-type]
            None,
            name="lead.get",
            arguments={"lead_id": "lead_1", "sql": "drop table Lead"},
            principal=principal,
        )
