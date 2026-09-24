"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import {
  readOrCreate,
  rotateCommandId,
  storageKey,
} from "@/components/command-id-input";

export type CommandFormProps = {
  action: (formData: FormData) => Promise<void> | void;
  operation: string;
  entityId: string;
  entityVersion?: string | number;
  formInstance?: string;
  className?: string;
  encType?: string;
  children: ReactNode;
  /** Optional name for the hidden command id field (default commandId). */
  commandIdName?: string;
};

/** True when a server action threw Next.js redirect (counts as success). */
export function isNextRedirectError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest: unknown }).digest === "string" &&
    String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT")
  );
}

/**
 * Stable-command HTML form wrapper.
 *
 * - Same key for retry/reload until success
 * - Rotates only after resolved success (including NEXT_REDIRECT)
 * - Blocks submit until client-side command id is ready (no empty key)
 * - Errors / 409 / network failures keep the same key
 */
export function CommandForm({
  action,
  operation,
  entityId,
  entityVersion = "0",
  formInstance = "default",
  className,
  encType,
  children,
  commandIdName = "commandId",
}: CommandFormProps) {
  const cache = useRef<string | null>(null);
  const key = storageKey({
    operation,
    entityId,
    entityVersion: String(entityVersion),
    formInstance,
  });
  const [commandId, setCommandId] = useState("");
  const [ready, setReady] = useState(false);
  const [pending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    cache.current = null;
    const id = readOrCreate(key, cache);
    setCommandId(id);
    setReady(true);
  }, [key]);

  function runAction(formData: FormData) {
    if (!ready || !commandId) {
      return;
    }
    formData.set(commandIdName, commandId);
    setErrorMessage(null);
    startTransition(async () => {
      try {
        await action(formData);
        // Success without redirect — rotate so the next independent submit is new.
        setCommandId(rotateCommandId(key, cache));
      } catch (error) {
        if (isNextRedirectError(error)) {
          // Successful navigation — rotate before rethrow so returning to this
          // form (same operation/entity) cannot reuse the consumed key.
          setCommandId(rotateCommandId(key, cache));
          throw error;
        }
        // Failure: keep the same key for retry.
        setErrorMessage(
          error instanceof Error ? error.message : "Не удалось выполнить действие"
        );
      }
    });
  }

  return (
    <form
      action={runAction}
      className={className}
      encType={encType}
      aria-busy={pending || !ready}
    >
      <input type="hidden" name={commandIdName} value={commandId} readOnly />
      <fieldset
        disabled={!ready || pending}
        className="min-w-0 border-0 p-0 m-0 contents"
      >
        {children}
      </fieldset>
      {!ready ? (
        <p className="sr-only" aria-live="polite">
          Preparing form…
        </p>
      ) : null}
      {errorMessage ? (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </form>
  );
}
