'use client'

import Link from 'next/link'

type WaterTankProps = {
  percentage: number
}

function WaterTank({ percentage }: WaterTankProps) {
  const clamped = Math.min(percentage, 120)
  const fillFraction = clamped / 120

  const fillColor = percentage > 120 ? '#ef4444' : percentage > 100 ? '#f97316' : '#3b82f6'
  const fillColorLight = percentage > 120 ? '#fca5a5' : percentage > 100 ? '#fed7aa' : '#93c5fd'

  const W = 72
  const capH = 12
  const bodyH = 108
  const totalH = capH + bodyH  // 120px (viewBox 座標系)
  const rx = 14
  const fillH = bodyH * fillFraction
  const fillY = capH + bodyH - fillH

  // 炎の最大高さ (164px) に合わせてスケール
  const TARGET_H = 164
  const svgScale = TARGET_H / totalH               // ≈1.367
  const renderedW = Math.round(W * svgScale)        // ≈98px
  const renderedCapH = Math.round(capH * svgScale)  // ≈16px (オーバーレイ用)

  return (
    <div className="relative" style={{ width: renderedW, height: TARGET_H }}>
      <svg width={renderedW} height={TARGET_H} viewBox={`0 0 ${W} ${totalH}`} overflow="visible">
          <defs>
            <clipPath id="tankClip">
              <rect x="4" y={capH} width={W - 8} height={bodyH} rx={rx} />
            </clipPath>
          </defs>

          {/* Cap */}
          <rect x="22" y="1" width={W - 44} height={capH - 1} rx="5" fill="var(--border)" />

          {/* Body background */}
          <rect x="4" y={capH} width={W - 8} height={bodyH} rx={rx}
            fill="var(--bg)" stroke="var(--border)" strokeWidth="2" />

          {/* Water fill */}
          {fillH > 0 && (
            <rect
              x="4" y={fillY} width={W - 8} height={fillH}
              fill={fillColor} opacity="0.75"
              clipPath="url(#tankClip)"
              style={{ transition: 'y 1s ease, height 1s ease' }}
            />
          )}

          {/* Wave surface */}
          {fillH > 4 && (
            <ellipse
              cx={W / 2} cy={fillY}
              rx={(W - 12) / 2} ry={5}
              fill={fillColorLight} opacity="0.6"
              clipPath="url(#tankClip)"
            />
          )}

          {/* Overflow bubbles */}
          {percentage > 120 && (
            <>
              <circle cx={W * 0.28} cy={capH - 5} r="5" fill={fillColor} opacity="0.7" />
              <circle cx={W * 0.55} cy={capH - 10} r="4" fill={fillColor} opacity="0.5" />
              <circle cx={W * 0.76} cy={capH - 4} r="3" fill={fillColor} opacity="0.65" />
            </>
          )}

          {/* Shine */}
          <rect x="12" y={capH + 12} width="5" height={bodyH - 28} rx="3"
            fill="white" opacity="0.18" clipPath="url(#tankClip)" />
        </svg>

        {/* Percentage overlay */}
        <div
          className="absolute flex items-center justify-center font-black text-sm"
          style={{
            top: renderedCapH,
            left: 0,
            right: 0,
            bottom: 0,
            color: fillFraction > 0.5 ? 'white' : 'var(--text)',
          }}
        >
          {Math.round(percentage)}%
        </div>
      </div>
  )
}

type FlameProps = {
  kcal: number
}

