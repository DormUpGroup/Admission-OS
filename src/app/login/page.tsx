"use client";

import { useState } from "react";
import { loginAction } from "@/server/auth-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(formData: FormData) {
    setLoading(true);
    setError("");
    const result = await loginAction(formData);
    if (result?.error) {
      setError(result.error);
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="surface-card w-full max-w-md rounded-[28px] p-8">
        <div className="mb-8">
          <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
            IMMIGROME
          </p>
          <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-foreground">
            Система поступлений
          </h1>
          <p className="mt-1 text-[15px] text-muted-foreground">Войдите, чтобы продолжить</p>
        </div>
        <form action={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              defaultValue="anna@immigrome.local"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Пароль</Label>
            <Input
              id="password"
              name="password"
              type="password"
              defaultValue="password123"
              required
            />
          </div>
          {error && <p className="text-sm text-[var(--danger-fg)]">{error}</p>}
          <Button type="submit" className="w-full" size="lg" disabled={loading}>
            {loading ? "Вход…" : "Войти"}
          </Button>
        </form>
        <div className="mt-6 rounded-2xl bg-muted p-4 text-[13px] text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">Демо-аккаунты</p>
          <p>anna@immigrome.local / password123 (куратор)</p>
          <p>admin@immigrome.local / password123</p>
          <p>alina.sokolova@student.local / password123 (портал)</p>
        </div>
      </div>
    </div>
  );
}
