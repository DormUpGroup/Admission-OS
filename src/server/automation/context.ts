import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { listOpenSlots } from "@/server/services/appointments/slots";

const QUALIFICATION_FIELDS = new Set([
  "educationLevel",
  "budget",
  "preferredCountry",
  "desiredIntake",
  "studyLevel",
  "targetField",
]);

function asRecord(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

export async function getConversationContext(conversationId: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      channel: true,
      leadId: true,
      studentId: true,
      automationPausedAt: true,
      automationPauseReason: true,
      messages: {
        orderBy: { createdAt: "desc" },
        take: 12,
        select: {
          id: true,
          direction: true,
          senderType: true,
          body: true,
          createdAt: true,
        },
      },
    },
  });
  if (!conversation) throw new Error("Conversation not found");
  return { ...conversation, messages: [...conversation.messages].reverse() };
}

export async function getContactProfile(conversationId: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      lead: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          locale: true,
          status: true,
          consentStatus: true,
          consentAt: true,
          qualificationJson: true,
        },
      },
      student: {
        select: { id: true, firstName: true, lastName: true, studyLevel: true, targetField: true },
      },
    },
  });
  if (!conversation) throw new Error("Conversation not found");
  return { lead: conversation.lead, student: conversation.student };
}

export async function listAvailableSlots(input: {
  curatorId: string;
  from: Date;
  to: Date;
  timeZone?: string;
}) {
  return listOpenSlots(input);
}

export async function updateLeadQualification(input: {
  conversationId: string;
  patch: {
    firstName?: string;
    lastName?: string;
    locale?: string;
    qualification?: Record<string, Prisma.JsonValue>;
    consentStatus?: "UNKNOWN" | "GRANTED" | "DENIED";
    consentEvidence?: string;
  };
}) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: input.conversationId },
    select: { leadId: true, studentId: true, channel: true },
  });
  if (!conversation?.leadId || conversation.studentId) {
    throw new Error("Lead qualification is available only for lead conversations");
  }

  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: conversation.leadId } });
  const patch = input.patch;
  const qualification = { ...asRecord(lead.qualificationJson) };
  for (const [key, value] of Object.entries(patch.qualification ?? {})) {
    if (!QUALIFICATION_FIELDS.has(key)) {
      throw new Error(`Qualification field "${key}" is not allowed`);
    }
    qualification[key] = value;
  }

  const consentChanging = patch.consentStatus && patch.consentStatus !== lead.consentStatus;
  if (consentChanging && !patch.consentEvidence?.trim()) {
    throw new Error("Explicit consent evidence is required to change consent status");
  }
  return prisma.lead.update({
    where: { id: lead.id },
    data: {
      ...(patch.firstName !== undefined ? { firstName: patch.firstName.trim() || null } : {}),
      ...(patch.lastName !== undefined ? { lastName: patch.lastName.trim() || null } : {}),
      ...(patch.locale !== undefined ? { locale: patch.locale.trim() || null } : {}),
      ...(patch.qualification || consentChanging ? { qualificationJson: qualification } : {}),
      ...(consentChanging
        ? {
            consentStatus: patch.consentStatus!,
            consentAt: new Date(),
            consentEvidence: patch.consentEvidence!.trim(),
            consentChannel: conversation.channel,
          }
        : {}),
    },
  });
}
