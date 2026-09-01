/** Анкета №1 — личная информация (структура как в Google Form) */

export type FieldType =
  | "text"
  | "date"
  | "radio"
  | "radio_other"
  | "checkbox"
  | "textarea";

export type QuestionnaireField = {
  id: string;
  label: string;
  type: FieldType;
  required?: boolean;
  hint?: string;
  options?: string[];
};

export type QuestionnaireSection = {
  id: string;
  title: string;
  fields: QuestionnaireField[];
};

export const PERSONAL_QUESTIONNAIRE_TITLE = "Анкета №1";
export const PERSONAL_QUESTIONNAIRE_SUBTITLE =
  "Личная информация для поступления";

export const PERSONAL_QUESTIONNAIRE_SECTIONS: QuestionnaireSection[] = [
  {
    id: "personal",
    title: "Личная информация",
    fields: [
      {
        id: "firstNameLatin",
        label: "Имя (латиницей, как в загранпаспорте)",
        type: "text",
        required: true,
      },
      {
        id: "lastNameLatin",
        label: "Фамилия (латиницей, как в загранпаспорте)",
        type: "text",
        required: true,
      },
      {
        id: "nameChangeHistory",
        label:
          "Была ли смена имени и/или фамилии (по замужеству и пр.)?",
        type: "text",
        required: true,
      },
      {
        id: "dateOfBirth",
        label: "Дата рождения",
        type: "date",
        required: true,
      },
      {
        id: "maritalStatus",
        label: "Семейное положение (при наличии детей - указать)",
        type: "checkbox",
        required: true,
        options: [
          "Не замужем / Не женат",
          "Замужем / Женат",
          "Разведен / Разведена",
          "Вдовец / Вдова",
          "Есть дети",
        ],
      },
      {
        id: "telegram",
        label: "Ник в Telegram",
        type: "text",
        required: true,
      },
      {
        id: "gmailLogin",
        label: "Логин почты в Gmail (почта, которую мы попросили создать)",
        type: "text",
        required: true,
      },
      {
        id: "gmailPassword",
        label: "Пароль почты в Gmail (почта, которую мы попросили создать)",
        type: "text",
        required: true,
      },
      {
        id: "phone",
        label: "Номер телефона (через + с кодом страны)",
        type: "text",
        required: true,
      },
      {
        id: "passportExpiry",
        label: "Срок действия загранпаспорта",
        type: "date",
        required: true,
      },
    ],
  },
  {
    id: "birth",
    title: "Место рождения и адрес прописки",
    fields: [
      {
        id: "citizenship",
        label: "Гражданство (указать страну)",
        type: "text",
        required: true,
      },
      {
        id: "citizenshipDetails",
        label: "У тебя одно гражданство или несколько? Укажи какое/ие",
        type: "text",
        required: true,
      },
      {
        id: "countryOfBirth",
        label: "Страна рождения",
        type: "text",
        required: true,
      },
      {
        id: "cityOfBirth",
        label: "Город рождения",
        type: "text",
        required: true,
      },
    ],
  },
  {
    id: "education",
    title: "Образование",
    fields: [
      {
        id: "schoolDiploma",
        label: "Есть ли у тебя на руках школьный аттестат?",
        type: "radio",
        required: true,
        options: [
          "Нет аттестата, так как я еще учусь в школе",
          "Аттестат в школе/колледже/университете, не забрал/а",
          "Аттестат на руках",
          "Аттестат на руках, апостиль готов",
          "Аттестат на руках, апостиль и перевод готовы",
        ],
      },
      {
        id: "spoDiploma",
        label: "Есть ли у тебя диплом СПО (колледж, техникум и др.)?",
        type: "radio",
        required: true,
        options: [
          "Нет, я не учился/лась в СПО",
          "Нет диплома, так как я еще учусь в СПО",
          "Диплом СПО на руках",
          "Диплом СПО на руках, апостиль готов",
          "Диплом СПО на руках, апостиль и перевод готовы",
          "Нет диплома, так как я бросил/а учебу в СПО",
          "Диплом лежит в СПО/университете, не забрал/а",
        ],
      },
      {
        id: "bachelorDiploma",
        label: "Есть ли у тебя диплом бакалавра/специалиста?",
        type: "radio",
        required: true,
        options: [
          "Нет, я не учился/лась в университете",
          "Нет диплома, так как я еще учусь в университете",
          "Диплом бакалавра/специалиста на руках",
          "Диплом бакалавра/специалиста на руках, апостиль готов",
          "Диплом бакалавра/специалиста на руках, апостиль и перевод готовы",
          "Нет диплома, так как я бросил/а учебу в университете",
          "Диплом лежит в университете, не забрал/а",
        ],
      },
      {
        id: "masterDiploma",
        label: "Есть ли у тебя диплом магистра?",
        type: "radio",
        required: true,
        options: [
          "Нет, я не учился/лась в магистратуре",
          "Нет диплома, так как я еще учусь в университете",
          "Диплом магистра на руках",
          "Диплом магистра на руках, апостиль готов",
          "Диплом магистра на руках, апостиль и перевод готовы",
          "Нет диплома, так как я бросил/а учебу в университете",
          "Диплом лежит в университете, не забрал/а",
        ],
      },
    ],
  },
  {
    id: "extra",
    title: "Дополнительная информация",
    fields: [
      {
        id: "emergencyContact",
        label:
          "Контакт для экстренной связи (номер, имя, кем приходится). С этим человеком мы свяжемся в случае, если ты не будешь отвечать ни в телеграме, ни в других соц. сетях 2 недели и более, и у нас возникнет повод для беспокойства (может, утерян/украден телефон, проблемы со здоровьем и пр.)",
        type: "textarea",
        required: true,
      },
      {
        id: "comment",
        label: "Комментарий",
        type: "textarea",
        required: false,
      },
    ],
  },
];

export type PersonalQuestionnaireAnswers = Record<
  string,
  string | string[] | undefined
>;

export function emptyPersonalAnswers(): PersonalQuestionnaireAnswers {
  return {};
}

export function parsePersonalAnswers(
  json: string | null | undefined
): PersonalQuestionnaireAnswers {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
