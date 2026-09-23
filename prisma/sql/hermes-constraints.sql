-- Constraints and privileges that Prisma cannot express.
-- Reference copy. These statements are embedded in Prisma migrations.

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ChannelIdentity_exactly_one_subject'
      and conrelid = 'public."ChannelIdentity"'::regclass
  ) then
    alter table public."ChannelIdentity"
      add constraint "ChannelIdentity_exactly_one_subject"
      check (num_nonnulls("leadId", "studentId") = 1);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'Conversation_exactly_one_subject'
      and conrelid = 'public."Conversation"'::regclass
  ) then
    alter table public."Conversation"
      add constraint "Conversation_exactly_one_subject"
      check (num_nonnulls("leadId", "studentId") = 1);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'Appointment_exactly_one_subject'
      and conrelid = 'public."Appointment"'::regclass
  ) then
    alter table public."Appointment"
      add constraint "Appointment_exactly_one_subject"
      check (num_nonnulls("leadId", "studentId") = 1);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'Appointment_valid_interval'
      and conrelid = 'public."Appointment"'::regclass
  ) then
    alter table public."Appointment"
      add constraint "Appointment_valid_interval"
      check ("endsAt" > "startsAt");
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'DeliveryAttempt_has_source'
      and conrelid = 'public."DeliveryAttempt"'::regclass
  ) then
    alter table public."DeliveryAttempt"
      add constraint "DeliveryAttempt_has_source"
      check (num_nonnulls("messageId", "outboxEventId") >= 1);
  end if;
end $$;

create unique index if not exists "Conversation_one_open_portal_student_key"
  on public."Conversation" ("studentId")
  where "channel" = 'PORTAL' and "status" = 'OPEN' and "studentId" is not null;

do $$
declare
  table_name text;
  internal_tables text[] := array[
    'Lead',
    'ChannelIdentity',
    'Conversation',
    'ConversationMessage',
    'Appointment',
    'AgentDefinition',
    'AgentRun',
    'AgentRunStep',
    'ApprovalRequest',
    'OutboxEvent',
    'InboxEvent',
    'DeliveryAttempt',
    'AuditLog',
    'FollowUpRule',
    'AutomationSetting',
    'CommandExecution'
  ];
begin
  foreach table_name in array internal_tables
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
  end loop;
end $$;
