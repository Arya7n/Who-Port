export function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Loading ports" className="space-y-2 p-4">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="h-8 animate-pulse rounded bg-[var(--line)]" />
      ))}
    </div>
  );
}
