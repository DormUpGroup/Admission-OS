# ADR 0001: Hermes orchestration boundaries

- Status: Accepted
- Date: 2026-09-22
- Updated: 2026-09-23

## Context

IMMIGROME currently has two application runtimes sharing one Supabase Postgres
database:

- Next.js owns Auth.js, the admin and student interfaces, Prisma reads, and
  several business mutations.
- FastAPI exposes a partially migrated `/v1` API and a Celery worker.

The two runtimes currently duplicate some document, application, task,
eligibility, risk, and readiness behavior. Next.js also recalculates student
state after some FastAPI mutations. An external caller that bypasses Next.js
would therefore leave derived state stale.

Hermes Agent is being introduced for multi-channel intake and case
orchestration. It is an untrusted decision engine, not a system of record.

## Decision

1. Supabase Postgres is the only authoritative store for leads, students,
   conversations, messages, tasks, deadlines, approvals, and agent runs.
2. FastAPI owns business commands and invariants. Next.js, workers, and Hermes
   call the same command layer.
3. Next.js remains the human control plane and Auth.js session boundary.
4. Hermes runs as an isolated private service. It receives no database,
   Supabase service-role, filesystem, shell, or unrestricted HTTP credentials.
5. Hermes can act only through allow-listed business tools exposed by
   IMMIGROME.
6. Inbound channel events are persisted and deduplicated before invoking
   Hermes. Outbound messages pass deterministic policy checks and, where
   required, human approval before delivery.
7. Postgres transactional outbox records durable work. Redis and Celery
   transport work but are not authoritative.
8. Hermes memory, sessions, Kanban, and cron are supporting facilities only.
   They do not own client workflow state or exactly-once schedules.
9. Telegram is the first channel. Other providers must implement the same
   channel adapter contract.
10. All twelve agent roles are registered, but only the six MVP roles and the
    mandatory safety gate are initially enabled.

## Domain distinctions

- A `Lead` is a pre-enrollment contact. A `Student` is an accepted operational
  case. Conversion is explicit and transactional.
- A `ConversationMessage` is communication content. An `Activity` is a
  user-visible domain timeline entry. An `AuditLog` is an immutable record of
  who caused a state change.
- A `Task` is work for a person or student. An `AgentRun` is technical
  execution metadata.
- An `Appointment` is a meeting. A `Deadline` is an admissions or operational
  due date.
- A Hermes session is replaceable orchestration context. A `Conversation` is
  product state.

## Consequences

- The current dual mutation paths must be migrated capability by capability.
- Risk, readiness, and next-action recalculation must move into the Python
  command boundary before Hermes is allowed to mutate cases.
- New external side effects require idempotency keys, audit correlation, and
  outbox events.
- Prisma remains the migration owner during the incremental migration. A
  separate Alembic schema history must not be introduced in parallel.
- The application remains usable in manual mode when Hermes is unavailable.

## Non-goals

- Rewriting the Next.js UI in Python.
- Allowing Hermes to query or mutate arbitrary tables.
- Starting twelve independent, always-running agent processes.
- Using Hermes Kanban as the CRM or Hermes cron for legal/application
  deadlines.

## Command owners

FastAPI `services/commands` is the only persisted mutation path for case
state. Next.js authorizes the user, forwards a stable `Idempotency-Key`, and
revalidates. Capability flags may still gate optional reads or automation UI;
they must not fail open into a Prisma mutation.

Hermes MCP and the automation admin API are thin adapters: they authorize,
build a `CommandContext` (USER / AGENT / SYSTEM), and call the same command
handlers. They must not `insert`/`update`/`delete` domain tables directly.

Hermes MCP write access is run-scoped. `HERMES_MCP_KEY` is bootstrap-only
(initialize / initialized; no write tool catalog or `tools/call`). Each
`AgentRun` launch mints a short-lived capability JWT with
`HERMES_MCP_CAPABILITY_SECRET` (separate from INTERNAL / AUTOMATION / MCP
bootstrap secrets). Claims bind `agent_run_id`, `agent_key`, tools, scopes,
and resource ids from the run context. The raw token is delivered only as
`mcp.headers.Authorization` on Hermes `create_run` and must never appear in
DB, logs, audit, outbox, prompt, metadata, UI, or exception text. MCP
handlers take identity from the verified `McpPrincipal`, not from
model-controlled arguments.

