import Link from "next/link";
import { requireStaff } from "@/server/auth/guards";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { labelOf } from "@/lib/labels";
import { updateIntakeSeatLimitAction } from "@/server/actions";
import {
  formatIntakeLabel,
  occupiedSeatsForIntake,
} from "@/server/services/accompaniment";
import { AccompanimentStatus } from "@/lib/enums";

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requireStaff();
  const query = await searchParams;
  const canEditLimit = session.user.role === "ADMIN";

  const [cohorts, students] = await Promise.all([
    prisma.intakeCohort.findMany({ orderBy: { intake: "desc" } }),
    prisma.student.findMany({
      where: { status: { not: "ARCHIVED" } },
      select: { intake: true, accompanimentStatus: true },
    }),
  ]);

  const knownIntakes = [
    ...new Set([
      ...cohorts.map((c) => c.intake),
      ...students.map((s) => s.intake),
      "2027/28",
    ]),
  ];

  return (
    <div className="space-y-5 max-w-2xl">
      <PageHeader
        title="Настройки"
        description="Рабочее место сопровождения"
      />

      {query.error ? (
        <p className="rounded-lg border border-[var(--danger)] bg-[var(--danger-bg)]/40 px-4 py-2 text-sm text-[var(--danger-fg)]">
          {query.error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Набор на сопровождение</CardTitle>
          <CardDescription>
            Место занимает только ученик со статусом «Принят на сопровождение».
            Заполненная анкета место не занимает.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {knownIntakes.map((intake) => {
            const cohort = cohorts.find((c) => c.intake === intake);
            const occupied = occupiedSeatsForIntake(
              students.filter(
                (s) => s.accompanimentStatus === AccompanimentStatus.ACCEPTED
              ),
              intake
            );
            return (
              <form
                key={intake}
                action={updateIntakeSeatLimitAction}
                className="space-y-3 border-b border-border pb-4 last:border-b-0 last:pb-0"
              >
                <input type="hidden" name="intake" value={intake} />
                <p className="text-sm font-medium">Набор {formatIntakeLabel(intake)}</p>
                <p className="text-xs text-muted-foreground">
                  Принято сейчас: {occupied}
                  {cohort?.isActive ? " · текущий набор" : ""}
                </p>
                <div className="space-y-1">
                  <Label htmlFor={`limit-${intake}`}>Лимит мест</Label>
                  <Input
                    id={`limit-${intake}`}
                    name="seatLimit"
                    type="number"
                    min={0}
                    defaultValue={cohort?.seatLimit ?? ""}
                    placeholder="Не задан"
                    disabled={!canEditLimit}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="isActive"
                    defaultChecked={cohort?.isActive}
                    disabled={!canEditLimit}
                  />
                  Текущий активный набор
                </label>
                {canEditLimit ? (
                  <Button type="submit" size="sm">
                    Сохранить
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Лимит может изменить только администратор.
                  </p>
                )}
              </form>
            );
          })}

          {canEditLimit ? (
            <form action={updateIntakeSeatLimitAction} className="space-y-3">
              <p className="text-sm font-medium">Добавить набор</p>
              <div className="space-y-1">
                <Label htmlFor="new-intake">Набор (например 2028/29)</Label>
                <Input id="new-intake" name="intake" required placeholder="2028/29" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="new-limit">Лимит мест</Label>
                <Input
                  id="new-limit"
                  name="seatLimit"
                  type="number"
                  min={0}
                  placeholder="Не задан"
                />
              </div>
              <Button type="submit" size="sm" variant="outline">
                Добавить набор
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Рабочее пространство</CardTitle>
          <CardDescription>IMMIGROME OS</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div className="flex justify-between gap-4">
            <span>Вы вошли как</span>
            <span className="text-foreground font-medium">
              {session.user.name} ({labelOf(session.user.role)})
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span>Email</span>
            <span className="text-foreground">{session.user.email}</span>
          </div>
        </CardContent>
      </Card>

      {canEditLimit ? (
        <Card>
          <CardHeader>
            <CardTitle>Служебные разделы</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <Link href="/admin/programs" className="text-[var(--brand)] hover:underline">
                Каталог программ
              </Link>
            </p>
            <p>
              <Link href="/admin/data-quality" className="text-[var(--brand)] hover:underline">
                Качество данных
              </Link>
            </p>
            <p>
              <Link href="/admin/universities" className="text-[var(--brand)] hover:underline">
                Университеты
              </Link>
            </p>
            <p>
              <Link href="/admin/team" className="text-[var(--brand)] hover:underline">
                Команда
              </Link>
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
