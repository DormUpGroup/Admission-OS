import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyDocs = vi.fn();
const findUniqueStudent = vi.fn();
const createDoc = vi.fn();
const createTask = vi.fn();
const transaction = vi.fn();
const logActivity = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    document: {
      findMany: (...args: unknown[]) => findManyDocs(...args),
      create: (...args: unknown[]) => createDoc(...args),
    },
    student: {
      findUnique: (...args: unknown[]) => findUniqueStudent(...args),
    },
    task: {
      create: (...args: unknown[]) => createTask(...args),
    },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => transaction(fn),
  },
}));

vi.mock("@/server/services/activity", () => ({
  logActivity: (...args: unknown[]) => logActivity(...args),
}));

import {
  PERSONAL_DOSSIER_DOCUMENTS,
  ensurePersonalDossierDocuments,
} from "@/server/services/personal-dossier";

describe("ensurePersonalDossierDocuments", () => {
  beforeEach(() => {
    findManyDocs.mockReset();
    findUniqueStudent.mockReset();
    createDoc.mockReset();
    createTask.mockReset();
    transaction.mockReset();
    logActivity.mockReset();
  });

  it("creates the full personal-file checklist when empty", async () => {
    findManyDocs.mockResolvedValue([]);
    findUniqueStudent.mockResolvedValue({ curatorId: "cur-1" });
    transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        document: {
          create: async (args: { data: { name: string } }) => {
            createDoc(args);
            return { id: `doc-${args.data.name}`, name: args.data.name };
          },
        },
        task: {
          create: async (args: unknown) => {
            createTask(args);
            return args;
          },
        },
      };
      return fn(tx);
    });
    logActivity.mockResolvedValue(undefined);

    const result = await ensurePersonalDossierDocuments("stu-1", "staff-1");

    expect(result.created).toBe(PERSONAL_DOSSIER_DOCUMENTS.length);
    expect(createDoc).toHaveBeenCalledTimes(PERSONAL_DOSSIER_DOCUMENTS.length);
    expect(createTask).toHaveBeenCalledTimes(PERSONAL_DOSSIER_DOCUMENTS.length);
    expect(createDoc.mock.calls[0]?.[0]?.data).toMatchObject({
      studentId: "stu-1",
      name: "Загранпаспорт",
      status: "REQUESTED",
    });
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "DOCUMENT_REQUESTED",
        studentId: "stu-1",
      }),
    );
  });

  it("skips names that already exist", async () => {
    findManyDocs.mockResolvedValue(
      PERSONAL_DOSSIER_DOCUMENTS.map((item) => ({ name: item.name })),
    );

    const result = await ensurePersonalDossierDocuments("stu-1");

    expect(result.created).toBe(0);
    expect(transaction).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });
});
