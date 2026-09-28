import { describe, expect, it } from "vitest";
import { buildLeadCard, readLeadFacts } from "@/lib/lead-profile";

function inbound(body: string) {
  return { direction: "INBOUND" as const, body };
}

function outbound(body: string) {
  return { direction: "OUTBOUND" as const, body };
}

describe("readLeadFacts", () => {
  it("keeps known fields in card order and appends extra saved text", () => {
    expect(
      readLeadFacts({
        budget: " стипендия ",
        studyLevel: "бакалавриат",
        city: "Турин",
        notes: "",
        score: 7,
      }),
    ).toEqual([
      { key: "studyLevel", label: "Уровень", value: "бакалавриат" },
      { key: "budget", label: "Бюджет", value: "стипендия" },
      { key: "city", label: "city", value: "Турин" },
      { key: "score", label: "score", value: "7" },
    ]);
  });

  it("returns nothing when nothing is saved", () => {
    expect(readLeadFacts(null)).toEqual([]);
  });
});

describe("buildLeadCard", () => {
  it("turns a chat into a short card and leaves the jokes out", () => {
    const card = buildLeadCard({
      messages: [
        outbound("Напишите, какая программа вам интересна."),
        inbound("Какие программы есть в Пьемонте по бизнесу или финансам?"),
        inbound("Бакалавриат. Расскажи про Английскую программу international law в Турине"),
        inbound("27/28"),
        inbound("Право"),
        inbound("Принципиально!!!!"),
        inbound("Я там планирую с вашим куратором жить вместушки"),
        inbound("Желательно со стипендией, денег нет"),
        inbound("Закончила 12 классов обучения"),
        inbound("Сейчас готовлюсь к ielts, сейчас уровень б2 наверно"),
        inbound("В декабре"),
        inbound("На руках, с апостилем, переведен"),
        outbound("А загранпаспорт есть?"),
        inbound("Есть"),
        inbound("Если там можно учиться удаленно то да"),
        inbound("Римини тоже можно"),
        inbound("Только обучение"),
        inbound("/start"),
      ],
    });

    expect(Object.fromEntries(card.map((row) => [row.key, row.value]))).toEqual({
      studyLevel: "Бакалавриат",
      targetField: "Бизнес, Финансы, International Law, Право",
      cities: "Пьемонт, Турин, Римини, удалённо",
      desiredIntake: "2027/28",
      educationLevel: "12 классов",
      passport: "есть",
      apostilleTranslation: "апостиль и перевод есть",
      language: "IELTS, около B2, сдача в декабре",
      budget: "нужна стипендия, денег нет, только обучение",
    });
    expect(card.some((row) => row.value.includes("вместушки"))).toBe(false);
  });

  it("reads a short answer card without copying greetings", () => {
    const card = buildLeadCard({
      messages: [
        inbound("привет"),
        inbound("ops-check 2026-09-25T09:16:05.554Z"),
        inbound("Бакалавр"),
        inbound("Биология"),
        inbound("Следующий"),
        inbound("Я в Италию поступаю, нет?)"),
        inbound("Школу окончил 12 классов"),
        inbound("Желательно как можно меньше"),
        inbound("Сколько стоит сопровождение?"),
      ],
    });

    expect(Object.fromEntries(card.map((row) => [row.key, row.value]))).toEqual({
      studyLevel: "Бакалавриат",
      targetField: "Биология",
      desiredIntake: "следующий набор",
      educationLevel: "12 классов",
      budget: "как можно меньше",
    });
  });

  it("keeps a saved fact when the chat says something else", () => {
    const card = buildLeadCard({
      qualificationJson: { studyLevel: "магистратура" },
      messages: [inbound("Бакалавриат")],
    });
    expect(card).toEqual([{ key: "studyLevel", label: "Уровень", value: "магистратура" }]);
  });

  it("stays empty when the chat is only greetings", () => {
    expect(
      buildLeadCard({
        messages: [inbound("привет"), inbound("как дела?"), inbound("/help")],
      }),
    ).toEqual([]);
  });
});
