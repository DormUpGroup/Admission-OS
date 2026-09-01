"use server";

import { cookies } from "next/headers";
import { signIn } from "@/server/auth";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

function isAuthSessionCookie(name: string) {
  return name.includes("authjs.") || name.includes("next-auth.");
}

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") || "");
  const password = String(formData.get("password") || "");
  try {
    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    if (result?.error) {
      return { error: "Неверный email или пароль" };
    }
  } catch (e) {
    // next-auth may still throw NEXT_REDIRECT with redirect:false — let it through
    if (e instanceof AuthError) {
      return { error: "Неверный email или пароль" };
    }
    throw e;
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (user?.role === "STUDENT") redirect("/portal");
  redirect("/admin");
}

export async function logoutAction() {
  const cookieStore = await cookies();
  for (const cookie of cookieStore.getAll()) {
    if (isAuthSessionCookie(cookie.name)) {
      cookieStore.delete(cookie.name);
    }
  }
  redirect("/login");
}
