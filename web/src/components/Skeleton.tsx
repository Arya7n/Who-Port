const WIDTHS = ["w-40", "w-56", "w-32", "w-48", "w-36", "w-52"];

export function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Loading ports">
      {WIDTHS.map((width, index) => (
        <div key={index} className="flex items-center gap-6 border-b border-line px-5 py-4 last:border-b-0">
          <div className="shimmer h-4 w-14 rounded" />
          <div className={`shimmer h-4 ${width} rounded`} />
          <div className="shimmer h-4 w-24 rounded" />
          <div className="shimmer ml-auto h-8 w-20 rounded-lg" />
        </div>
      ))}
    </div>
  );
}
