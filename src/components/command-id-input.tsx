"use client";

import { useEffect, useRef, useState } from "react";

type CommandIdInputProps = {
  operation: string;
  entityId: string;
  entityVersion?: string | number;
  formInstance?: string;
  name?: string;
  /** When true, clears the stored key so the next submit gets a fresh UUID. */
  succeeded?: boolean;
};

function storageKey(parts: {
  operation: string;
  entityId: string;
  entityVersion: string;
  formInstance: string;
}) {
  return [
    "command-id",
    parts.operation,
    parts.entityId,
    parts.entityVersion,
    parts.formInstance,
  ].join(":");
}

function readOrCreate(
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

export function CommandIdInput({
  operation,
  entityId,
  entityVersion = "0",
  formInstance = "default",
  name = "commandId",
  succeeded = false,
}: CommandIdInputProps) {
  const cache = useRef<string | null>(null);
  const key = storageKey({
    operation,
    entityId,
    entityVersion: String(entityVersion),
    formInstance,
  });
  const [value, setValue] = useState(() =>
    typeof window === "undefined" ? "" : readOrCreate(key, cache)
  );

  useEffect(() => {
    if (succeeded) {
      cache.current = null;
      sessionStorage.removeItem(key);
      const next = crypto.randomUUID();
      cache.current = next;
      sessionStorage.setItem(key, next);
      setValue(next);
      return;
    }
    setValue(readOrCreate(key, cache));
  }, [key, succeeded]);

  return <input type="hidden" name={name} value={value} readOnly />;
}
