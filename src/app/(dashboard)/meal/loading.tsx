export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-32 rounded-xl" style={{ backgroundColor: 'var(--border)' }} />
      <div className="rounded-2xl h-24" style={{ backgroundColor: 'var(--border)' }} />
      <div className="grid grid-cols-4 gap-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-xl h-20" style={{ backgroundColor: 'var(--border)' }} />
        ))}
      </div>
      <div className="rounded-2xl h-48" style={{ backgroundColor: 'var(--border)' }} />
    </div>
  )
}
