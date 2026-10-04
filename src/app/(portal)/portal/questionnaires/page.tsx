import Link from "next/link";
import { getCurrentStudent } from "@/server/auth/guards";
import { hasMatchingProfile, hasQuestionnaire } from "@/server/services/program-match";
import { Button } from "@/components/ui/button";

export default async function PortalQuestionnairesPage() {
  const { student } = await getCurrentStudent();
  const personalDone = hasQuestionnaire(student);
  const programsDone = hasMatchingProfile(student);

  const items = [
    {
      number: "№1",
      title: "Личная информация",
      description: "Имя, контакты, гражданство и образование.",
      done: personalDone,
      href: "/portal/questionnaire",
      primary: !personalDone,
    },
    {
      number: "№2",
      title: "Подбор программ",
      description: "Уровень, язык, направления и города.",
      done: programsDone,
      href: "/portal/questionnaire-2",
      primary: personalDone && !programsDone,
      locked: !personalDone,
    },
  ] as const;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[24px] font-semibold tracking-tight sm:text-[28px]">Анкеты</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          Обе анкеты обязательны. Без них мы не запустим подбор программ.
        </p>
      </div>

      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.number} className="rounded-lg border border-border px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Анкета {item.number}
                </p>
                <p className="mt-1 text-[17px] font-medium tracking-tight">{item.title}</p>
                <p className="mt-1 text-[14px] text-muted-foreground">{item.description}</p>
                <p className="mt-2 text-[13px] font-medium">
                  {item.done ? "Заполнена" : "locked" in item && item.locked ? "Сначала заполните №1" : "Не заполнена"}
                </p>
              </div>
              {"locked" in item && item.locked ? (
                <Button size="sm" variant="outline" className="rounded-lg" disabled>
                  Заполнить
                </Button>
              ) : (
                <Button asChild size="sm" variant={item.primary ? "default" : "outline"} className="rounded-lg">
                  <Link href={item.href}>{item.done ? "Изменить" : "Заполнить"}</Link>
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