function Flame({ kcal }: FlameProps) {
  const scale = Math.min(0.8 + kcal / 550, 1.8)

  return (
    <div style={{ width: 108, height: 164, position: 'relative', overflow: 'visible' }}>
      <svg
        width={60}
        height={91}
        viewBox="0 0 60 91"
        style={{
          position: 'absolute',
          bottom: 0,
          left: '50%',
          transform: `translateX(-50%) scale(${scale})`,
          transformOrigin: 'bottom center',
          transition: 'transform 0.6s ease',
        }}
      >
        {/* Outer flame */}
        <path
          d="M30 89 C9 78 3 61 9 43 C12 33 8 25 13 16 C18 29 21 33 23 30 C25 19 29 6 30 0 C31 6 35 19 37 30 C39 33 42 29 47 16 C52 25 48 33 51 43 C57 61 51 78 30 89Z"
          fill="#ef4444"
        />
        {/* Middle flame */}
        <path
          d="M30 82 C17 71 14 57 18 44 C20 36 23 31 25 28 C27 38 29 40 30 36 C31 29 33 20 35 17 C39 29 39 38 41 44 C45 57 43 71 30 82Z"
          fill="#f97316"
        />
        {/* Inner flame */}
        <path
          d="M30 74 C22 63 21 50 25 42 C27 36 29 33 30 30 C31 33 33 36 35 42 C39 50 38 63 30 74Z"
          fill="#fde68a"
        />
        {/* White hot core */}
        <path
          d="M30 64 C26 55 26 47 28 42 C29 39 30 37 30 36 C30 37 31 39 32 42 C34 47 34 55 30 64Z"
          fill="white"
          opacity="0.8"
        />
      </svg>
    </div>
  )
}

type Props = {
  intakeKcal: number
  targetKcal: number
  burnedKcal: number
  bmr?: number | null
}

export default function CalorieVisual({ intakeKcal, targetKcal, burnedKcal, bmr }: Props) {
  if (targetKcal <= 0) {
    return (
      <div className="rounded-2xl p-5 shadow-sm" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
        <h2 className="font-black mb-2" style={{ color: 'var(--text)' }}>⚡ カロリーバランス</h2>
        <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
          プロフィールで性別・目標達成日数を設定するとカロリーバランスが表示されます
        </p>
        <Link
          href="/profile"
          className="inline-block px-4 py-2 rounded-xl text-sm font-bold text-white"
          style={{ backgroundColor: 'var(--primary)' }}
        >
          プロフィールを設定する →
        </Link>
      </div>
    )
  }

  const percentage = (intakeKcal / targetKcal) * 100
  const overColor = percentage > 120 ? '#ef4444' : '#f97316'

  return (
    <div className="rounded-2xl p-5 shadow-sm" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
      <h2 className="font-black mb-4" style={{ color: 'var(--text)' }}>⚡ カロリーバランス</h2>

      {/* 3行グリッド: ラベル / ビジュアル / 数字 — 同列に揃える */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap: 8 }}>

        {/* Row 1: Labels */}
        <p className="text-center text-xs font-bold" style={{ color: 'var(--text-muted)' }}>摂取カロリー</p>
        <p className="text-center text-xs font-bold" style={{ color: 'var(--text-muted)' }}>消費カロリー</p>

        {/* Row 2: Visuals */}
        <div className="flex justify-center">
          <WaterTank percentage={percentage} />
        </div>
        <div className="flex justify-center">
          <Flame kcal={burnedKcal} />
        </div>

        {/* Row 3: Numbers — 同じ行なので自動的に同列 */}
        <div className="text-center">
          <p className="text-xl font-black" style={{ color: 'var(--text)' }}>
            {intakeKcal.toLocaleString()}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            / {targetKcal.toLocaleString()} kcal
          </p>
          {percentage > 100 && (
            <p className="text-xs font-black mt-0.5" style={{ color: overColor }}>
              {percentage > 120 ? '大幅超過！' : 'オーバー'}
            </p>
          )}
        </div>
        <div className="text-center">
          <p className="text-xl font-black" style={{ color: 'var(--text)' }}>
            {burnedKcal > 0 ? burnedKcal.toLocaleString() : '--'}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>kcal</p>
        </div>

      </div>

      {/* 消費カロリー + 基礎代謝 合計 */}
      {bmr != null && (burnedKcal > 0) && (
        <div className="mt-4 rounded-xl px-4 py-3 flex justify-between items-center" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}>
          <p className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>消費カロリー + 基礎代謝</p>
          <p className="text-lg font-black" style={{ color: 'var(--primary)' }}>{(burnedKcal + bmr).toLocaleString()} <span className="text-xs font-bold">kcal</span></p>
        </div>
      )}
    </div>
  )
}
