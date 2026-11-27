'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { WeightRecord } from '@/types'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import SignupPromptModal from '@/components/ui/SignupPromptModal'
import { useT, getLocale } from '@/lib/i18n'

type Props = {
  initialRecords: WeightRecord[]
  height: string
  goalWeight: string
  isGuest: boolean
  targetDateId?: string
}

function makeDateId(date: Date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
}

function calcBMI(weight: string, height: string) {
  const w = parseFloat(weight)
  const h = parseFloat(height) / 100
  if (!w || !h) return null
  return (w / (h * h)).toFixed(1)
}

function getBMIStatus(bmi: string | null, locale: string): { label: string; color: string } | null {
  if (!bmi) return null
  const v = parseFloat(bmi)
  const isJa = locale === 'ja'
  if (v < 18.5) return { label: isJa ? '低体重' : 'Underweight', color: '#3B82F6' }
  if (v < 25)   return { label: isJa ? '普通体重' : 'Normal',      color: '#22C55E' }
  if (v < 30)   return { label: isJa ? '過体重' : 'Overweight',   color: '#F59E0B' }
  return           { label: isJa ? '肥満' : 'Obese',         color: '#EF4444' }
}

export default function WeightClient({ initialRecords, height, goalWeight, isGuest, targetDateId }: Props) {
  const t = useT()
  const router = useRouter()
  const [records, setRecords] = useState<WeightRecord[]>(initialRecords)

  const today = new Date()
  const dateId = targetDateId ?? makeDateId(today)
  const initialTodayRecord = initialRecords.find((r) => r.date_id === dateId)

  const [weight, setWeight] = useState(initialTodayRecord?.weight ?? '')
  const [bodyFat, setBodyFat] = useState(initialTodayRecord?.body_fat ?? '')
  const [saving, setSaving] = useState(false)
  const [showSignupModal, setShowSignupModal] = useState(false)
  const [period, setPeriod] = useState<'1W' | '1M' | '3M' | '6M' | 'ALL'>('1M')

  const todayRecord = records.find((r) => r.date_id === dateId)

  const dateLabel = `${dateId.slice(0, 4)}/${dateId.slice(4, 6)}/${dateId.slice(6, 8)}`
  const dateInputValue = `${dateId.slice(0, 4)}-${dateId.slice(4, 6)}-${dateId.slice(6, 8)}`
  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDateId = e.target.value.replace(/-/g, '')
    if (newDateId.length === 8) router.push(`/weight?date=${newDateId}`)
  }

  const handleSave = async () => {
    if (!weight) return
    if (isGuest) { setShowSignupModal(true); return }
    setSaving(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSaving(false); return }

    const { data } = await supabase
      .from('weight_records')
      .upsert({ user_id: user.id, date_id: dateId, weight, body_fat: bodyFat }, { onConflict: 'user_id,date_id' })
      .select()
      .single()

    if (data) {
      setRecords((prev) => {
        const filtered = prev.filter((r) => r.date_id !== dateId)
        return [...filtered, data].sort((a, b) => a.date_id.localeCompare(b.date_id))
      })
      setWeight(data.weight)
      setBodyFat(data.body_fat ?? '')
    }
    setSaving(false)
  }

  const PERIOD_OPTIONS: { key: typeof period; label: string; days: number | null }[] = [
    { key: '1W', label: '1週間', days: 7 },
    { key: '1M', label: '1ヶ月', days: 30 },
    { key: '3M', label: '3ヶ月', days: 90 },
    { key: '6M', label: '6ヶ月', days: 180 },
    { key: 'ALL', label: '全期間', days: null },
  ]

  const filteredRecords = (() => {
    const opt = PERIOD_OPTIONS.find((o) => o.key === period)
    if (!opt?.days) return records
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - opt.days)
    const cutoffId = makeDateId(cutoff)
    return records.filter((r) => r.date_id >= cutoffId)
  })()

  const chartData = filteredRecords.map((r) => ({
    date: `${r.date_id.slice(4, 6)}/${r.date_id.slice(6, 8)}`,
    weight: parseFloat(r.weight) || undefined,
    bodyFat: r.body_fat ? parseFloat(r.body_fat) || undefined : undefined,
  }))

  // 体重軸：下側に大きく余白を取ることで体重値をグラフ上部に配置
  const weightValues = chartData.map(d => d.weight).filter((v): v is number => v !== undefined)
  const wMin = weightValues.length > 0 ? Math.min(...weightValues) : 40
  const wMax = weightValues.length > 0 ? Math.max(...weightValues) : 100
  const wPad = Math.max((wMax - wMin) * 0.5, 3)
  const weightDomain: [number, number] = [Math.floor(wMin - wPad * 4), Math.ceil(wMax + wPad)]

  // 体脂肪軸：上側に大きく余白を取ることで体脂肪率値をグラフ下部に配置
  const fatValues = chartData.map(d => d.bodyFat).filter((v): v is number => v !== undefined)
  const fMin = fatValues.length > 0 ? Math.min(...fatValues) : 0
  const fMax = fatValues.length > 0 ? Math.max(...fatValues) : 50
  const fPad = Math.max((fMax - fMin) * 0.5, 3)
  const fatDomain: [number, number] = [Math.max(0, Math.floor(fMin - fPad)), Math.ceil(fMax + fPad * 4)]

  const last = chartData.length - 1

  // 体重ドット：最初・最後 or 前点から0.5kg以上変化したところだけ表示
  const weightDot = (props: Record<string, unknown>) => {
    const { cx, cy, index } = props as { cx: number; cy: number; index: number }
    const curr = chartData[index]?.weight
    const prev = index > 0 ? chartData[index - 1]?.weight : undefined
    const show = index === 0 || index === last ||
      (curr !== undefined && prev !== undefined && Math.abs(curr - prev) >= 0.5)
    if (!show) return <g />
    return <circle cx={cx} cy={cy} r={3} fill="var(--primary)" stroke="var(--primary)" />
  }

  // 体脂肪ドット：最初・最後 or 方向転換点（極大・極小）のみ表示
  const fatDot = (props: Record<string, unknown>) => {
    const { cx, cy, index } = props as { cx: number; cy: number; index: number }
    const curr = chartData[index]?.bodyFat
    const prev = index > 0 ? chartData[index - 1]?.bodyFat : undefined
    const next = index < last ? chartData[index + 1]?.bodyFat : undefined
    const isInflection = curr !== undefined && prev !== undefined && next !== undefined &&
      ((curr > prev && curr > next) || (curr < prev && curr < next))
    const show = index === 0 || index === last || isInflection
    if (!show) return <g />
    return <circle cx={cx} cy={cy} r={3} fill="var(--accent)" stroke="var(--accent)" />
  }

  const latestWeight = records[records.length - 1]?.weight ?? ''
  const bmi = calcBMI(latestWeight, height)
  const bmiStatus = getBMIStatus(bmi, getLocale())

  return (
    <div className="space-y-6">
      {showSignupModal && <SignupPromptModal onClose={() => setShowSignupModal(false)} />}

      {/* Page title */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black" style={{ color: 'var(--text)' }}>Weight ⚖️</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{dateLabel}</p>
        </div>
        <input
          type="date"
          value={dateInputValue}
          onChange={handleDateChange}
          className="border rounded-xl px-3 py-1.5 text-sm font-bold focus:outline-none"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)', color: 'var(--text)' }}
        />
      </div>

      {/* Today stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl p-3 text-center shadow-sm" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
          <p className="text-xl font-black" style={{ color: 'var(--primary)' }}>{todayRecord?.weight ? `${todayRecord.weight}kg` : '--'}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{t('todayWeight')}</p>
        </div>
        <div className="rounded-2xl p-3 text-center shadow-sm" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
          <p className="text-xl font-black" style={{ color: 'var(--primary)' }}>{todayRecord?.body_fat ? `${todayRecord.body_fat}%` : '--'}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{t('bodyFat')}</p>
        </div>
        <div className="rounded-2xl p-3 text-center shadow-sm" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
          <p className="text-xl font-black" style={{ color: 'var(--primary)' }}>{bmi ?? '--'}</p>
          {bmiStatus && (
            <p className="text-xs font-bold mt-0.5" style={{ color: bmiStatus.color }}>{bmiStatus.label}</p>
          )}
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{t('bmi')}</p>
        </div>
      </div>

      {/* Input form */}
      <div className="rounded-2xl p-5 shadow-sm" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
        <h3 className="font-black mb-4" style={{ color: 'var(--text)' }}>
          {dateLabel ?? t('todayRecord')}
        </h3>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>{t('todayWeight')}</label>
            <input
              type="text"
              inputMode="decimal"
              placeholder="0.0"
              value={weight}
              onChange={(e) => setWeight(e.target.value.replace(/[^0-9.]/g, '').replace(/^(\d*\.?\d*).*$/, '$1'))}
              className="w-full border rounded-xl px-3 py-2 text-sm mt-1 focus:outline-none"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)', color: 'var(--text)' }}
            />
          </div>
          <div>
            <label className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>{t('bodyFat')} (%)</label>
            <input
              type="text"
              inputMode="decimal"
              placeholder="0.0"
              value={bodyFat}
              onChange={(e) => setBodyFat(e.target.value.replace(/[^0-9.]/g, '').replace(/^(\d*\.?\d*).*$/, '$1'))}
              className="w-full border rounded-xl px-3 py-2 text-sm mt-1 focus:outline-none"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)', color: 'var(--text)' }}
            />
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !weight}
          className="w-full py-3 rounded-xl font-bold text-white transition disabled:opacity-50"
          style={{ backgroundColor: 'var(--primary)' }}
        >
          {saving ? t('saving') : t('recordBtn')}
        </button>
      </div>

      {/* Goal info */}
      {(goalWeight || height) && (
        <div className="rounded-2xl p-4 flex gap-6 shadow-sm" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
          {height && (
            <div>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('height')}</p>
              <p className="font-black" style={{ color: 'var(--text)' }}>{height}cm</p>
            </div>
          )}
          {goalWeight && (
            <div>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('goalWeight')}</p>
              <p className="font-black" style={{ color: 'var(--text)' }}>{goalWeight}kg</p>
            </div>
          )}
        </div>
      )}

      {/* Graph */}
      {records.length > 0 && (
        <div className="rounded-2xl p-5 shadow-sm" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-black" style={{ color: 'var(--text)' }}>{t('weightGraph')}</h3>
            <div className="flex gap-1">
              {PERIOD_OPTIONS.map((o) => (
                <button
                  key={o.key}
                  onClick={() => setPeriod(o.key)}
                  className="px-2.5 py-1 rounded-lg text-xs font-bold transition"
                  style={
                    period === o.key
                      ? { backgroundColor: 'var(--primary)', color: '#fff' }
                      : { backgroundColor: 'var(--bg)', color: 'var(--text-muted)' }
                  }
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          {chartData.length === 0 && (
            <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>この期間の記録がありません</p>
          )}
          {chartData.length > 0 && (
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={chartData} margin={{ left: 0, right: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <YAxis yAxisId="left" width={42} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} unit="kg" domain={weightDomain} />
                <YAxis yAxisId="right" width={42} orientation="right" tick={{ fontSize: 10, fill: 'var(--accent)' }} unit="%" domain={fatDomain} />
                <Tooltip />
                <Legend />
                <Line yAxisId="left" type="monotone" dataKey="weight" stroke="var(--primary)" strokeWidth={2} dot={period === '3M' || period === '6M' || period === 'ALL' ? weightDot : { r: 3 }} activeDot={{ r: 4 }} name={t('weightKg')} connectNulls />
                <Line yAxisId="right" type="monotone" dataKey="bodyFat" stroke="var(--accent)" strokeWidth={2} dot={period === '3M' || period === '6M' || period === 'ALL' ? fatDot : { r: 3 }} activeDot={{ r: 4 }} name={t('bodyFatPct')} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {/* Records list */}
      {records.length > 0 && (
        <div className="rounded-2xl p-5 shadow-sm" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
          <h3 className="font-black mb-3" style={{ color: 'var(--text)' }}>{t('recordList')}</h3>
          <div className="space-y-2">
            {[...records].reverse().slice(0, 10).map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-xl px-4 py-3" style={{ backgroundColor: 'var(--accent-light)' }}>
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  {r.date_id.slice(0, 4)}/{r.date_id.slice(4, 6)}/{r.date_id.slice(6, 8)}
                </span>
                <span className="font-bold" style={{ color: 'var(--text)' }}>{r.weight}kg</span>
                {r.body_fat && <span className="text-sm" style={{ color: 'var(--accent)' }}>{r.body_fat}%</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
