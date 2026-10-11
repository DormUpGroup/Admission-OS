"use client";

import { useEffect } from "react";

export function ScrollToActivity({ id }: { id?: string }) {
  useEffect(() => {
    if (!id) return;
    document.getElementById(`activity-${id}`)?.scrollIntoView({
      block: "center",
    });
  }, [id]);

  return null;
}
