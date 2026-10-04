import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { UserRole } from "@/lib/enums";
import { sendTransactionalEmail } from "@/server/delivery/email";
import { isDeliverableStudentEmail } from "@/server/registration/contact";
import { requestTelegramSend } from "@/server/commands/telegram-outbound";
import { tryDeliverTelegramSendNow } from "@/server/delivery/telegram-inline";

export const REGISTRATION_INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function registrationPageUrl(
  token: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const origin = (env.AUTH_URL ?? env.NEXTAUTH_URL ?? "").trim().replace(/\/$/, "");
  if (!origin) throw new Error("AUTH_URL is not set");
  return `${origin}/join/${encodeURIComponent(token)}`;
}

export function registrationInviteMessage(url: string): string {
  return [
    "Куратор берёт вас на сопровождение.",
    "Создайте кабинет ученика по ссылке:",
    url,
    "",
    "Ссылка действует 14 дней. После входа заполните анкеты в разделе «Анкеты».",
  ].join("\n");
}

function newToken() {
  return randomBytes(24).toString("base64url");
}

export async function openRegistrationInvite(input: {
  studentId: string;
  email: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const existing = await prisma.registrationInvite.findFirst({
    where: {
      studentId: input.studentId,
      consumedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;

  try {
    return await prisma.registrationInvite.create({
      data: {
        token: newToken(),
        studentId: input.studentId,
        email: input.email,
        expiresAt: new Date(now.getTime() + REGISTRATION_INVITE_TTL_MS),
      },
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      const raced = await prisma.registrationInvite.findFirst({
        where: {
          studentId: input.studentId,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: "desc" },
      });
      if (raced) return raced;
    }
    throw error;
  }
}

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

export type RegistrationInviteDelivery = {
  emailed: boolean;
  telegramed: boolean;
  /** Set when email was required but failed; Telegram may still have succeeded. */
  emailError?: string;
};

/**
 * Opens a /join link and delivers it by email and in Telegram.
 * Telegram uses a stable clientRequestId so a second promote does not spam the chat.
 */
export async function sendRegistrationInviteOnce(
  studentId: string,
): Promise<RegistrationInviteDelivery> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true, email: true, userId: true },
  });
  if (!student || student.userId) {
    return { emailed: false, telegramed: false };
  }
  const email = student.email.trim().toLowerCase();
  if (!email || !isDeliverableStudentEmail(email)) {
    throw new Error("На заявке нет почты для кабинета.");
  }

  const invite = await openRegistrationInvite({ studentId: student.id, email });
  const url = registrationPageUrl(invite.token);
  const body = registrationInviteMessage(url);

  let emailed = Boolean(invite.sentAt);
  let emailError: string | undefined;
  if (!emailed) {
    try {
      await sendTransactionalEmail({
        to: email,
        subject: "Кабинет ученика IMMIGROME",
        text: body,
      });
      await prisma.registrationInvite.update({
        where: { id: invite.id },
        data: { sentAt: new Date() },
      });
      emailed = true;
    } catch (error) {
      emailError =
        error instanceof Error
          ? error.message
          : "Не удалось отправить письмо на почту записи.";
      console.error(
        JSON.stringify({
          level: "error",
          msg: "registration.invite.email_failed",
          studentId: student.id,
          error: emailError,
        }),
      );
    }
  }

  const conversationId = await studentTelegramConversationId(student.id);
  let telegramed = false;
  if (conversationId) {
    const { message } = await requestTelegramSend({
      conversationId,
      body,
      clientRequestId: `registration-invite:${student.id}`,
    });
    telegramed = true;
    if (message.deliveryStatus !== "SENT" && message.deliveryStatus !== "DELIVERED") {
      await tryDeliverTelegramSendNow(message.id);
    }
  }

  if (!emailed && !telegramed) {
    throw new Error(
      emailError ?? "Нет Telegram-чата, чтобы отправить ссылку на кабинет.",
    );
  }

  return { emailed, telegramed, emailError: emailed ? undefined : emailError };
}

export async function loadRegistrationInvite(token: string, now = new Date()) {
  const invite = await prisma.registrationInvite.findUnique({
    where: { token },
    include: { student: { select: { id: true, email: true, firstName: true, userId: true } } },
  });
  if (!invite || invite.expiresAt <= now) return null;
  return invite;
}

export async function completeRegistration(input: {
  token: string;
  password: string;
}): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const password = input.password;
  if (password.length < 8) {
    return { ok: false, error: "Пароль должен быть не короче 8 символов." };
  }
  const invite = await loadRegistrationInvite(input.token.trim());
  if (!invite || invite.consumedAt) {
    return { ok: false, error: "Ссылка недействительна. Попросите куратора отправить новую." };
  }
  if (invite.student.userId) {
    return { ok: false, error: "Кабинет уже создан. Войдите с почтой и паролем." };
  }

  const email = invite.email.trim().toLowerCase();
  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existingUser) {
    return { ok: false, error: "Эта почта уже используется. Войдите или напишите куратору." };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const name = invite.student.firstName.trim() || email;
  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          name,
          passwordHash,
          role: UserRole.STUDENT,
        },
      });
      await tx.student.update({
        where: { id: invite.studentId },
        data: { userId: user.id, email },
      });
      await tx.registrationInvite.update({
        where: { id: invite.id },
        data: { consumedAt: new Date() },
      });
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      return { ok: false, error: "Эта почта уже используется. Войдите или напишите куратору." };
    }
    throw error;
  }

  return { ok: true, email };
}
