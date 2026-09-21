from datetime import UTC, datetime

from app.schemas.applications import CreateApplicationRequest, SubmitApplicationRequest
from app.schemas.deadlines import CreateDeadlineRequest
from app.schemas.messages import SendMessageRequest


def test_mutation_payloads_accept_the_bridge_contract() -> None:
    application = CreateApplicationRequest(
        student_id="student_1",
        program_id="program_1",
        intake="2027/28",
        hard_deadline=datetime(2027, 7, 1, tzinfo=UTC),
    )
    deadline = CreateDeadlineRequest(
        title="Submit application",
        date=datetime(2027, 7, 1, tzinfo=UTC),
        student_id="student_1",
        is_hard_deadline=True,
    )

    assert application.intake == "2027/28"
    assert deadline.is_hard_deadline is True
    assert SubmitApplicationRequest().force is False


def test_message_payload_allows_attachment_only_message() -> None:
    message = SendMessageRequest(
        attachments=[{"name": "passport.pdf", "file_url": "/api/files/passport.pdf"}]
    )

    assert message.text == ""
    assert message.attachments[0].name == "passport.pdf"
