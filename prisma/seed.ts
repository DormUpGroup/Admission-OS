import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { recalculateStudent } from "../src/server/services/recalculate";

const prisma = new PrismaClient();

function daysFromNow(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

function daysAgo(n: number) {
  return daysFromNow(-n);
}

async function main() {
  await prisma.programChangeEvent.deleteMany();
  await prisma.studentShortlistItem.deleteMany();
  await prisma.programMatch.deleteMany();
  await prisma.admissionRequirement.deleteMany();
  await prisma.tuitionInfo.deleteMany();
  await prisma.admissionCycle.deleteMany();
  await prisma.programFact.deleteMany();
  await prisma.sourceDocumentSection.deleteMany();
  await prisma.sourceDocument.deleteMany();
  await prisma.scholarshipRule.deleteMany();
  await prisma.scholarshipProgram.deleteMany();
  await prisma.programAcademicYear.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.deadline.deleteMany();
  await prisma.task.deleteMany();
  await prisma.requirement.deleteMany();
  await prisma.document.deleteMany();
  await prisma.application.deleteMany();
  await prisma.applicationTemplateItem.deleteMany();
  await prisma.applicationTemplate.deleteMany();
  await prisma.program.deleteMany();
  await prisma.university.deleteMany();
  await prisma.student.deleteMany();
  await prisma.intakeCohort.deleteMany();
  await prisma.user.deleteMany();

  const { ingestAllCatalog } = await import(
    "../src/server/services/program-ingestion/ingest"
  );
  const passwordHash = await bcrypt.hash("password123", 10);

  const admin = await prisma.user.create({
    data: {
      email: "admin@immigrome.local",
      name: "Owner Admin",
      role: "ADMIN",
      passwordHash,
    },
  });

  const anna = await prisma.user.create({
    data: {
      email: "anna@immigrome.local",
      name: "Anna Curator",
      role: "CURATOR",
      passwordHash,
    },
  });
  const marco = await prisma.user.create({
    data: {
      email: "marco@immigrome.local",
      name: "Marco Curator",
      role: "CURATOR",
      passwordHash,
    },
  });
  const elena = await prisma.user.create({
    data: {
      email: "elena@immigrome.local",
      name: "Elena Curator",
      role: "CURATOR",
      passwordHash,
    },
  });

  const curators = [anna, marco, elena];

  await ingestAllCatalog();

  const programs = await prisma.program.findMany({
    include: { university: true },
    orderBy: [{ university: { name: "asc" } }, { name: "asc" }],
  });

  async function programBySlug(slug: string) {
    const p = programs.find((x) => x.slug === slug);
    if (!p) throw new Error(`Program slug not found: ${slug}`);
    return p;
  }

  const bolognaEcon = await programBySlug("economics-and-finance");
  const turinBusiness = await programBySlug("business-management");
  const cafoscariEcon = await programBySlug("economics-en");
  const padovaEcon = await programBySlug("economics-padova");

  const template = await prisma.applicationTemplate.create({
    data: {
      name: "Bologna Economics 2027/28",
      programId: bolognaEcon.id,
      intake: "2027/28",
      items: {
        create: [
          { name: "Passport", type: "DOCUMENT", isCritical: true },
          { name: "Transcript", type: "DOCUMENT", isCritical: true },
          { name: "IELTS", type: "LANGUAGE", isCritical: true },
          { name: "SAT", type: "EXAM", isCritical: false },
          { name: "Motivation Letter", type: "DOCUMENT", isCritical: true },
          { name: "Application Fee", type: "PAYMENT", isCritical: true },
        ],
      },
    },
  });

  const studentDefs = [
    { first: "Alina", last: "Sokolova", country: "Kazakhstan", curator: anna, stage: "APPLICATIONS", case: "alina" },
    { first: "Maria", last: "Ivanova", country: "Russia", curator: anna, stage: "APPLICATIONS", case: "waiting" },
    { first: "Sofia", last: "Petrov", country: "Ukraine", curator: marco, stage: "APPLICATIONS", case: "deadline" },
    { first: "Dmitry", last: "Kozlov", country: "Kazakhstan", curator: anna, stage: "ADMISSION", case: "submitted" },
    { first: "Nina", last: "Volkova", country: "Belarus", curator: elena, stage: "ADMISSION", case: "admitted" },
    { first: "Omar", last: "Hassan", country: "Egypt", curator: marco, stage: "APPLICATIONS", case: "rejected" },
    { first: "Lara", last: "Chen", country: "China", curator: elena, stage: "APPLICATIONS", case: "healthy" },
    { first: "Youssef", last: "Amari", country: "Morocco", curator: anna, stage: "PROGRAMS", case: "healthy" },
    { first: "Anastasia", last: "Belova", country: "Russia", curator: marco, stage: "APPLICATIONS", case: "waiting" },
    { first: "Kenji", last: "Sato", country: "Japan", curator: elena, stage: "STRATEGY", case: "healthy" },
    { first: "Fatima", last: "Alami", country: "Tunisia", curator: anna, stage: "APPLICATIONS", case: "missing" },
    { first: "Pavel", last: "Novak", country: "Czechia", curator: marco, stage: "APPLICATIONS", case: "deadline" },
    { first: "Aisha", last: "Khan", country: "Pakistan", curator: elena, stage: "APPLICATIONS", case: "healthy" },
    { first: "Luca", last: "Rossi", country: "Italy", curator: anna, stage: "ENROLLMENT", case: "admitted" },
    { first: "Mei", last: "Wang", country: "China", curator: marco, stage: "APPLICATIONS", case: "missing" },
  ] as const;

  const students = [];
  for (const s of studentDefs) {
    const user = await prisma.user.create({
      data: {
        email: `${s.first.toLowerCase()}.${s.last.toLowerCase()}@student.local`,
        name: `${s.first} ${s.last}`,
        role: "STUDENT",
        passwordHash,
      },
    });
    const student = await prisma.student.create({
      data: {
        userId: user.id,
        firstName: s.first,
        lastName: s.last,
        email: user.email,
        phone: `+39 3${Math.floor(100000000 + Math.random() * 899999999)}`,
        country: s.country,
        nationality: s.country,
        studyLevel: "BACHELOR",
        intake: "2027/28",
        targetField: "Economics",
        preferredLanguage: "English",
        status: "ACTIVE",
        journeyStage: s.stage,
        curatorId: s.curator.id,
      },
    });
    students.push({ ...student, caseType: s.case, curator: s.curator });
  }

  const alina = students.find((s) => s.caseType === "alina")!;

  await prisma.student.update({
    where: { id: alina.id },
    data: {
      preferredCities: JSON.stringify(["Bologna", "Turin", "Venice", "Padova"]),
      questionnaireAt: new Date(),
      questionnaireProgramsAt: new Date(),
      journeyStage: "APPLICATIONS",
      nationality: "Kazakhstan",
      country: "Kazakhstan",
      studyLevel: "BACHELOR",
      preferredLanguage: "English",
      targetField: "Economics",
      intake: "2027/28",
      questionnairePersonalJson: JSON.stringify({
        firstNameLatin: "Alina",
        lastNameLatin: "Sokolova",
        citizenship: "Kazakhstan",
        countryOfBirth: "Kazakhstan",
        schoolDiploma: "Есть",
        bachelorDiploma: "Нет",
      }),
      questionnaireProgramsJson: JSON.stringify({
        fullName: "Alina Sokolova",
        studyLevelPlan: "Бакалавриат",
        studyLanguage: "Английский",
        englishLevel: "C1",
        englishCertificate: "IELTS 7.0, SAT 1280",
        italianLevel: "A2",
        italianCertificate: "Нет",
        otherLanguages: "Russian C2",
        studyAbroad: "Нет",
        previousSpecialty: "Economics",
        preferredDirections: ["Финансы", "Экономические науки"],
        preferredCities: ["Bologna", "Turin", "Venice", "Padova"],
        avoidCities: [],
        dsuScholarship: "Да",
      }),
    },
  });

  async function ensureDoc(
    studentId: string,
    name: string,
    category: string,
    status: string,
    opts: Partial<{
      requestedAt: Date;
      uploadedAt: Date;
      reviewedAt: Date;
      reviewedById: string;
      studentFeedback: string;
      notesInternal: string;
    }> = {}
  ) {
    return prisma.document.create({
      data: {
        studentId,
        name,
        category,
        status,
        requestedAt: opts.requestedAt,
        uploadedAt: opts.uploadedAt,
        reviewedAt: opts.reviewedAt,
        reviewedById: opts.reviewedById,
        studentFeedback: opts.studentFeedback,
        notesInternal: opts.notesInternal,
        version: status === "MISSING" ? 0 : 1,
      },
    });
  }

  // Alina — DoD scenario
  const alinaPassport = await ensureDoc(alina.id, "Passport", "PERSONAL", "APPROVED", {
    uploadedAt: daysAgo(20),
    reviewedAt: daysAgo(18),
    reviewedById: anna.id,
    notesInternal: "Valid until 2030",
  });
  const alinaTranscript = await ensureDoc(alina.id, "Transcript", "EDUCATION", "APPROVED", {
    uploadedAt: daysAgo(15),
    reviewedAt: daysAgo(14),
    reviewedById: anna.id,
  });
  const alinaIelts = await ensureDoc(alina.id, "IELTS", "LANGUAGE", "MISSING");
  const alinaSat = await ensureDoc(alina.id, "SAT", "EXAMS", "APPROVED", {
    uploadedAt: daysAgo(10),
    reviewedAt: daysAgo(9),
    reviewedById: anna.id,
  });
  const alinaMot = await ensureDoc(alina.id, "Motivation Letter", "OTHER", "UNDER_REVIEW", {
    uploadedAt: daysAgo(2),
  });
  await ensureDoc(alina.id, "Photo", "PERSONAL", "APPROVED", {
    uploadedAt: daysAgo(12),
    reviewedAt: daysAgo(11),
    reviewedById: anna.id,
  });

  const alinaPrograms = [bolognaEcon, turinBusiness, cafoscariEcon, padovaEcon];
  const alinaApps = [];
  for (let i = 0; i < alinaPrograms.length; i++) {
    const prog = alinaPrograms[i];
    const app = await prisma.application.create({
      data: {
        studentId: alina.id,
        programId: prog.id,
        status: "PREPARING",
        intake: "2027/28",
        applicationRound: "First call",
        admissionType: "Standard",
        requiredExam: "SAT",
        requiredEnglish: "IELTS B2",
        applicationFee: "€50",
        hardDeadline: daysFromNow(i === 0 ? 8 : 20 + i * 5),
        targetSubmissionDate: daysFromNow(i === 0 ? 5 : 15 + i * 5),
      },
    });
    alinaApps.push(app);

    if (i === 0) {
      await prisma.requirement.createMany({
        data: [
          { applicationId: app.id, name: "Passport", type: "DOCUMENT", status: "COMPLETED", isCritical: true, relatedDocumentId: alinaPassport.id },
          { applicationId: app.id, name: "Transcript", type: "DOCUMENT", status: "COMPLETED", isCritical: true, relatedDocumentId: alinaTranscript.id },
          { applicationId: app.id, name: "IELTS", type: "LANGUAGE", status: "MISSING", isCritical: true, relatedDocumentId: alinaIelts.id },
          { applicationId: app.id, name: "SAT", type: "EXAM", status: "COMPLETED", isCritical: false, relatedDocumentId: alinaSat.id },
          { applicationId: app.id, name: "Motivation Letter", type: "DOCUMENT", status: "UNDER_REVIEW", isCritical: true, relatedDocumentId: alinaMot.id },
          { applicationId: app.id, name: "Application Fee", type: "PAYMENT", status: "MISSING", isCritical: true },
        ],
      });
    } else {
      await prisma.requirement.createMany({
        data: [
          { applicationId: app.id, name: "Passport", type: "DOCUMENT", status: "COMPLETED", isCritical: true, relatedDocumentId: alinaPassport.id },
          { applicationId: app.id, name: "Transcript", type: "DOCUMENT", status: "COMPLETED", isCritical: true, relatedDocumentId: alinaTranscript.id },
          { applicationId: app.id, name: "IELTS", type: "LANGUAGE", status: "MISSING", isCritical: true, relatedDocumentId: alinaIelts.id },
          { applicationId: app.id, name: "Motivation Letter", type: "DOCUMENT", status: "MISSING", isCritical: true },
        ],
      });
    }

    await prisma.deadline.create({
      data: {
        title: `${prog.name} hard deadline`,
        date: app.hardDeadline!,
        type: "HARD",
        studentId: alina.id,
        applicationId: app.id,
        isHardDeadline: true,
        isInternal: false,
        riskWeight: 3,
      },
    });
    await prisma.deadline.create({
      data: {
        title: `Target submission — ${prog.name}`,
        date: app.targetSubmissionDate!,
        type: "TARGET",
        studentId: alina.id,
        applicationId: app.id,
        isHardDeadline: false,
        isInternal: true,
        riskWeight: 1,
      },
    });
  }

  await prisma.task.createMany({
    data: [
      {
        title: "Request IELTS from Alina",
        studentId: alina.id,
        applicationId: alinaApps[0].id,
        documentId: alinaIelts.id,
        assigneeId: anna.id,
        status: "TODO",
        priority: "URGENT",
        dueDate: daysFromNow(0),
        isStudentFacing: false,
      },
      {
        title: "Review Motivation Letter",
        studentId: alina.id,
        applicationId: alinaApps[0].id,
        documentId: alinaMot.id,
        assigneeId: anna.id,
        status: "IN_PROGRESS",
        priority: "HIGH",
        dueDate: daysFromNow(1),
        isStudentFacing: false,
      },
      {
        title: "Pay Bologna application fee",
        studentId: alina.id,
        applicationId: alinaApps[0].id,
        assigneeId: anna.id,
        status: "TODO",
        priority: "HIGH",
        dueDate: daysFromNow(4),
        isStudentFacing: true,
      },
    ],
  });

  await prisma.activity.createMany({
    data: [
      { type: "STUDENT_CREATED", studentId: alina.id, userId: anna.id },
      { type: "APPLICATION_CREATED", studentId: alina.id, applicationId: alinaApps[0].id, userId: anna.id, metadata: JSON.stringify({ university: "University of Bologna" }) },
      { type: "DOCUMENT_APPROVED", studentId: alina.id, userId: anna.id, metadata: JSON.stringify({ name: "Passport" }) },
      { type: "DOCUMENT_APPROVED", studentId: alina.id, userId: anna.id, metadata: JSON.stringify({ name: "Transcript" }) },
      { type: "DOCUMENT_UPLOADED", studentId: alina.id, metadata: JSON.stringify({ name: "Motivation Letter" }) },
    ],
  });

  // Other students — varied cases
  for (const student of students) {
    if (student.id === alina.id) continue;

    const progA = programs[Math.floor(Math.random() * programs.length)];
    const progB = programs[(programs.indexOf(progA) + 1) % programs.length];

    const docs = {
      passport: await ensureDoc(
        student.id,
        "Passport",
        "PERSONAL",
        student.caseType === "missing" ? "MISSING" : student.caseType === "waiting" ? "REQUESTED" : "APPROVED",
        student.caseType === "waiting"
          ? { requestedAt: daysAgo(student.firstName === "Maria" ? 7 : 11) }
          : student.caseType === "missing"
            ? {}
            : { uploadedAt: daysAgo(20), reviewedAt: daysAgo(18), reviewedById: student.curator.id }
      ),
      transcript: await ensureDoc(
        student.id,
        "Transcript",
        "EDUCATION",
        student.caseType === "waiting" && student.firstName === "Sofia"
          ? "REQUESTED"
          : student.caseType === "missing"
            ? "MISSING"
            : "APPROVED",
        student.caseType === "waiting" && student.firstName === "Sofia"
          ? { requestedAt: daysAgo(11) }
          : { uploadedAt: daysAgo(15), reviewedAt: daysAgo(14), reviewedById: student.curator.id }
      ),
      ielts: await ensureDoc(
        student.id,
        "IELTS",
        "LANGUAGE",
        ["healthy", "submitted", "admitted"].includes(student.caseType)
          ? "APPROVED"
          : student.caseType === "waiting"
            ? "REQUESTED"
            : "MISSING",
        student.caseType === "waiting"
          ? { requestedAt: daysAgo(3) }
          : ["healthy", "submitted", "admitted"].includes(student.caseType)
            ? { uploadedAt: daysAgo(8), reviewedAt: daysAgo(7), reviewedById: student.curator.id }
            : {}
      ),
    };

    for (const [idx, prog] of [progA, progB].entries()) {
      let status = "PREPARING";
      if (student.caseType === "submitted") status = idx === 0 ? "SUBMITTED" : "PREPARING";
      if (student.caseType === "admitted") status = idx === 0 ? "ADMITTED" : "SUBMITTED";
      if (student.caseType === "rejected") status = idx === 0 ? "REJECTED" : "PREPARING";
      if (student.caseType === "healthy") status = "PREPARING";

      const hardDeadline =
        student.caseType === "deadline"
          ? daysFromNow(idx === 0 ? 2 : 6)
          : daysFromNow(20 + idx * 10);

      const app = await prisma.application.create({
        data: {
          studentId: student.id,
          programId: prog.id,
          status,
          intake: "2027/28",
          applicationRound: "First call",
          hardDeadline,
          targetSubmissionDate: daysFromNow(
            student.caseType === "deadline" ? 1 : 15 + idx * 8
          ),
          submittedAt: ["submitted", "admitted", "rejected"].includes(student.caseType) && idx === 0
            ? daysAgo(10)
            : null,
          applicationFeePaid: ["submitted", "admitted"].includes(student.caseType) && idx === 0,
        },
      });

      const ieltsStatus =
        docs.ielts.status === "APPROVED"
          ? "COMPLETED"
          : docs.ielts.status === "REQUESTED"
            ? "REQUESTED"
            : "MISSING";

      await prisma.requirement.createMany({
        data: [
          {
            applicationId: app.id,
            name: "Passport",
            type: "DOCUMENT",
            status: docs.passport.status === "APPROVED" ? "COMPLETED" : docs.passport.status === "REQUESTED" ? "REQUESTED" : "MISSING",
            isCritical: true,
            relatedDocumentId: docs.passport.id,
          },
          {
            applicationId: app.id,
            name: "Transcript",
            type: "DOCUMENT",
            status: docs.transcript.status === "APPROVED" ? "COMPLETED" : docs.transcript.status === "REQUESTED" ? "REQUESTED" : "MISSING",
            isCritical: true,
            relatedDocumentId: docs.transcript.id,
          },
          {
            applicationId: app.id,
            name: "IELTS",
            type: "LANGUAGE",
            status: ieltsStatus,
            isCritical: true,
            relatedDocumentId: docs.ielts.id,
          },
          {
            applicationId: app.id,
            name: "Application Fee",
            type: "PAYMENT",
            status: app.applicationFeePaid ? "COMPLETED" : "MISSING",
            isCritical: true,
          },
        ],
      });

      await prisma.deadline.create({
        data: {
          title: `Hard deadline — ${prog.name}`,
          date: hardDeadline,
          type: "HARD",
          studentId: student.id,
          applicationId: app.id,
          isHardDeadline: true,
          isInternal: false,
          riskWeight: 3,
        },
      });

      if (idx === 0) {
        await prisma.task.create({
          data: {
            title:
              student.caseType === "waiting"
                ? `Follow up on ${docs.ielts.status === "REQUESTED" ? "IELTS" : "documents"}`
                : `Prepare ${prog.name} application`,
            studentId: student.id,
            applicationId: app.id,
            assigneeId: student.curator.id,
            status: student.caseType === "admitted" ? "DONE" : "TODO",
            priority: student.caseType === "deadline" ? "URGENT" : "MEDIUM",
            dueDate: student.caseType === "deadline" ? daysAgo(1) : daysFromNow(5),
            isStudentFacing: student.caseType === "waiting",
            completedAt: student.caseType === "admitted" ? daysAgo(3) : null,
          },
        });
      }
    }
  }

  // Extra documents/tasks to hit volume targets
  for (const student of students.slice(0, 8)) {
    await ensureDoc(student.id, "Diploma", "EDUCATION", "APPROVED", {
      uploadedAt: daysAgo(30),
      reviewedAt: daysAgo(28),
      reviewedById: student.curator.id,
    });
    await ensureDoc(student.id, "CV", "OTHER", Math.random() > 0.5 ? "APPROVED" : "UPLOADED", {
      uploadedAt: daysAgo(5),
    });
  }

  let taskExtra = 0;
  for (const student of students) {
    for (const title of [
      "Confirm intake preference",
      "Send weekly check-in",
      "Verify document translations",
    ]) {
      await prisma.task.create({
        data: {
          title: `${title} — ${student.firstName}`,
          studentId: student.id,
          assigneeId: student.curator.id,
          status: taskExtra % 5 === 0 ? "DONE" : "TODO",
          priority: taskExtra % 4 === 0 ? "HIGH" : "MEDIUM",
          dueDate: daysFromNow(taskExtra % 10),
          isStudentFacing: taskExtra % 3 === 0,
          completedAt: taskExtra % 5 === 0 ? daysAgo(1) : null,
        },
      });
      taskExtra += 1;
    }
  }

  await prisma.intakeCohort.create({
    data: {
      intake: "2027/28",
      seatLimit: null,
      isActive: true,
    },
  });

  const acceptedStudentIds = [
    ...new Set(
      (
        await prisma.application.findMany({
          select: { studentId: true },
          distinct: ["studentId"],
        })
      ).map((row) => row.studentId)
    ),
  ];
  if (acceptedStudentIds.length > 0) {
    await prisma.student.updateMany({
      where: { id: { in: acceptedStudentIds } },
      data: {
        accompanimentStatus: "ACCEPTED",
        acceptedAt: new Date(),
        acceptedById: admin.id,
      },
    });
  }

  const pendingAnketas = [
    {
      first: "Kira",
      last: "Novikova",
      country: "Russia",
      curatorId: null as string | null,
      directions: ["Дизайн", "Архитектура"],
    },
    {
      first: "Boris",
      last: "Levin",
      country: "Kazakhstan",
      curatorId: anna.id,
      directions: ["Экономические науки", "Финансы"],
    },
  ];
  for (const pending of pendingAnketas) {
    const user = await prisma.user.create({
      data: {
        email: `${pending.first.toLowerCase()}.${pending.last.toLowerCase()}@student.local`,
        name: `${pending.first} ${pending.last}`,
        role: "STUDENT",
        passwordHash,
      },
    });
    const student = await prisma.student.create({
      data: {
        userId: user.id,
        firstName: pending.first,
        lastName: pending.last,
        email: user.email,
        country: pending.country,
        nationality: pending.country,
        studyLevel: "BACHELOR",
        intake: "2027/28",
        targetField: pending.directions[0],
        preferredLanguage: "Итальянский",
        preferredCities: JSON.stringify(["Milano", "Roma"]),
        status: "ACTIVE",
        journeyStage: "STRATEGY",
        curatorId: pending.curatorId,
        accompanimentStatus: "PENDING",
        questionnaireAt: daysAgo(3),
        questionnaireProgramsAt: daysAgo(2),
        questionnairePersonalJson: JSON.stringify({
          firstNameLatin: pending.first,
          lastNameLatin: pending.last,
          citizenship: pending.country,
          comment: "Готова начать сопровождение",
        }),
        questionnaireProgramsJson: JSON.stringify({
          fullName: `${pending.first} ${pending.last}`,
          studyLevelPlan: "Бакалавриат",
          studyLanguage: "Итальянский",
          preferredDirections: pending.directions,
          preferredCities: ["Milano", "Roma"],
          dsuScholarship: "Да",
        }),
      },
    });
    students.push({ ...student, caseType: "healthy", curator: pending.curatorId ? anna : admin });
  }

  for (const student of students) {
    await recalculateStudent(student.id);
  }

  console.log("Seed complete");
  console.log("Login accounts (password: password123):");
  console.log("  admin@immigrome.local (ADMIN)");
  console.log("  anna@immigrome.local (CURATOR)");
  console.log("  marco@immigrome.local (CURATOR)");
  console.log("  elena@immigrome.local (CURATOR)");
  console.log("  alina.sokolova@student.local (STUDENT)");
  console.log("Template:", template.name);
  console.log("Admin id:", admin.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
