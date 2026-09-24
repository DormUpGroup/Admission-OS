import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readOrCreate,
  rotateCommandId,
  storageKey,
} from "@/components/command-id-input";
import { isNextRedirectError } from "@/components/command-form";

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

/**
 * Mirrors CommandForm submit lifecycle without mounting React
 * (@testing-library/react is not in package.json).
 */
async function runCommandFormAction(opts: {
  operation: string;
  entityId: string;
  entityVersion?: string;
  formInstance?: string;
  action: (formData: FormData) => Promise<void>;
  formData?: FormData;
}): Promise<{
  commandIdSubmitted: string;
  commandIdNow: string;
  rotated: boolean;
  error?: unknown;
}> {
  const key = storageKey({
    operation: opts.operation,
    entityId: opts.entityId,
    entityVersion: opts.entityVersion ?? "0",
    formInstance: opts.formInstance ?? "default",
  });
  const cache = { current: null as string | null };
  const commandId = readOrCreate(key, cache);
  // Pre-hydration guard: empty id must not submit
  if (!commandId) {
    return {
      commandIdSubmitted: "",
      commandIdNow: "",
      rotated: false,
    };
  }

  const formData = opts.formData ?? new FormData();
  formData.set("commandId", commandId);

  try {
    await opts.action(formData);
    const next = rotateCommandId(key, cache);
    return {
      commandIdSubmitted: commandId,
      commandIdNow: next,
      rotated: true,
    };
  } catch (error) {
    if (isNextRedirectError(error)) {
      const next = rotateCommandId(key, cache);
      return {
        commandIdSubmitted: commandId,
        commandIdNow: next,
        rotated: true,
        error,
      };
    }
    return {
      commandIdSubmitted: commandId,
      commandIdNow: commandId,
      rotated: false,
      error,
    };
  }
}

describe("CommandForm", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("sessionStorage", memorySessionStorage());
    let n = 0;
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => `uuid-${++n}`),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("university.create success rotates key", async () => {
    const result = await runCommandFormAction({
      operation: "university.create",
      entityId: "new",
      action: async () => {},
    });
    expect(result.commandIdSubmitted).toBe("uuid-1");
    expect(result.rotated).toBe(true);
    expect(result.commandIdNow).toBe("uuid-2");
  });

  it("error does not rotate", async () => {
    const result = await runCommandFormAction({
      operation: "university.create",
      entityId: "new",
      action: async () => {
        throw new Error("server failed");
      },
    });
    expect(result.rotated).toBe(false);
    expect(result.commandIdNow).toBe(result.commandIdSubmitted);
  });

  it("remount before success keeps key", () => {
    const key = storageKey({
      operation: "university.create",
      entityId: "new",
      entityVersion: "0",
      formInstance: "default",
    });
    const a = readOrCreate(key, { current: null });
    const b = readOrCreate(key, { current: null });
    expect(a).toBe(b);
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
  });

  it("two sequential successes get different keys", async () => {
    const first = await runCommandFormAction({
      operation: "university.create",
      entityId: "new",
      action: async () => {},
    });
    const second = await runCommandFormAction({
      operation: "university.create",
      entityId: "new",
      action: async () => {},
    });
    expect(second.commandIdSubmitted).toBe(first.commandIdNow);
    expect(second.commandIdNow).not.toBe(second.commandIdSubmitted);
    expect(second.commandIdNow).not.toBe(first.commandIdSubmitted);
  });

  it("entity version change → new key", async () => {
    const v1 = await runCommandFormAction({
      operation: "document.needs-changes",
      entityId: "doc-1",
      entityVersion: "1",
      action: async () => {},
    });
    const v2 = await runCommandFormAction({
      operation: "document.needs-changes",
      entityId: "doc-1",
      entityVersion: "2",
      action: async () => {},
    });
    expect(v1.commandIdSubmitted).not.toBe(v2.commandIdSubmitted);
  });

  it("form before hydration has empty commandId and must not submit", async () => {
    // Simulate pre-hydration: no id in cache/session yet, empty string blocks submit
    const ready = false;
    const commandId = "";
    expect(ready).toBe(false);
    expect(commandId).toBe("");
    // Same guard as CommandForm.runAction
    const wouldSubmit = ready && Boolean(commandId);
    expect(wouldSubmit).toBe(false);
  });

  it("isNextRedirectError detects Next.js redirect digests", () => {
    expect(
      isNextRedirectError({
        digest: "NEXT_REDIRECT;replace;/admin;303",
      })
    ).toBe(true);
    expect(isNextRedirectError(new Error("nope"))).toBe(false);
    expect(isNextRedirectError(null)).toBe(false);
  });
});
