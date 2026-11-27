export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-24 rounded-xl" style={{ backgroundColor: 'var(--border)' }} />
      {[...Array(5)].map((_, i) => (
        <div key={i} className="rounded-2xl h-20" style={{ backgroundColor: 'var(--border)' }} />
      ))}
    </div>
  )
}
