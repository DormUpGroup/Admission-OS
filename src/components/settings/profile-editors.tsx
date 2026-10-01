"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  changeOwnNameAction,
  changeOwnPasswordAction,
} from "@/server/staff-account-actions";

export function ProfileEditors({ name }: { name: string }) {
  const [open, setOpen] = useState<"name" | "password" | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={open === "name" ? "default" : "outline"}
          onClick={() => setOpen(open === "name" ? null : "name")}
        >
          Сменить имя
        </Button>
        <Button
          type="button"
          variant={open === "password" ? "default" : "outline"}
          onClick={() => setOpen(open === "password" ? null : "password")}
        >
          Сменить пароль
        </Button>
      </div>

      {open === "name" ? (
        <form action={changeOwnNameAction} className="grid max-w-md gap-4">
          <div className="space-y-2">
            <Label htmlFor="profile-name">Имя</Label>
            <Input id="profile-name" name="name" defaultValue={name} required />
          </div>
          <div>
            <Button type="submit">Сохранить имя</Button>
          </div>
        </form>
      ) : null}

      {open === "password" ? (
        <form action={changeOwnPasswordAction} className="grid max-w-md gap-4">
          <div className="space-y-2">
            <Label htmlFor="current-password">Текущий пароль</Label>
            <Input
              id="current-password"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="next-password">Новый пароль</Label>
            <Input
              id="next-password"
              name="nextPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Повтор нового пароля</Label>
            <Input
              id="confirm-password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <div>
            <Button type="submit">Сохранить пароль</Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
