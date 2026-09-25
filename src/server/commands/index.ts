export {
  ALWAYS_ALLOWED_EVENT_TYPES,
  claimOutboxEvents,
  completeOutboxEvent,
  deadLetterOutboxEvent,
  DEFAULT_LEASE_MS,
  deferOutboxForKillSwitch,
  enqueueNoop,
  enqueueOutbox,
  enqueueWorkerLog,
  getGlobalAutomationSetting,
  GLOBAL_AUTOMATION_SETTING_KEY,
  isAutomationEnabled,
  isEnvAutomationEnabled,
  isEventTypeAllowed,
  isStaffTelegramSend,
  shouldProcessOutboxEvent,
  KILL_SWITCH_DEFER_MS,
  OUTBOX_STATUS,
  renewOutboxLease,
  replayDeadOutboxEvent,
  resolveAutomationEnabled,
  retryDelayMs,
  retryOutboxEvent,
  setGlobalAutomationEnabled,
  type DbClient,
  type EnqueueOutboxInput,
  type GlobalAutomationValue,
  type OutboxStatus,
} from "./outbox";

export { runCommand, type CommandContext, type CommandResult } from "./run-command";

export {
  APPROVAL_STATUS,
  approvalPayloadHash,
  canonicalApprovalPayload,
  createApprovalRequest,
  decideApprovalRequest,
} from "@/server/automation/approval";

export {
  evaluateActionPolicy,
  evaluateActionPolicyForConversation,
  POLICY_DECISIONS,
  type PolicyEvaluation,
} from "@/server/automation/policy";

export {
  escalateAgentToHuman,
  requestSchedulingApproval,
  sendAgentClientMessage,
  updateLeadQualificationFromAgent,
} from "@/server/automation/actions";

export {
  getContactProfile,
  getConversationContext,
  listAvailableSlots,
  updateLeadQualification,
} from "@/server/automation/context";

export {
  ingestTelegramUpdate,
  type IngestTelegramResult,
} from "./telegram-inbound";

export {
  requestTelegramSend,
  type RequestTelegramSendInput,
} from "./telegram-outbound";

export {
  appointmentCancel,
  appointmentConfirmByClient,
  appointmentConfirmManual,
  appointmentCreate,
  appointmentOfferAltSlots,
  appointmentProposeReschedule,
  appointmentReschedule,
  appointmentSelectAltSlot,
  APPOINTMENT_STATUS,
  type AppointmentCreateInput,
  type AppointmentProposeRescheduleInput,
  type AppointmentRescheduleInput,
} from "./appointments";
