'use client'

import Link from 'next/link'
import { useT } from '@/lib/i18n'

type TrainingRow = {
  id: string
  date_id: string
  exercise: string
  category: string
  sets: { weight: string; reps: string }[]
}

type Props = {
  trainings: TrainingRow[]
  isGuest?: boolean
}

export default function HistoryClient({ trainings, isGuest }: Props) {
  const t = useT()

  if (isGuest) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-black" style={{ color: 'var(--text)' }}>History 📋</h1>
        <div className="rounded-2xl p-12 text-center shadow-sm" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
          <p className="text-5xl mb-3">📋</p>
          <p className="font-bold" style={{ color: 'var(--text-muted)' }}>{t('loginToView')}</p>
        </div>
      </div>
    )
  }

  const grouped: Record<string, TrainingRow[]> = {}
  for (const tr of trainings) {
    if (!grouped[tr.date_id]) grouped[tr.date_id] = []
    grouped[tr.date_id]!.push(tr)
  }
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a))

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-black" style={{ color: 'var(--text)' }}>History 📋</h1>

      {sortedDates.length === 0 ? (
        <div className="rounded-2xl p-12 text-center shadow-sm" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
          <p className="text-5xl mb-3">📋</p>
          <p className="font-bold" style={{ color: 'var(--text-muted)' }}>{t('noHistory')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {sortedDates.map((dateId) => {
            const label = `${dateId.slice(0, 4)}/${dateId.slice(4, 6)}/${dateId.slice(6, 8)}`
            const dayTrainings = grouped[dateId] ?? []
            return (
              <div key={dateId} className="rounded-2xl p-5 shadow-sm" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-black" style={{ color: 'var(--text)' }}>{label}</h3>
                  <Link
                    href={`/training?date=${dateId}`}
                    className="text-xs font-bold hover:underline"
                    style={{ color: 'var(--primary)' }}
                  >
                    {t('details')}
                  </Link>
                </div>
                <div className="space-y-2">
                  {dayTrainings.map((tr) => (
                    <div key={tr.id} className="flex items-start gap-3 rounded-xl px-3 py-2" style={{ backgroundColor: 'var(--accent-light)' }}>
                      <div className="flex-1">
                        <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>
                          {tr.exercise}{' '}
                          <span className="font-normal text-xs" style={{ color: 'var(--text-muted)' }}>({tr.category})</span>
                        </p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          {tr.sets.length} sets
                          {tr.sets.length > 0 && ` • ${tr.sets[0].weight}kg × ${tr.sets[0].reps}reps`}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
