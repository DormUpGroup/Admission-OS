"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { invalidateUserSessionCache } from "@/server/auth";
import { requireRole, requireStaff } from "@/server/auth/guards";
import {
  normalizeStaffEmail,
  staffEmailIssue,
  staffPasswordIssue,
} from "@/server/staff-accounts";

function teamError(message: string): never {
  redirect(`/admin/team?error=${encodeURIComponent(message)}`);
}

function profileError(message: string): never {
  redirect(`/admin/settings/profile?error=${encodeURIComponent(message)}`);
}

export async function createCuratorAction(formData: FormData) {
  await requireRole(["ADMIN"]);

  const name = String(formData.get("name") || "").trim();
  const email = normalizeStaffEmail(String(formData.get("email") || ""));
  const password = String(formData.get("password") || "");

  if (!name) teamError("Укажите имя.");
  const emailIssue = staffEmailIssue(email);
  if (emailIssue) teamError(emailIssue);
  const passwordIssue = staffPasswordIssue(password);
  if (passwordIssue) teamError(passwordIssue);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) teamError("Эта почта уже используется.");

  await prisma.user.create({
    data: {
      name,
      email,
      role: "CURATOR",
      passwordHash: await bcrypt.hash(password, 10),
    },
  });

  redirect("/admin/team?created=1");
}

export async function deleteCuratorAction(formData: FormData) {
  const session = await requireRole(["ADMIN"]);
  const userId = String(formData.get("userId") || "");
  if (!userId || userId === session.user.id) {
    teamError("Нельзя удалить свой аккаунт.");
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.role !== "CURATOR") {
    teamError("Можно удалить только куратора.");
  }

  const linkedStudent = await prisma.student.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  if (linkedStudent) {
    teamError("У этого аккаунта есть профиль ученика, удаление остановлено.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.student.updateMany({
      where: { curatorId: user.id },
      data: { curatorId: null },
    });
    await tx.student.updateMany({
      where: { acceptedById: user.id },
      data: { acceptedById: null },
    });
    await tx.task.updateMany({
      where: { assigneeId: user.id },
      data: { assigneeId: null },
    });
    await tx.document.updateMany({
      where: { reviewedById: user.id },
      data: { reviewedById: null },
    });
    await tx.activity.updateMany({
      where: { userId: user.id },
      data: { userId: null },
    });
    await tx.approvalRequest.updateMany({
      where: { decidedById: user.id },
      data: { decidedById: null },
    });
    await tx.bookingInvite.updateMany({
      where: { curatorId: user.id },
      data: { curatorId: session.user.id },
    });
    await tx.user.delete({ where: { id: user.id } });
  });

  redirect("/admin/team");
}

export async function changeOwnNameAction(formData: FormData) {
  const session = await requireStaff();
  const userId = session.user.id;
  if (!userId) profileError("Сессия не содержит аккаунт.");

  const name = String(formData.get("name") || "").trim();
  if (!name) profileError("Укажите имя.");

  const user = await prisma.user.update({
    where: { id: userId },
    data: { name },
    select: { email: true },
  });
  invalidateUserSessionCache(user.email);

  redirect("/admin/settings/profile?saved=name");
}

export async function changeOwnPasswordAction(formData: FormData) {
  const session = await requireStaff();
  const userId = session.user.id;
  if (!userId) profileError("Сессия не содержит аккаунт.");

  const currentPassword = String(formData.get("currentPassword") || "");
  const nextPassword = String(formData.get("nextPassword") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");

  if (nextPassword !== confirmPassword) {
    profileError("Новый пароль и повтор не совпадают.");
  }
  const passwordIssue = staffPasswordIssue(nextPassword);
  if (passwordIssue) profileError(passwordIssue);

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) profileError("Аккаунт не найден.");

  const matches = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!matches) profileError("Текущий пароль неверный.");

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(nextPassword, 10) },
  });

  redirect("/admin/settings/profile?saved=password");
}
