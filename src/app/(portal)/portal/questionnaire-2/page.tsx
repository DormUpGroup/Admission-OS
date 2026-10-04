import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudent } from "@/server/auth/guards";
import { parseProgramsAnswers } from "@/lib/questionnaire-programs";
import { hasQuestionnaire } from "@/server/services/program-match";
import { PortalProgramsQuestionnaireClient } from "./questionnaire-client";
import { formatDate } from "@/lib/utils";

export default async function PortalProgramsQuestionnairePage() {
  const { student } = await getCurrentStudent();
  if (!hasQuestionnaire(student)) {
    redirect("/portal/questionnaire");
  }
  const initialAnswers = parseProgramsAnswers(student.questionnaireProgramsJson);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Анкета №2
          </p>
          <h1 className="mt-1 text-[24px] font-semibold tracking-tight sm:text-[28px]">
            Подбор программ
          </h1>
          {student.questionnaireProgramsAt ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Последнее обновление: {formatDate(student.questionnaireProgramsAt)}
            </p>
          ) : (
            <p className="mt-1 text-[15px] text-muted-foreground">
              Обязательна для подбора вузов и программ.
            </p>
          )}
        </div>
        <Link href="/portal/questionnaires" className="text-[13px] text-muted-foreground hover:underline">
          Все анкеты
        </Link>
      </div>
      <PortalProgramsQuestionnaireClient initialAnswers={initialAnswers} />
    </div>
  );
}
