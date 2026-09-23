"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signIn } from "@/server/auth";
import { prisma } from "@/lib/db";

function isAuthSessionCookie(name: string) {
  return name.includes("authjs.") || name.includes("next-auth.");
}

function isNextRedirect(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest: unknown }).digest === "string" &&
    String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT")
  );
}

function authErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const type =
    "type" in error && typeof error.type === "string" ? error.type : "";
  const name = "name" in error && typeof error.name === "string" ? error.name : "";
  if (type === "CredentialsSignin" || name === "CredentialsSignin") {
    return "Неверный email или пароль";
  }
  if (type === "MissingSecret" || name === "MissingSecret") {
    return "На сервере не задан AUTH_SECRET";
  }
  return null;
}

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");

  if (!process.env.AUTH_SECRET && !process.env.NEXTAUTH_SECRET) {
    console.error("loginAction: AUTH_SECRET is not set");
    return { error: "Сервер не настроен: отсутствует AUTH_SECRET" };
  }
  if (!process.env.DATABASE_URL) {
    console.error("loginAction: DATABASE_URL is not set");
    return { error: "Сервер не настроен: отсутствует DATABASE_URL" };
  }

  let dest = "/admin";
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    dest = user?.role === "STUDENT" ? "/portal" : "/admin";
  } catch (e) {
    console.error("loginAction user lookup failed", e);
    return { error: "Не удалось войти: ошибка базы данных." };
  }

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
    if (isNextRedirect(e)) throw e;
    const message = authErrorMessage(e);
    if (message) return { error: message };
    console.error("loginAction signIn failed", e);
    return { error: "Не удалось войти. Проверьте логи сервера." };
  }

  return { dest };
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