| Capability | Command | Authoritative records |
| --- | --- | --- |
| students | `student.create`, `student.update` | `Student`, `Activity`, `AuditLog`, `OutboxEvent` |
| accompaniment | `accompaniment.accept`, `accompaniment.request_clarification`, `accompaniment.reject` | `Student`, `Activity`, `AuditLog`, `OutboxEvent` |
| intake | `intake_cohort.set_limit` | `IntakeCohort`, `AuditLog`, `OutboxEvent` |
| applications | `application.create`, `application.status`, `application.submit`, `requirement.create` | `Application`, `Requirement`, `Deadline`, `Activity` |
| documents | `document.create`, `document.request`, `document.upload`, `document.approve`, `document.needs_changes` | `Document`, `Requirement`, `Task`, `Activity` |
| tasks | `task.create`, `task.complete` | `Task`, `Activity` |
| deadlines | `deadline.create` | `Deadline`, `Activity` |
| messages | `message.staff.send`, `message.student.send`, `message.propose`, `message.request_send` | `Conversation`, `ConversationMessage`, `ApprovalRequest` |
| leads (MCP) | `lead.qualification.update`, `onboarding.prepare` | `Lead`, `Student`, `Document`, `Task` |
| appointments (MCP) | `appointment.create`, `scheduling.request` | `Appointment`, `OutboxEvent` |
| automation admin | `lead.conversion.request`, `approval.decide`, `agent_run.retry`, `agent_run.cancel`, `automation.global.set`, `outbox.dead.replay`, `agent_definition.update`, `conversation.pause`, `case.review.request`, `message.delivery.confirm`, `message.delivery.resend_safe` | `ApprovalRequest`, `AgentRun`, `AutomationSetting`, `OutboxEvent`, `Conversation`, `AgentDefinition`, `ConversationMessage` |
| questionnaires | `student.update` questionnaire fields | `Student` |
| notifications | `notification.read` | `InAppNotification` |
| telegram inbound | persist-before-process webhook command | `Lead`, `ChannelIdentity`, `Conversation`, `ConversationMessage`, `InboxEvent` |
| outbound delivery | outbox handlers | `DeliveryAttempt`, `ConversationMessage.deliveryStatus`, `Appointment.googleEventId` |

Derived readiness, risk, and next action are persisted only by
`recalculate_student` inside the Python command transaction.

Hermes launch rule: persist `AgentRun` first, call Hermes outside the DB
transaction, and use the outbox event `idempotencyKey` as the Hermes
`Idempotency-Key` so a retry after a failed finalize cannot create a second
run. If finalize fails after Hermes accepted the run, emit
`hermes_finalize_after_success_failure` and return the event to PENDING for
retry with the same key.

External delivery strategies:

| Provider | Success | Known failure | Ambiguous | Manual recovery |
| --- | --- | --- | --- | --- |
| Hermes | finalize + fenced PROCESSED | mark_failed / retry | success-before-finalize → retry same key | dead-letter replay |
| Telegram | SENT | raise → outbox retry | transport/timeout after send start → UNKNOWN_REQUIRES_REVIEW, no auto-retry | `message.delivery.confirm` / `message.delivery.resend_safe` |
| Calendar | search by immigromeAppointmentId then fenced googleEventId write | raise → retry | timeout after create → search again | same search-based recovery |

`Activity` is a timeline projection. `ConversationMessage` is the message
store. `AuditLog` is the immutable who-changed-what record. `CommandExecution`
is the idempotency receipt.

## Verification

Every new command must identify:

1. its authoritative database records;
2. its single implementation;
3. required actor scopes;
4. idempotency behavior;
5. audit and outbox records;
6. approval and rollback behavior.
