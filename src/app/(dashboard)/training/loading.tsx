export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-48 rounded-xl" style={{ backgroundColor: 'var(--border)' }} />
      <div className="grid grid-cols-2 gap-3">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="rounded-2xl h-32" style={{ backgroundColor: 'var(--border)' }} />
        ))}
      </div>
    </div>
  )
}
