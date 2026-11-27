export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-32 rounded-xl" style={{ backgroundColor: 'var(--border)' }} />
      <div className="grid grid-cols-3 gap-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="rounded-2xl h-20" style={{ backgroundColor: 'var(--border)' }} />
        ))}
      </div>
      <div className="rounded-2xl h-36" style={{ backgroundColor: 'var(--border)' }} />
      <div className="rounded-2xl h-56" style={{ backgroundColor: 'var(--border)' }} />
    </div>
  )
}
