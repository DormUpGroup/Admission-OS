import Link from "next/link";
import { getCurrentStudent } from "@/server/auth/guards";
import { parsePersonalAnswers } from "@/lib/questionnaire-personal";
import { hasMatchingProfile } from "@/server/services/program-match";
import { PortalPersonalQuestionnaireClient } from "./questionnaire-client";
import { formatDate } from "@/lib/utils";

export default async function PortalQuestionnairePage() {
  const { student } = await getCurrentStudent();
  const initialAnswers = parsePersonalAnswers(student.questionnairePersonalJson);
  const nextHref = hasMatchingProfile(student)
    ? "/portal/questionnaires"
    : "/portal/questionnaire-2";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Анкета №1
          </p>
          <h1 className="mt-1 text-[24px] font-semibold tracking-tight sm:text-[28px]">
            Личная информация
          </h1>
          {student.questionnaireAt ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Последнее обновление: {formatDate(student.questionnaireAt)}
            </p>
          ) : (
            <p className="mt-1 text-[15px] text-muted-foreground">
              Обязательна для начала работы. После неё откроется анкета №2.
            </p>
          )}
        </div>
        <Link href="/portal/questionnaires" className="text-[13px] text-muted-foreground hover:underline">
          Все анкеты
        </Link>
      </div>
      <PortalPersonalQuestionnaireClient initialAnswers={initialAnswers} nextHref={nextHref} />
    </div>
  );
}
