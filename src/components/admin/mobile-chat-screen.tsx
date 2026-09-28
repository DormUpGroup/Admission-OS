"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";

const MobileChatScreenContext = createContext<(open: boolean) => void>(() => {});

export function MobileChatScreenProvider({
  children,
  onOpenChange,
}: {
  children: ReactNode;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <MobileChatScreenContext.Provider value={onOpenChange}>
      {children}
    </MobileChatScreenContext.Provider>
  );
}

/** Phone: an open thread hides the admin bar so the chat fills the screen. */
export function useReportMobileChat(open: boolean) {
  const onOpenChange = useContext(MobileChatScreenContext);
  useEffect(() => {
    onOpenChange(open);
    return () => onOpenChange(false);
  }, [open, onOpenChange]);
}
