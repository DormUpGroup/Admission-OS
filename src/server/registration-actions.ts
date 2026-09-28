"use server";

import { redirect } from "next/navigation";
import { signIn } from "@/server/auth";
import { completeRegistration } from "@/server/registration/invite";

function isNextRedirect(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest: unknown }).digest === "string" &&
    String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT")
  );
}

export async function completeRegistrationAction(formData: FormData) {
  const token = String(formData.get("token") || "");
  const password = String(formData.get("password") || "");
  const result = await completeRegistration({ token, password });
  if (!result.ok) return { error: result.error };

  try {
    await signIn("credentials", {
      email: result.email,
      password,
      redirectTo: "/portal",
    });
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    redirect("/login");
  }
  redirect("/portal");
}
