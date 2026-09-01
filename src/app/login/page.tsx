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
    <div className="min-h-screen flex items-center justify-center bg-[var(--brand-soft)] px-4">
      <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-white p-8 shadow-sm">
        <div className="mb-8">
          <p className="text-xs font-semibold tracking-[0.16em] text-[var(--brand)] uppercase">
            IMMIGROME
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--foreground)]">
            Система поступлений
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Войдите, чтобы продолжить</p>
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
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Вход…" : "Войти"}
          </Button>
        </form>
        <div className="mt-6 rounded-lg bg-neutral-50 p-3 text-xs text-neutral-600 space-y-1">
          <p className="font-medium text-neutral-800">Демо-аккаунты</p>
          <p>anna@immigrome.local / password123 (куратор)</p>
          <p>admin@immigrome.local / password123</p>
          <p>alina.sokolova@student.local / password123 (портал)</p>
        </div>
      </div>
    </div>
  );
}
