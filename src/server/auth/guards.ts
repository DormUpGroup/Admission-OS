import { auth } from "@/server/auth";
import { prisma } from "@/lib/db";
import type { UserRole } from "@/lib/enums";
import { notFound, redirect } from "next/navigation";

export async function requireSession() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return session;
}

export async function requireRole(roles: UserRole[]) {
  const session = await requireSession();
  if (!roles.includes(session.user.role)) {
    if (session.user.role === "STUDENT") redirect("/portal");
    redirect("/admin");
  }
  return session;
}

export async function requireStaff() {
  return requireRole(["ADMIN", "CURATOR"]);
}

export async function canAccessStudent(studentId: string) {
  const session = await requireSession();
  if (session.user.role === "ADMIN") return { session, allowed: true };

  if (session.user.role === "CURATOR") {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { curatorId: true },
    });
    return {
      session,
      allowed:
        !!student &&
        (student.curatorId === session.user.id || student.curatorId == null),
    };
  }

  if (session.user.role === "STUDENT") {
    const student = await prisma.student.findFirst({
      where: { OR: [{ userId: session.user.id }, { email: session.user.email }] },
      select: { id: true },
    });
    return { session, allowed: student?.id === studentId };
  }

  return { session, allowed: false };
}

export async function assertStudentAccess(studentId: string) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true },
  });
  if (!student) notFound();

  const { allowed } = await canAccessStudent(studentId);
  if (!allowed) notFound();
}

export async function getCurrentStudent() {
  const session = await requireRole(["STUDENT"]);
  const student = await prisma.student.findFirst({
    where: {
      OR: [{ userId: session.user.id }, { email: session.user.email }],
    },
  });
  if (!student) throw new Error("Профиль студента не привязан");
  return { session, student };
}

export function studentScopeWhere(userId: string, role: UserRole) {
  if (role === "ADMIN") return {};
  if (role === "CURATOR") return { curatorId: userId };
  return { userId };
}
