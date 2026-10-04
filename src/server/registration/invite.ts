import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { UserRole } from "@/lib/enums";
import { sendTransactionalEmail } from "@/server/delivery/email";
import { isDeliverableStudentEmail } from "@/server/registration/contact";

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
  return `Куратор берёт вас на сопровождение. Создайте кабинет ученика по ссылке:\n${url}\n\nСсылка действует 14 дней.`;
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

/** Sends the cabinet link once. A later click reuses the same invite and does not send again. */
export async function sendRegistrationInviteOnce(studentId: string): Promise<void> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true, email: true, userId: true },
  });
  if (!student || student.userId) return;
  const email = student.email.trim().toLowerCase();
  if (!email || !isDeliverableStudentEmail(email)) return;

  const invite = await openRegistrationInvite({ studentId: student.id, email });
  if (invite.sentAt) return;

  await sendTransactionalEmail({
    to: email,
    subject: "Кабинет ученика IMMIGROME",
    text: registrationInviteMessage(registrationPageUrl(invite.token)),
  });
  await prisma.registrationInvite.update({
    where: { id: invite.id },
    data: { sentAt: new Date() },
  });
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
