export default function AdminLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <p className="sr-only">Загрузка</p>
      <div className="space-y-2">
        <div className="h-7 w-48 animate-pulse rounded-lg bg-muted" />
        <div className="h-4 w-72 max-w-full animate-pulse rounded-lg bg-muted" />
      </div>
      <div className="surface-card h-24 animate-pulse" />
      <div className="surface-card h-64 animate-pulse" />
    </div>
  );
}
