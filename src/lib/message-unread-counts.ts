export type MessageUnreadCounts = {
  total: number;
  site: number;
  telegram: number;
  email: number;
  instagram: number;
};

/** Same rule as the sidebar badge: inbound arrived after the curator last opened the thread. */
export function isUnreadInbound(input: {
  lastInboundAt: Date | null;
  staffLastReadAt: Date | null;
}): boolean {
  if (!input.lastInboundAt) return false;
  if (
    input.staffLastReadAt &&
    input.lastInboundAt <= input.staffLastReadAt
  ) {
    return false;
  }
  return true;
}
