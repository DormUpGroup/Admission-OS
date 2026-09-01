import { getCurrentStudent } from "@/server/auth/guards";
import { parseProgramsAnswers } from "@/lib/questionnaire-programs";
import { PortalProgramsQuestionnaireClient } from "./questionnaire-client";
import { formatDate } from "@/lib/utils";

export default async function PortalProgramsQuestionnairePage() {
  const { student } = await getCurrentStudent();
  const initialAnswers = parseProgramsAnswers(student.questionnaireProgramsJson);

  return (
    <div className="space-y-4">
      {student.questionnaireProgramsAt ? (
        <p className="text-xs text-muted-foreground">
          Последнее обновление: {formatDate(student.questionnaireProgramsAt)}
        </p>
      ) : null}
      <PortalProgramsQuestionnaireClient initialAnswers={initialAnswers} />
    </div>
  );
}
