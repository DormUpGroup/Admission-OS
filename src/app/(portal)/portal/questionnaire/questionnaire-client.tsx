"use client";

import { useRouter } from "next/navigation";
import { QuestionnairePersonalForm } from "@/components/questionnaire-personal-form";
import { savePersonalQuestionnaireAction } from "@/server/actions";
import type { PersonalQuestionnaireAnswers } from "@/lib/questionnaire-personal";

export function PortalPersonalQuestionnaireClient({
  initialAnswers,
  nextHref = "/portal/questionnaires",
}: {
  initialAnswers: PersonalQuestionnaireAnswers;
  nextHref?: string;
}) {
  const router = useRouter();

  return (
    <QuestionnairePersonalForm
      initialAnswers={initialAnswers}
      onSubmit={async (answers) => {
        await savePersonalQuestionnaireAction(answers);
        router.push(nextHref);
        router.refresh();
      }}
    />
  );
}
