import { prisma } from "@/lib/db";
import { logActivity } from "@/server/services/activity";
import { requestTelegramSend } from "@/server/commands/telegram-outbound";
import { tryDeliverTelegramSendNow } from "@/server/delivery/telegram-inline";
import { isDeliverableStudentEmail } from "@/server/registration/contact";
import {
  cabinetPageUrl,
  missingQuestionnaire,
  questionnaireCabinetRequestMessage,
  questionnaireJoinRequestMessage,
  questionnairePath,
} from "@/server/registration/cabinet";
import {
  openRegistrationInvite,
  registrationPageUrl,
  sendRegistrationInviteOnce,
} from "@/server/registration/invite";

async function studentTelegramConversationId(studentId: string): Promise<string | null> {
  const conversation = await prisma.conversation.findFirst({
    where: {
      channel: "TELEGRAM",
      OR: [{ studentId }, { lead: { convertedStudentId: studentId } }],
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  return conversation?.id ?? null;
}

export async function requestStudentQuestionnaire(input: {
  studentId: string;
  actorUserId: string;
}): Promise<{ ok: true; kind: "personal" | "programs" } | { ok: false; error: string }> {
  const student = await prisma.student.findUnique({
    where: { id: input.studentId },
    select: {
      id: true,
      email: true,
      userId: true,
      questionnaireAt: true,
      questionnairePersonalJson: true,
      questionnaireProgramsAt: true,
      questionnaireProgramsJson: true,
      preferredLanguage: true,
      targetField: true,
    },
  });
  if (!student) return { ok: false, error: "Студент не найден" };

  const kind = missingQuestionnaire(student);
  if (!kind) {
    return { ok: false, error: "Обе анкеты уже заполнены." };
  }

  const conversationId = await studentTelegramConversationId(student.id);
  let body = "";
  let emailedJoin = false;

  if (student.userId) {
    body = questionnaireCabinetRequestMessage(
      kind,
      cabinetPageUrl(questionnairePath(kind)),
    );
  } else {
    const email = student.email.trim().toLowerCase();
    if (!email || !isDeliverableStudentEmail(email)) {
      return {
        ok: false,
        error: "Нет почты для кабинета. Сначала сохраните почту ученика.",
      };
    }
    try {
      await sendRegistrationInviteOnce(student.id);
      emailedJoin = true;
    } catch (error) {
      console.error(error);
      if (!conversationId) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Не удалось отправить ссылку на кабинет.",
        };
      }
    }
    const invite = await openRegistrationInvite({ studentId: student.id, email });
    body = questionnaireJoinRequestMessage(registrationPageUrl(invite.token));
  }

  if (conversationId) {
    const { message, duplicate } = await requestTelegramSend({
      conversationId,
      body,
      senderUserId: input.actorUserId,
      clientRequestId: `questionnaire-request:${student.id}:${kind}:${Date.now()}`,
    });
    if (!duplicate) {
      await tryDeliverTelegramSendNow(message.id);
    }
  } else if (!emailedJoin && !student.userId) {
    return { ok: false, error: "Нет Telegram-чата и не удалось отправить почту." };
  } else if (student.userId) {
    return { ok: false, error: "Нет Telegram-чата, чтобы отправить ссылку." };
  }

  await logActivity({
    type: "NOTE",
    studentId: student.id,
    userId: input.actorUserId,
    metadata: {
      note:
        kind === "personal"
          ? "Отправлена просьба заполнить анкету №1"
          : "Отправлена просьба заполнить анкету №2",
    },
  });

  return { ok: true, kind };
}
