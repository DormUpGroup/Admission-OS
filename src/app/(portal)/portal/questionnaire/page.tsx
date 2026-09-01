import { getCurrentStudent } from "@/server/auth/guards";
import { parsePersonalAnswers } from "@/lib/questionnaire-personal";
import { PortalPersonalQuestionnaireClient } from "./questionnaire-client";
import { formatDate } from "@/lib/utils";

export default async function PortalQuestionnairePage() {
  const { student } = await getCurrentStudent();
  const initialAnswers = parsePersonalAnswers(student.questionnairePersonalJson);

  return (
    <div className="space-y-4">
      {student.questionnaireAt ? (
        <p className="text-xs text-muted-foreground">
          Последнее обновление: {formatDate(student.questionnaireAt)}
        </p>
      ) : null}
      <PortalPersonalQuestionnaireClient initialAnswers={initialAnswers} />
    </div>
  );
}
