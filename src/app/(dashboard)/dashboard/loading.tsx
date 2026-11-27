export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-40 rounded-xl" style={{ backgroundColor: 'var(--border)' }} />
      <div className="rounded-2xl p-5 h-28" style={{ backgroundColor: 'var(--border)' }} />
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl h-24" style={{ backgroundColor: 'var(--border)' }} />
        <div className="rounded-2xl h-24" style={{ backgroundColor: 'var(--border)' }} />
      </div>
      <div className="rounded-2xl h-40" style={{ backgroundColor: 'var(--border)' }} />
      <div className="rounded-2xl h-32" style={{ backgroundColor: 'var(--border)' }} />
    </div>
  )
}
