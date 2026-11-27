'use client'

import { useState } from 'react'

type Props = {
  selectedDate: Date
  onDateSelect: (date: Date) => void
  trainedDates: Set<string>
  mealDates: Set<string>
  // "今日"をハイライトするための基準日(YYYYMMDD)。呼び出し側から渡してもらい、
  // ここでnew Date()を呼ばない。SSRとclient初回renderは実行される瞬間が異なる
  // ため、render中に独自にnew Date()すると日付が食い違いhydration mismatchの
  // 原因になる。
  todayDateId: string
}

function makeDateId(year: number, month: number, day: number) {
  return `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function Calendar({ selectedDate, onDateSelect, trainedDates, mealDates, todayDateId }: Props) {
  const [viewDate, setViewDate] = useState(new Date(selectedDate))

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth() + 1
  const firstDay = new Date(year, month - 1, 1)
  const daysInMonth = new Date(year, month, 0).getDate()
  const startOffset = (firstDay.getDay() + 6) % 7

  const cells: (number | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  const isToday = (day: number) => makeDateId(year, month, day) === todayDateId
  const isSelected = (day: number) =>
    selectedDate.getFullYear() === year &&
    selectedDate.getMonth() + 1 === month &&
    selectedDate.getDate() === day

  const monthLabel = viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-black text-lg" style={{ color: 'var(--text)' }}>{monthLabel}</h3>
        <div className="flex gap-2">
          <button
            onClick={() => setViewDate(new Date(year, month - 2, 1))}
            className="w-8 h-8 rounded-lg flex items-center justify-center font-bold transition hover:opacity-70"
            style={{ backgroundColor: 'var(--accent-light)', color: 'var(--accent)' }}
          >
            ‹
          </button>
          <button
            onClick={() => setViewDate(new Date(year, month, 1))}
            className="w-8 h-8 rounded-lg flex items-center justify-center font-bold transition hover:opacity-70"
            style={{ backgroundColor: 'var(--accent-light)', color: 'var(--accent)' }}
          >
            ›
          </button>
        </div>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 mb-2">
        {WEEKDAYS.map((d) => (
          <div key={d} className="text-center text-xs font-bold py-1" style={{ color: 'var(--text-muted)' }}>
            {d}
          </div>
        ))}
      </div>

      {/* Days */}
      <div className="grid grid-cols-7 gap-y-1">
        {cells.map((day, i) => {
          if (!day) return <div key={`e-${i}`} />
          const dateId = makeDateId(year, month, day)
          const trained = trainedDates.has(dateId)
          const hasMeal = mealDates.has(dateId)
          const todayFlag = isToday(day)
          const selectedFlag = isSelected(day)

          const both = trained && hasMeal && !todayFlag

          let circleBg: string
          let textColor: string
          if (todayFlag) {
            circleBg = 'var(--primary)'
            textColor = '#fff'
          } else if (both) {
            circleBg = 'linear-gradient(to right, #dcfce7 50%, var(--accent-light) 50%)'
            textColor = '#166534'
          } else if (trained) {
            circleBg = 'var(--accent-light)'
            textColor = 'var(--accent)'
          } else if (hasMeal) {
            circleBg = '#dcfce7'
            textColor = '#16a34a'
          } else {
            circleBg = 'transparent'
            textColor = 'var(--text)'
          }

          return (
            <button
              key={day}
              onClick={() => onDateSelect(new Date(year, month - 1, day))}
              className="flex items-center justify-center"
            >
              <span
                className="w-8 h-8 flex items-center justify-center rounded-full text-sm font-bold transition"
                style={{
                  background: circleBg,
                  color: textColor,
                  outline: selectedFlag ? '2px solid var(--primary)' : 'none',
                  outlineOffset: '1px',
                }}
              >
                {day}
              </span>
            </button>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex gap-4 mt-4 pt-3 flex-wrap" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: 'var(--primary)' }} />
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Today</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: 'var(--accent-light)', border: '1px solid var(--accent)' }} />
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Trained</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#dcfce7', border: '1px solid #16a34a' }} />
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Meal logged</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full" style={{ background: 'linear-gradient(to right, #dcfce7 50%, var(--accent-light) 50%)' }} />
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Both</span>
        </div>
      </div>
    </div>
  )
}
