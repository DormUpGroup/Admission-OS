/**
 * Questionnaire directions (Анкета №2) with hidden MIUR classe codes.
 * UI shows `label` only; matching uses `miur` for Universitaly `tipoClasse`.
 */

export type MiurClasseByLevel = {
  bachelor: string[];
  master: string[];
  singleCycle?: string[];
};

export type ProgramDirection = {
  label: string;
  /** Technical — never shown in the questionnaire UI. */
  miur: MiurClasseByLevel;
};

/**
 * Source of truth: direction label + related MIUR codes (often several per level).
 * Labels follow Italian LM-* class titles (RU translation).
 */
export const PROGRAM_DIRECTIONS: ProgramDirection[] = [
  {
    label: "Культурная антропология и этнология",
    miur: { bachelor: ["L-1", "L-5"], master: ["LM-1", "LM-64"] },
  },
  {
    label: "Археология",
    miur: { bachelor: ["L-1", "L-43"], master: ["LM-2", "LM-11"] },
  },
  {
    label: "Ландшафтная архитектура",
    miur: { bachelor: ["L-21", "L-17"], master: ["LM-3", "LM-48"] },
  },
  {
    label: "Архитектура и строительная инженерия-архитектура",
    miur: {
      bachelor: ["L-17", "L-23"],
      master: ["LM-4"],
      singleCycle: ["LM-4"],
    },
  },
  {
    label: "Архивное и библиотечное дело",
    miur: { bachelor: ["L-1", "L-10"], master: ["LM-5", "LM-14"] },
  },
  {
    label: "Биология",
    miur: { bachelor: ["L-13", "L-2"], master: ["LM-6", "LM-9"] },
  },
  {
    label: "Сельскохозяйственная биотехнология",
    miur: { bachelor: ["L-2", "L-13", "L-25"], master: ["LM-7", "LM-9"] },
  },
  {
    label: "Промышленные биотехнологии",
    miur: { bachelor: ["L-2", "L-13"], master: ["LM-8", "LM-9"] },
  },
  {
    label: "Медицинские, ветеринарные и фармацевтические биотехнологии",
    miur: { bachelor: ["L-2", "L-13", "L-29"], master: ["LM-9", "LM-6"] },
  },
  {
    label: "Сохранение архитектурного и экологического наследия",
    miur: {
      bachelor: ["L-17", "L-43", "L-1"],
      master: ["LM-11", "LM-4"],
    },
  },
  {
    label: "Сохранение и восстановление культурного наследия",
    miur: {
      bachelor: ["L-43", "L-1"],
      master: ["LM-11"],
      singleCycle: ["LMR/02"],
    },
  },
  {
    label: "Дизайн",
    miur: { bachelor: ["L-4", "L-3"], master: ["LM-12", "LM-65"] },
  },
  {
    label: "Фармацевтика",
    miur: {
      bachelor: ["L-29", "L-2"],
      master: ["LM-13"],
      singleCycle: ["LM-13"],
    },
  },
  {
    label: "Современная филология",
    miur: { bachelor: ["L-10", "L-11"], master: ["LM-14", "LM-15"] },
  },
  {
    label: "Филология, литература и история древности",
    miur: { bachelor: ["L-10", "L-1"], master: ["LM-15", "LM-14"] },
  },
  {
    label: "Финансы",
    miur: {
      bachelor: ["L-18", "L-33"],
      master: ["LM-16", "LM-56", "LM-77"],
    },
  },
  {
    label: "Физика",
    miur: { bachelor: ["L-30", "L-35"], master: ["LM-17", "LM-79"] },
  },
  {
    label: "Компьютерные технологии",
    miur: { bachelor: ["L-31", "L-8"], master: ["LM-18", "LM-32"] },
  },
  {
    label: "Информационно-издательские системы",
    miur: { bachelor: ["L-20", "L-10", "L-31"], master: ["LM-19", "LM-91"] },
  },
  {
    label: "Аэрокосмическая и астронавтическая инженерия",
    miur: { bachelor: ["L-9", "L-8"], master: ["LM-20", "LM-33"] },
  },
  {
    label: "Биомедицинская инженерия",
    miur: { bachelor: ["L-8", "L-9"], master: ["LM-21"] },
  },
  {
    label: "Химическая инженерия",
    miur: { bachelor: ["L-9", "L-27"], master: ["LM-22", "LM-71"] },
  },
  {
    label: "Гражданское строительство",
    miur: { bachelor: ["L-7", "L-23"], master: ["LM-23", "LM-24"] },
  },
  {
    label: "Инженерия строительных систем",
    miur: { bachelor: ["L-23", "L-7"], master: ["LM-24", "LM-23"] },
  },
  {
    label: "Автоматизация",
    miur: { bachelor: ["L-8", "L-9"], master: ["LM-25", "LM-32"] },
  },
  {
    label: "Техника безопасности",
    miur: { bachelor: ["L-7", "L-9"], master: ["LM-26"] },
  },
  {
    label: "Телекоммуникационная техника",
    miur: { bachelor: ["L-8", "L-9"], master: ["LM-27", "LM-29"] },
  },
  {
    label: "Электротехника",
    miur: { bachelor: ["L-9", "L-8"], master: ["LM-28", "LM-29"] },
  },
  {
    label: "Электронная инженерия",
    miur: { bachelor: ["L-8", "L-9"], master: ["LM-29", "LM-27"] },
  },
  {
    label: "Энергетика и ядерная инженерия",
    miur: { bachelor: ["L-9", "L-7"], master: ["LM-30", "LM-35"] },
  },
  {
    label: "Управленческая инженерия",
    miur: { bachelor: ["L-9", "L-18"], master: ["LM-31", "LM-77"] },
  },
  {
    label: "Компьютерная инженерия",
    miur: { bachelor: ["L-8", "L-31"], master: ["LM-32", "LM-18"] },
  },
  {
    label: "Инженерное дело",
    miur: { bachelor: ["L-9", "L-8"], master: ["LM-33", "LM-25"] },
  },
  {
    label: "Военно-морское дело",
    miur: { bachelor: ["L-9", "L-7"], master: ["LM-34"] },
  },
  {
    label: "Инжиниринг для окружающей среды и территории",
    miur: { bachelor: ["L-7", "L-32"], master: ["LM-35", "LM-75"] },
  },
  {
    label: "Языки Африки и Азии",
    miur: { bachelor: ["L-11", "L-12"], master: ["LM-37", "LM-38"] },
  },
  {
    label: "Современные европейские и американские языки",
    miur: { bachelor: ["L-11", "L-12"], master: ["LM-37", "LM-38"] },
  },
  {
    label: "Современные языки международного общения и сотрудничества",
    miur: { bachelor: ["L-11", "L-12"], master: ["LM-38", "LM-37"] },
  },
  {
    label: "Лингвистика",
    miur: { bachelor: ["L-11", "L-12"], master: ["LM-39", "LM-37"] },
  },
  {
    label: "Математика",
    miur: { bachelor: ["L-35", "L-30"], master: ["LM-40", "LM-44"] },
  },
  {
    label: "Медицина и хирургия",
    miur: { bachelor: [], master: [], singleCycle: ["LM-41"] },
  },
  {
    label: "Ветеринария",
    miur: { bachelor: [], master: [], singleCycle: ["LM-42"] },
  },
  {
    label: "Компьютерные методологии для гуманитарных наук",
    miur: { bachelor: ["L-31", "L-8"], master: ["LM-43", "LM-18"] },
  },
  {
    label: "Математико-физическое моделирование в инженерии",
    miur: {
      bachelor: ["L-35", "L-30", "L-9"],
      master: ["LM-44", "LM-40"],
    },
  },
  {
    label: "Музыковедение и культурное наследие",
    miur: { bachelor: ["L-3", "L-1"], master: ["LM-45", "LM-11"] },
  },
  {
    label: "Стоматология и протезирование зубов",
    miur: { bachelor: [], master: [], singleCycle: ["LM-46"] },
  },
  {
    label: "Организация и управление услугами для спорта и моторной деятельности",
    miur: { bachelor: ["L-22", "L-18"], master: ["LM-47", "LM-68"] },
  },
  {
    label: "Территориальное градостроительное и экологическое планирование",
    miur: { bachelor: ["L-21", "L-17"], master: ["LM-48", "LM-3"] },
  },
  {
    label: "Планирование и управление туристическими системами",
    miur: { bachelor: ["L-15", "L-18"], master: ["LM-49", "LM-76"] },
  },
  {
    label: "Планирование и управление образовательными услугами",
    miur: { bachelor: ["L-19", "L-24"], master: ["LM-50", "LM-85"] },
  },
  {
    label: "Психология",
    miur: { bachelor: ["L-24"], master: ["LM-51", "LM-55"] },
  },
  {
    label: "Международные отношения",
    miur: { bachelor: ["L-36", "L-16"], master: ["LM-52", "LM-62"] },
  },
  {
    label: "Материаловедение и инженерия",
    miur: { bachelor: ["L-9", "L-27"], master: ["LM-53.", "LM-33"] },
  },
  {
    label: "Химические науки",
    miur: { bachelor: ["L-27", "L-9"], master: ["LM-54", "LM-71"] },
  },
  {
    label: "Когнитивные науки",
    miur: { bachelor: ["L-24", "L-13"], master: ["LM-55", "LM-51"] },
  },
  {
    label: "Экономические науки",
    miur: { bachelor: ["L-33", "L-18"], master: ["LM-56", "LM-77"] },
  },
  {
    label: "Науки об образовании взрослых и непрерывном образовании",
    miur: { bachelor: ["L-19", "L-24"], master: ["LM-85", "LM-50"] },
  },
  {
    label: "Науки о Вселенной",
    miur: { bachelor: ["L-30", "L-32"], master: ["LM-17", "LM-79"] },
  },
  {
    label: "Науки о публичных, деловых и рекламных коммуникациях",
    miur: { bachelor: ["L-20", "L-18"], master: ["LM-59", "LM-77"] },
  },
  {
    label: "Наука о природе",
    miur: { bachelor: ["L-32", "L-13"], master: ["LM-60", "LM-75"] },
  },
  {
    label: "Науки о питании человека",
    miur: { bachelor: ["L-26", "L-13"], master: ["LM-61", "LM-70"] },
  },
  {
    label: "Политические науки",
    miur: { bachelor: ["L-36", "L-16"], master: ["LM-62", "LM-52"] },
  },
  {
    label: "Науки о государственном управлении",
    miur: { bachelor: ["L-16", "L-36"], master: ["LM-63", "LM-62"] },
  },
  {
    label: "Науки о религиях",
    miur: { bachelor: ["L-5", "L-1"], master: ["LM-64", "LM-1"] },
  },
  {
    label: "Развлекательные науки и мультимедийное производство",
    miur: { bachelor: ["L-3", "L-20"], master: ["LM-65", "LM-12"] },
  },
  {
    label: "IT безопасность",
    miur: { bachelor: ["L-31", "L-8"], master: ["LM-66", "LM-18"] },
  },
  {
    label: "Науки и методы профилактической и адаптированной двигательной активности",
    miur: { bachelor: ["L-22", "L-24"], master: ["LM-67", "LM-68"] },
  },
  {
    label: "Спортивные науки и техники",
    miur: { bachelor: ["L-22", "L-18"], master: ["LM-68", "LM-47"] },
  },
  {
    label: "Сельскохозяйственные науки и технологии",
    miur: { bachelor: ["L-25", "L-26"], master: ["LM-69", "LM-73"] },
  },
  {
    label: "Пищевая наука и технологии",
    miur: { bachelor: ["L-26", "L-25"], master: ["LM-70", "LM-61"] },
  },
  {
    label: "Науки и технологии промышленной химии",
    miur: { bachelor: ["L-27", "L-9"], master: ["LM-71", "LM-54"] },
  },
  {
    label: "Лесоводство и экологические науки и технологии",
    miur: { bachelor: ["L-25", "L-32"], master: ["LM-73", "LM-75"] },
  },
  {
    label: "Геологические науки и технологии",
    miur: { bachelor: ["L-34", "L-32"], master: ["LM-74", "LM-79"] },
  },
  {
    label: "Науки и технологии для окружающей среды и территории",
    miur: { bachelor: ["L-32", "L-7"], master: ["LM-75", "LM-35"] },
  },
  {
    label: "Экономические науки для окружающей среды и культуры",
    miur: { bachelor: ["L-33", "L-18"], master: ["LM-76", "LM-56"] },
  },
];

/** Labels only — used by questionnaire checkbox options. */
export const BACHELOR_DIRECTIONS = PROGRAM_DIRECTIONS.map((d) => d.label);

export const QUESTIONNAIRE_DIRECTION_MIUR: Record<string, MiurClasseByLevel> =
  Object.fromEntries(PROGRAM_DIRECTIONS.map((d) => [d.label, d.miur]));

export const MAPPED_QUESTIONNAIRE_DIRECTIONS = PROGRAM_DIRECTIONS.map(
  (d) => d.label
);

export function miurForDirectionLabel(
  label: string
): MiurClasseByLevel | undefined {
  return QUESTIONNAIRE_DIRECTION_MIUR[label];
}
