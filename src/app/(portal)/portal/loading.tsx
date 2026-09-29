export default function PortalLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <p className="sr-only">Загрузка</p>
      <div className="space-y-2">
        <div className="h-8 w-40 animate-pulse rounded-lg bg-muted" />
        <div className="h-4 w-64 max-w-full animate-pulse rounded-lg bg-muted" />
      </div>
      <div className="surface-card h-28 animate-pulse" />
      <div className="surface-card h-40 animate-pulse" />
    </div>
  );
}
