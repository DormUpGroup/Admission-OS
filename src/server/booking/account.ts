import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { StudyLevel, UserRole } from "@/lib/enums";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type BookingAccountView =
  | { kind: "invalid" }
  | {
      kind: "login";
      token: string;
      email: string;
    }
  | {
      kind: "signup";
      token: string;
      email: string;
      firstName: string;
      lastName: string;
    };

const inviteInclude = {
  lead: { include: { convertedStudent: { include: { user: true } } } },
  student: { include: { user: true } },
  conversation: { include: { student: { include: { user: true } } } },
} satisfies Prisma.BookingInviteInclude;

type InviteWithPeople = Prisma.BookingInviteGetPayload<{ include: typeof inviteInclude }>;

function qualificationText(json: Prisma.JsonValue | null | undefined, key: string): string {
  if (!json || typeof json !== "object" || Array.isArray(json)) return "";
  const value = (json as Record<string, Prisma.JsonValue>)[key];
  return typeof value === "string" ? value.trim() : "";
}

function cleanName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export async function loadBookingInvite(token: string, now = new Date()) {
  const invite = await prisma.bookingInvite.findUnique({
    where: { token },
    include: inviteInclude,
  });
  if (!invite || invite.expiresAt <= now) return null;
  return invite;
}

function linkedStudent(invite: InviteWithPeople) {
  return (
    invite.student ??
    invite.conversation.student ??
    invite.lead?.convertedStudent ??
    null
  );
}

export function bookingInviteMatchesStudent(
  invite: InviteWithPeople,
  studentId: string,
): boolean {
  if (invite.studentId === studentId) return true;
  if (invite.lead?.convertedStudentId === studentId) return true;
  if (invite.conversation.studentId === studentId) return true;
  return false;
}

export async function bookingAccountView(token: string): Promise<BookingAccountView> {
  const invite = await loadBookingInvite(token);
  if (!invite) return { kind: "invalid" };

  const student = linkedStudent(invite);
  const accountEmail = student?.user?.email ?? (student?.userId ? student.email : "");
  if (student?.userId && accountEmail) {
    return { kind: "login", token, email: accountEmail };
  }

  return {
    kind: "signup",
    token,
    email: invite.lead?.email?.trim() ?? student?.email ?? "",
    firstName: invite.lead?.firstName?.trim() || student?.firstName || "",
    lastName: invite.lead?.lastName?.trim() || student?.lastName || "",
  };
}

export async function registerBookingAccount(input: {
  token: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  const firstName = cleanName(input.firstName);
  const lastName = cleanName(input.lastName);
  if (!EMAIL_PATTERN.test(email)) {
    return { ok: false, error: "Укажите почту, на неё будет вход в кабинет." };
  }
  if (password.length < 8) {
    return { ok: false, error: "Пароль должен быть не короче 8 символов." };
  }
  if (!firstName) {
    return { ok: false, error: "Укажите имя." };
  }

  const invite = await loadBookingInvite(input.token);
  if (!invite) {
    return { ok: false, error: "Ссылка устарела. Напишите в Telegram, и мы пришлём новую." };
  }

  const existingStudent = linkedStudent(invite);
  if (existingStudent?.userId) {
    return { ok: false, error: "Кабинет уже создан. Войдите с почтой и паролем." };
  }

  const [emailUser, emailStudent] = await Promise.all([
    prisma.user.findUnique({ where: { email }, select: { id: true } }),
    prisma.student.findUnique({ where: { email }, select: { id: true, userId: true } }),
  ]);
  if (emailUser || (emailStudent && emailStudent.id !== existingStudent?.id)) {
    return { ok: false, error: "Эта почта уже используется. Войдите или укажите другую." };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const intake = qualificationText(invite.lead?.qualificationJson, "desiredIntake") || "Уточняется";
  const targetField = qualificationText(invite.lead?.qualificationJson, "targetField") || null;
  try {
    await createBookingCabinet({
      invite,
      email,
      passwordHash,
      firstName,
      lastName,
      intake,
      targetField,
      existingStudent,
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      return { ok: false, error: "Эта почта уже используется. Войдите или укажите другую." };
    }
    throw error;
  }

  return { ok: true };
}

async function createBookingCabinet(input: {
  invite: InviteWithPeople;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  intake: string;
  targetField: string | null;
  existingStudent: ReturnType<typeof linkedStudent>;
}) {
  const { invite, email, passwordHash, firstName, lastName, existingStudent, intake, targetField } =
    input;
  const lead = invite.lead;
  const displayName = [firstName, lastName].filter(Boolean).join(" ");

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        name: displayName,
        passwordHash,
        role: UserRole.STUDENT,
      },
    });

    const student =
      existingStudent ??
      (await tx.student.create({
        data: {
          userId: user.id,
          firstName,
          lastName: lastName || "—",
          email,
          studyLevel: StudyLevel.BACHELOR,
          intake,
          targetField,
          preferredLanguage: lead?.locale ?? null,
          curatorId: invite.curatorId,
        },
      }));

    if (existingStudent) {
      await tx.student.update({
        where: { id: existingStudent.id },
        data: {
          userId: user.id,
          firstName,
          lastName: lastName || existingStudent.lastName || "—",
          email,
          curatorId: existingStudent.curatorId ?? invite.curatorId,
        },
      });
    }

    if (lead) {
      await tx.lead.update({
        where: { id: lead.id },
        data: {
          email,
          firstName: lead.firstName || firstName,
          lastName: lead.lastName || lastName || null,
          convertedStudentId: student.id,
          convertedAt: new Date(),
          assignedCuratorId: lead.assignedCuratorId ?? invite.curatorId,
        },
      });
      await tx.channelIdentity.updateMany({
        where: { leadId: lead.id },
        data: { studentId: student.id, leadId: null },
      });
      await tx.conversation.updateMany({
        where: { leadId: lead.id },
        data: { studentId: student.id, leadId: null },
      });
    }

    await tx.conversation.update({
      where: { id: invite.conversationId },
      data: {
        studentId: student.id,
        leadId: null,
        assignedCuratorId: invite.conversation.assignedCuratorId ?? invite.curatorId,
      },
    });

    await tx.bookingInvite.update({
      where: { id: invite.id },
      data: { studentId: student.id },
    });
  });
}
