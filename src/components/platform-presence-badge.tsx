import { Badge } from "@/components/ui/badge";
import { platformPresenceLabel } from "@/lib/platform-presence";

export function PlatformPresenceBadge({ hasAccount }: { hasAccount: boolean }) {
  return (
    <Badge variant={hasAccount ? "success" : "muted"}>
      {platformPresenceLabel(hasAccount)}
    </Badge>
  );
}
