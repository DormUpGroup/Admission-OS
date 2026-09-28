"use client";

import { useState } from "react";
import {
  loginFromBookingAction,
  registerFromBookingAction,
} from "@/server/booking-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BookingAccountView } from "@/server/booking/account";

export function BookingAccountForm({
  view,
}: {
  view: Extract<BookingAccountView, { kind: "login" | "signup" }>;
}) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const login = view.kind === "login";

  async function onSubmit(formData: FormData) {
    setLoading(true);
    setError("");
    const result = login
      ? await loginFromBookingAction(formData)
      : await registerFromBookingAction(formData);
    if (result?.error) {
      setError(result.error);
      setLoading(false);
    }
  }

  return (
    <form action={onSubmit} className="space-y-4">
      <input type="hidden" name="token" value={view.token} />
      {login ? null : (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="firstName">Имя</Label>
            <Input
              id="firstName"
              name="firstName"
              defaultValue={view.kind === "signup" ? view.firstName : ""}
              required
              autoComplete="given-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastName">Фамилия</Label>
            <Input
              id="lastName"
              name="lastName"
              defaultValue={view.kind === "signup" ? view.lastName : ""}
              autoComplete="family-name"
            />
          </div>
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="email">Почта</Label>
        <Input
          id="email"
          name="email"
          type="email"
          defaultValue={view.email}
          readOnly={login}
          required
          autoComplete="email"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Пароль</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={login ? undefined : 8}
          autoComplete={login ? "current-password" : "new-password"}
        />
      </div>
      {error ? <p className="text-sm text-[var(--danger-fg)]">{error}</p> : null}
      <Button type="submit" className="w-full" size="lg" disabled={loading}>
        {loading ? "Секунду…" : login ? "Войти" : "Создать кабинет"}
      </Button>
    </form>
  );
}
