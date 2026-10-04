"use server";

import { redirect } from "next/navigation";
import { signIn } from "@/server/auth";
import { getCurrentStudent } from "@/server/auth/guards";
import {
  bookingAccountView,
  registerBookingAccount,
} from "@/server/booking/account";
import { appointmentBookByGuest } from "@/server/commands/appointments";

function isNextRedirect(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest: unknown }).digest === "string" &&
    String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT")
  );
}

async function signInToBooking(email: string, password: string) {
  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: "/portal/book",
    });
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    return { error: "Неверный email или пароль" };
  }
  redirect("/portal/book");
}

export async function registerFromBookingAction(formData: FormData) {
  const email = String(formData.get("email") || "");
  const password = String(formData.get("password") || "");
  const result = await registerBookingAccount({
    token: String(formData.get("token") || ""),
    email,
    password,
    firstName: String(formData.get("firstName") || ""),
    lastName: String(formData.get("lastName") || ""),
  });
  if (!result.ok) return { error: result.error };
  return signInToBooking(email.trim().toLowerCase(), password);
}

export async function loginFromBookingAction(formData: FormData) {
  const token = String(formData.get("token") || "");
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const view = await bookingAccountView(token);
  if (view.kind !== "login" || view.email.trim().toLowerCase() !== email) {
    return { error: "Войдите с почтой этого кабинета." };
  }
  return signInToBooking(email, password);
}

export async function bookConsultationAction(
  _prev: { error: string } | null,
  _formData: FormData,
) {
  void _prev;
  void _formData;
  await getCurrentStudent();
  // Cabinet is view-only: consultations are booked by curator or via Telegram link.
  return {
    error: "Запись на консультацию в кабинете недоступна. Куратор назначит время сам.",
  };
}

export async function bookGuestConsultationAction(
  _prev: { error: string } | null,
  formData: FormData,
) {
  const token = String(formData.get("token") || "").trim();
  const guestName = String(formData.get("guestName") || "");
  const guestEmail = String(formData.get("guestEmail") || "");
  const raw = String(formData.get("startsAt") || "");
  const startsAt = new Date(raw);
  if (!token) return { error: "Ссылка недействительна." };
  if (!guestName.trim()) return { error: "Укажите имя." };
  if (!guestEmail.trim()) return { error: "Укажите почту." };
  if (!raw || Number.isNaN(startsAt.getTime())) {
    return { error: "Выберите свободное время." };
  }

  try {
    await appointmentBookByGuest({ token, guestName, guestEmail, startsAt });
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    const message = error instanceof Error ? error.message : "";
    if (message === "Appointment already booked") {
      redirect(`/book/${encodeURIComponent(token)}`);
    }
    if (message === "The selected slot is no longer available") {
      return { error: "Это время уже занято. Выберите другое." };
    }
    if (message === "Email required") {
      return { error: "Укажите почту, на неё придёт ссылка на звонок." };
    }
    if (message === "Name required") return { error: "Укажите имя." };
    if (message === "Invite invalid") {
      return { error: "Ссылка устарела. Напишите в Telegram, и мы пришлём новую." };
    }
    return { error: "Не удалось записать консультацию." };
  }

  redirect(`/book/${encodeURIComponent(token)}`);
}
