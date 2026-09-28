"use client";

import { useState } from "react";
import { completeRegistrationAction } from "@/server/registration-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function JoinForm({ token, email }: { token: string; email: string }) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(formData: FormData) {
    setLoading(true);
    setError("");
    const result = await completeRegistrationAction(formData);
    if (result?.error) {
      setError(result.error);
      setLoading(false);
    }
  }

  return (
    <form action={onSubmit} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <div className="space-y-2">
        <Label htmlFor="email">Почта</Label>
        <Input id="email" name="email" type="email" defaultValue={email} readOnly />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Пароль</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </div>
      {error ? (
        <p className="text-sm text-[var(--danger-fg)]" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" size="lg" disabled={loading}>
        {loading ? "Создаём кабинет…" : "Создать кабинет"}
      </Button>
    </form>
  );
}
