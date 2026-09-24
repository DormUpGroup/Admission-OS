import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readOrCreate,
  rotateCommandId,
  storageKey,
  getStableCommandId,
  clearStableCommandId,
} from "@/components/command-id-input";

function memorySessionStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
  };
}

describe("command-id helpers", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("sessionStorage", memorySessionStorage());
    vi.stubGlobal("crypto", {
      randomUUID: vi
        .fn()
        .mockReturnValueOnce("id-1")
        .mockReturnValueOnce("id-2")
        .mockReturnValueOnce("id-3")
        .mockReturnValue("id-fallback"),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds a stable storage key from operation+entity+version+instance", () => {
    expect(
      storageKey({
        operation: "university.create",
        entityId: "new",
        entityVersion: "0",
        formInstance: "default",
      })
    ).toBe("command-id:university.create:new:0:default");
  });

  it("reuses the same id on re-read with the same in-memory cache", () => {
    const key = storageKey({
      operation: "task.create",
      entityId: "stu-1",
      entityVersion: "1",
      formInstance: "default",
    });
    const cache = { current: null as string | null };
    const first = readOrCreate(key, cache);
    const second = readOrCreate(key, cache);
    expect(first).toBe("id-1");
    expect(second).toBe(first);
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
  });

  it("remount before success keeps the same key from sessionStorage", () => {
    const key = storageKey({
      operation: "university.create",
      entityId: "new",
      entityVersion: "0",
      formInstance: "default",
    });
    const first = readOrCreate(key, { current: null });
    const remounted = readOrCreate(key, { current: null });
    expect(remounted).toBe(first);
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
  });

  it("rotates to a new id after success", () => {
    const key = storageKey({
      operation: "task.create",
      entityId: "stu-1",
      entityVersion: "1",
      formInstance: "default",
    });
    const cache = { current: null as string | null };
    const before = readOrCreate(key, cache);
    const after = rotateCommandId(key, cache);
    expect(before).toBe("id-1");
    expect(after).toBe("id-2");
    expect(after).not.toBe(before);
  });

  it("entity version change yields a new key and id", () => {
    const v1 = storageKey({
      operation: "task.create",
      entityId: "stu-1",
      entityVersion: "1",
      formInstance: "default",
    });
    const v2 = storageKey({
      operation: "task.create",
      entityId: "stu-1",
      entityVersion: "2",
      formInstance: "default",
    });
    expect(v1).not.toBe(v2);
    const first = readOrCreate(v1, { current: null });
    const second = readOrCreate(v2, { current: null });
    expect(first).toBe("id-1");
    expect(second).toBe("id-2");
  });

  it("getStableCommandId / clearStableCommandId rotate after success", () => {
    const parts = {
      operation: "program-match.reset",
      entityId: "stu-1",
      entityVersion: 1,
    };
    const before = getStableCommandId(parts);
    clearStableCommandId(parts);
    const after = getStableCommandId(parts);
    expect(before).toBe("id-1");
    expect(after).toBe("id-2");
    expect(after).not.toBe(before);
  });
});

function walkTsx(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkTsx(full, out);
    else if (name.endsWith(".tsx") || name.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("mutation forms use CommandForm or getStableCommandId", () => {
  it("discovers action= forms that own commandId and requires CommandForm / stable helpers", () => {
    const srcRoot = path.resolve(__dirname, "../..");
    const files = walkTsx(srcRoot);
    const offenders: string[] = [];
    const discovered: string[] = [];

    for (const file of files) {
      const rel = path.relative(srcRoot, file).replace(/\\/g, "/");
      if (
        rel.includes("__tests__") ||
        rel.endsWith("command-form.tsx") ||
        rel.endsWith("command-id-input.tsx")
      ) {
        continue;
      }

      const content = readFileSync(file, "utf8");
      const hasActionForm =
        /<form\b[^>]*\baction=/.test(content) || /<CommandForm\b/.test(content);
      const mentionsCommandId =
        /\bcommandId\b/.test(content) ||
        /CommandForm/.test(content) ||
        /getStableCommandId/.test(content) ||
        /clearStableCommandId/.test(content);

      if (!hasActionForm || !mentionsCommandId) continue;

      const ownsCommandId =
        /CommandForm/.test(content) ||
        /getStableCommandId/.test(content) ||
        /clearStableCommandId/.test(content) ||
        /name=["']commandId["']/.test(content) ||
        /formData\.set\(\s*["']commandId["']/.test(content);

      if (!ownsCommandId) continue;

      discovered.push(rel);

      expect(content, rel).not.toMatch(/crypto\.randomUUID\s*\(/);
      expect(content, rel).not.toMatch(/<CommandIdInput\b/);

      const ok =
        /<CommandForm\b/.test(content) ||
        /getStableCommandId/.test(content) ||
        /clearStableCommandId/.test(content);

      if (!ok) offenders.push(rel);
    }

    expect(discovered.length).toBeGreaterThan(10);
    expect(
      offenders,
      `missing CommandForm/helpers:\n${offenders.join("\n")}`
    ).toEqual([]);
  });
});
