"use client";

import { useRouter } from "next/navigation";
import { QuestionnairePersonalForm } from "@/components/questionnaire-personal-form";
import { savePersonalQuestionnaireAction } from "@/server/actions";
import type { PersonalQuestionnaireAnswers } from "@/lib/questionnaire-personal";

export function PortalPersonalQuestionnaireClient({
  initialAnswers,
}: {
  initialAnswers: PersonalQuestionnaireAnswers;
}) {
  const router = useRouter();

  return (
    <QuestionnairePersonalForm
      initialAnswers={initialAnswers}
      onSubmit={async (answers) => {
        await savePersonalQuestionnaireAction(answers);
        router.push("/portal");
        router.refresh();
      }}
    />
  );
}
