import Link from "next/link";
import { requireStaff } from "@/server/auth/guards";
import { prisma } from "@/lib/db";
import { createStudentAction } from "@/server/actions";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

export default async function NewStudentPage() {
  const session = await requireStaff();
  const curators =
    session.user.role === "ADMIN"
      ? await prisma.user.findMany({
          where: { role: { in: ["ADMIN", "CURATOR"] } },
          orderBy: { name: "asc" },
        })
      : [];

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title="Добавить студента"
        description="Создайте профиль студента и назначьте куратора."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/students">Отмена</Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="pt-4">
          <form action={createStudentAction} className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="firstName">Имя</Label>
              <Input id="firstName" name="firstName" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName">Фамилия</Label>
              <Input id="lastName" name="lastName" required />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Телефон</Label>
              <Input id="phone" name="phone" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="country">Страна</Label>
              <Input id="country" name="country" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nationality">Гражданство</Label>
              <Input id="nationality" name="nationality" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="studyLevel">Уровень обучения</Label>
              <select
                id="studyLevel"
                name="studyLevel"
                defaultValue="BACHELOR"
                className="flex h-8 w-full rounded-md border border-input bg-card px-2.5 text-[13px]"
              >
                <option value="BACHELOR">Бакалавриат</option>
                <option value="MASTER">Магистратура</option>
                <option value="PHD">Аспирантура</option>
                <option value="OTHER">Другое</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="intake">Набор</Label>
              <Input id="intake" name="intake" defaultValue="2027/28" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="targetField">Целевое направление</Label>
              <Input id="targetField" name="targetField" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="preferredLanguage">Предпочтительный язык</Label>
              <Input id="preferredLanguage" name="preferredLanguage" />
            </div>
            {session.user.role === "ADMIN" ? (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="curatorId">Куратор</Label>
                <select
                  id="curatorId"
                  name="curatorId"
                  defaultValue={session.user.id}
                  className="flex h-8 w-full rounded-md border border-input bg-card px-2.5 text-[13px]"
                >
                  {curators.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
              <Button asChild variant="outline" type="button">
                <Link href="/admin/students">Отмена</Link>
              </Button>
              <Button type="submit">Создать студента</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
