export default function BlogListSkeleton() {
  return (
    <div className="max-w-4xl mx-auto animate-pulse">
      <div className="mb-8">
        <div className="h-4 w-12 rounded mb-2" style={{ backgroundColor: 'var(--border)' }} />
        <div className="h-8 w-72 rounded mb-3" style={{ backgroundColor: 'var(--border)' }} />
        <div className="h-4 w-96 rounded" style={{ backgroundColor: 'var(--border)' }} />
      </div>
      <div className="flex gap-2 mb-8">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-8 w-20 rounded-full" style={{ backgroundColor: 'var(--border)' }} />
        ))}
      </div>
      <div className="space-y-6">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex rounded-2xl overflow-hidden h-[90px] sm:h-[180px]" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
            <div className="flex-shrink-0 w-[140px] sm:w-[374px]" style={{ backgroundColor: 'var(--border)' }} />
            <div className="p-3 sm:p-5 flex flex-col gap-3 flex-1">
              <div className="h-4 w-20 rounded-full" style={{ backgroundColor: 'var(--border)' }} />
              <div className="h-5 w-full rounded" style={{ backgroundColor: 'var(--border)' }} />
              <div className="h-4 w-3/4 rounded hidden sm:block" style={{ backgroundColor: 'var(--border)' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
