"use client";

import { useEffect, useRef, useState } from "react";

type CommandIdParts = {
  operation: string;
  entityId: string;
  entityVersion: string;
  formInstance: string;
};

export function storageKey(parts: CommandIdParts) {
  return [
    "command-id",
    parts.operation,
    parts.entityId,
    parts.entityVersion,
    parts.formInstance,
  ].join(":");
}

export function readOrCreate(
  key: string,
  cache: { current: string | null }
): string {
  if (cache.current) return cache.current;
  if (typeof window !== "undefined") {
    const existing = sessionStorage.getItem(key);
    if (existing) {
      cache.current = existing;
      return existing;
    }
  }
  const created = crypto.randomUUID();
  cache.current = created;
  if (typeof window !== "undefined") {
    sessionStorage.setItem(key, created);
  }
  return created;
}

/** Rotate the stored command id after a confirmed successful submit. */
export function rotateCommandId(
  key: string,
  cache: { current: string | null }
): string {
  cache.current = null;
  if (typeof window !== "undefined") {
    sessionStorage.removeItem(key);
  }
  return readOrCreate(key, cache);
}

/** Imperative stable command id for buttons / fetch (not HTML forms). */
export function getStableCommandId(parts: {
  operation: string;
  entityId: string;
  entityVersion?: string | number;
  formInstance?: string;
}): string {
  const key = storageKey({
    operation: parts.operation,
    entityId: parts.entityId,
    entityVersion: String(parts.entityVersion ?? "0"),
    formInstance: parts.formInstance ?? "default",
  });
  return readOrCreate(key, { current: null });
}

/** Clear/rotate after confirmed success of an imperative action. */
export function clearStableCommandId(parts: {
  operation: string;
  entityId: string;
  entityVersion?: string | number;
  formInstance?: string;
}): void {
  const key = storageKey({
    operation: parts.operation,
    entityId: parts.entityId,
    entityVersion: String(parts.entityVersion ?? "0"),
    formInstance: parts.formInstance ?? "default",
  });
  rotateCommandId(key, { current: null });
}

type CommandIdInputProps = {
  operation: string;
  entityId: string;
  entityVersion?: string | number;
  formInstance?: string;
  name?: string;
};

/**
 * Hidden stable command id for use inside {@link CommandForm} or rare cases
 * where the parent already owns submit lifecycle. Prefer {@link CommandForm}
 * for mutation HTML forms — it rotates only after confirmed success.
 *
 * Does not submit an empty value: fields stay disabled via CommandForm until ready.
 * Standalone usage waits until hydration before populating the value.
 */
export function CommandIdInput({
  operation,
  entityId,
  entityVersion = "0",
  formInstance = "default",
  name = "commandId",
}: CommandIdInputProps) {
  const cache = useRef<string | null>(null);
  const key = storageKey({
    operation,
    entityId,
    entityVersion: String(entityVersion),
    formInstance,
  });
  const [value, setValue] = useState("");

  useEffect(() => {
    cache.current = null;
    setValue(readOrCreate(key, cache));
  }, [key]);

  // Empty until hydrated — parent CommandForm disables submit until ready.
  return <input type="hidden" name={name} value={value} readOnly />;
}
