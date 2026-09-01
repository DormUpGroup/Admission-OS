import type { QuestionnaireSection } from "@/lib/questionnaire-personal";
import { BACHELOR_DIRECTIONS } from "@/lib/program-directions";

export { BACHELOR_DIRECTIONS };

export const PROGRAMS_QUESTIONNAIRE_TITLE = "Анкета №2";
export const PROGRAMS_QUESTIONNAIRE_SUBTITLE = "Подбор программ";

export const PREFERRED_CITIES = [
  "Chieti",
  "L'Aquila",
  "Teramo",
  "Potenza",
  "Catanzaro",
  "Reggio Calabria",
  "Cosenza",
  "Napoli",
  "Benevento",
  "Salerno",
  "Bologna",
  "Ferrara",
  "Modena",
  "Parma",
  "Trieste",
  "Udine",
  "Roma",
  "Viterbo",
  "Cassino",
  "Genova",
  "Milano",
  "Varese/Como",
  "Bergamo",
  "Brescia",
  "Pavia",
  "Ancona",
  "Camerino (Macerata)",
  "Macerata",
  "Urbino",
  "Campobasso",
  "Torino",
  "Bari",
  "Foggia",
  "Lecce",
  "Cagliari",
  "Sassari",
  "Catania",
  "Messina",
  "Palermo",
  "Pisa",
  "Siena",
  "Bolzano",
  "Trento",
  "Perugia",
  "Aosta",
  "Venezia",
  "Padova",
  "Verona",
  "Forlì",
  "Ravenna",
  "Rimini",
  "Firenze",
  "Вся Италия",
] as const;

/** Города для «куда точно НЕ хотел/а» — без «Вся Италия» */
export const AVOID_CITIES = PREFERRED_CITIES.filter((c) => c !== "Вся Италия");

const LANG_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2", "Не владею"];

export const PROGRAMS_QUESTIONNAIRE_SECTIONS: QuestionnaireSection[] = [
  {
    id: "basics",
    title: "Планы поступления",
    fields: [
      {
        id: "fullName",
        label: "Фамилия и имя",
        type: "text",
        required: true,
      },
      {
        id: "studyLevelPlan",
        label: "Уровень образования, на который я планирую поступать в Италии",
        type: "radio",
        required: true,
        options: [
          "Foundation year",
          "Бакалавриат",
          "Магистратура",
          "Master (Professional Master)",
        ],
      },
      {
        id: "studyLanguage",
        label: "Язык, на котором я планирую учиться",
        type: "radio",
        required: true,
        options: [
          "Английский",
          "Итальянский",
          "Рассматриваю оба варианта",
        ],
      },
    ],
  },
  {
    id: "languages",
    title: "Языки",
    fields: [
      {
        id: "englishLevel",
        label: "Уровень владения английским языком",
        type: "radio",
        required: true,
        options: [...LANG_LEVELS],
      },
      {
        id: "englishCertificate",
        label:
          "Есть ли сертификат, подтверждающий владение английским языком? Если да, то какой сертификат и какой уровень (или количество баллов)",
        type: "text",
        required: true,
      },
      {
        id: "italianLevel",
        label: "Уровень владения итальянским языком",
        type: "radio",
        required: true,
        options: [...LANG_LEVELS],
      },
      {
        id: "italianCertificate",
        label:
          "Есть ли сертификат, подтверждающий владение итальянским языком? Если да, то какой сертификат и какой уровень (или количество баллов)",
        type: "text",
        required: true,
      },
      {
        id: "otherLanguages",
        label:
          "Владеешь ли ты другими языками? Если да, то какими языками, на каком уровне и есть ли сертификат",
        type: "text",
        required: true,
      },
      {
        id: "studyAbroad",
        label: "Опыт обучения за границей? Если да, то укажи когда и где",
        type: "text",
        required: true,
      },
      {
        id: "previousSpecialty",
        label: "Специальность предыдущего образования (если есть)",
        type: "text",
        required: false,
      },
    ],
  },
  {
    id: "directions",
    title: "Бакалавриат",
    fields: [
      {
        id: "preferredDirections",
        label: "Предпочтительные направления (можно указать несколько вариантов)",
        type: "checkbox",
        required: true,
        options: [...BACHELOR_DIRECTIONS],
      },
      {
        id: "otherDirections",
        label:
          "Если тебя интересует какое-либо другое направление, которое НЕ указано выше, оставь его здесь (можно несколько)",
        type: "text",
        required: false,
      },
    ],
  },
  {
    id: "location",
    title: "Расположение",
    fields: [
      {
        id: "preferredCities",
        label: "Предпочтительные города",
        type: "checkbox",
        required: true,
        options: [...PREFERRED_CITIES],
      },
      {
        id: "avoidCities",
        label: "Есть ли город/а, куда бы ты точно НЕ хотел/а ехать?",
        type: "checkbox",
        required: false,
        options: [...AVOID_CITIES],
      },
    ],
  },
  {
    id: "extra",
    title: "Дополнительная информация",
    fields: [
      {
        id: "dsuScholarship",
        label: "Планируешь ли ты подаваться на стипендию DSU?",
        type: "radio_other",
        required: true,
        options: [
          "Да",
          "Нет",
          "Поступаю на Foundation year",
          "Поступаю на Master",
          "Other",
        ],
      },
      {
        id: "extraComment",
        label: "Если хочешь поделиться чем-то важным, можешь написать здесь",
        type: "textarea",
        required: false,
      },
    ],
  },
];

export type ProgramsQuestionnaireAnswers = Record<
  string,
  string | string[] | undefined
>;

export function parseProgramsAnswers(
  json: string | null | undefined
): ProgramsQuestionnaireAnswers {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Маппинг ответов анкеты №2 → поля профиля для matching */
export function mapProgramsAnswersToProfile(answers: ProgramsQuestionnaireAnswers) {
  const level = String(answers.studyLevelPlan ?? "");
  let studyLevel = "BACHELOR";
  if (level.includes("Foundation")) studyLevel = "FOUNDATION";
  else if (level.includes("Магистратура") || level.includes("Master"))
    studyLevel = "MASTER";
  else if (
    level.includes("Single-cycle") ||
    level.includes("single-cycle") ||
    level.includes("единый")
  )
    studyLevel = "SINGLE_CYCLE";
  else if (level.includes("Бакалавриат")) studyLevel = "BACHELOR";

  const lang = String(answers.studyLanguage ?? "").toLowerCase();
  let preferredLanguage = "English";
  if (lang.includes("итальянский") && !lang.includes("оба"))
    preferredLanguage = "Italian";
  else if (lang.includes("оба")) preferredLanguage = "English";
  else if (lang.includes("английский")) preferredLanguage = "English";

  const directions = Array.isArray(answers.preferredDirections)
    ? answers.preferredDirections
    : [];
  const other =
    typeof answers.otherDirections === "string"
      ? answers.otherDirections.trim()
      : "";
  const targetField = directions[0] || other || null;

  const preferredCities = Array.isArray(answers.preferredCities)
    ? answers.preferredCities.filter((c) => c !== "Вся Италия")
    : [];
  // «Вся Италия» → no city preference (empty list); do not expand to all cities.

  return { studyLevel, preferredLanguage, targetField, preferredCities };
}
