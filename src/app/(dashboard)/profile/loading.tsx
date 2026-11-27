export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-32 rounded-xl" style={{ backgroundColor: 'var(--border)' }} />
      <div className="rounded-2xl h-64" style={{ backgroundColor: 'var(--border)' }} />
      <div className="rounded-2xl h-12" style={{ backgroundColor: 'var(--border)' }} />
    </div>
  )
}
