'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { MealLog, MealItem, MEAL_CATEGORIES, MealCategory } from '@/types'
import SignupPromptModal from '@/components/ui/SignupPromptModal'
import { useT, TranslationKey } from '@/lib/i18n'
import { CharacterId, CHARACTERS, getCharacterImageUrl } from '@/lib/characters'
import { getCachedResult, setCachedResult, removeCachedResult } from '@/lib/characterMessageCache'
import { describeAiResponseError } from '@/lib/ai/client-errors'
import { MEAL_PHOTO_BUCKET, normalizeMealPhotoPath, getMealPhotoSignedUrl } from '@/lib/storage/mealPhoto'
import { isStalePhotoOperation, isBlankPhotoReference, type MealFormContext } from '@/lib/storage/mealPhotoFormContext'

type FitnessGoal = 'lose_weight' | 'maintain' | 'gain_muscle'

const PFC_RATIO: Record<FitnessGoal, { protein: number; fat: number; carbs: number }> = {
  lose_weight:  { protein: 1.2, fat: 0.7, carbs: 3 },
  maintain:     { protein: 1.6, fat: 0.8, carbs: 4 },
  gain_muscle:  { protein: 2.0, fat: 0.8, carbs: 5 },
}

type Props = {
  dateId: string
  initialMealLogs: MealLog[]
  isGuest: boolean
  goalWeight: string | null
  characterId?: CharacterId | null
  targetCalories?: number
  fitnessGoal?: FitnessGoal | null
}

const MEAL_CATEGORY_EMOJI: Record<string, string> = {
  Breakfast: '🌅',
  Lunch: '☀️',
  Dinner: '🌙',
  Snacking: '🍪',
}

export default function MealClient({ dateId, initialMealLogs, isGuest, goalWeight, characterId, targetCalories: targetCaloriesProp, fitnessGoal }: Props) {
  const router = useRouter()
  const t = useT()
  const [mealLogs, setMealLogs] = useState<MealLog[]>(initialMealLogs)
  const [activeCategory, setActiveCategory] = useState<MealCategory | null>(null)
  const [addingItem, setAddingItem] = useState(false)
  const [newItem, setNewItem] = useState<Partial<MealItem>>({ name: '', amount: '', calorie: '', protein: '', fat: '', carbohydrate: '' })
  const [baseItem, setBaseItem] = useState<Partial<MealItem>>({ name: '', amount: '', calorie: '', protein: '', fat: '', carbohydrate: '' })
  const [servings, setServings] = useState(1)
  const [servingsStr, setServingsStr] = useState('1')
  const [saving, setSaving] = useState(false)
  const [showSignupModal, setShowSignupModal] = useState(false)
  const [signupVariant, setSignupVariant] = useState<'default' | 'after-save' | 'ai'>('default')
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [showPhotoOptions, setShowPhotoOptions] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingDescription, setPendingDescription] = useState('')
  // Persistent references (saved to DB): meal-photos object paths, never signed URLs.
  // pendingPhotoPath (AI flow) と manualPhotoPath (手動/編集flow) は常に排他的
  // （setActivePendingPhotoPath／setActiveManualPhotoPathでのみ更新する）。
  const [pendingPhotoPath, setPendingPhotoPath] = useState<string | null>(null)
  const [manualPhotoPath, setManualPhotoPath] = useState<string | null>(null)
  // item編集開始時のraw photo_url（userId取得前は正規化できないため一時保持。
  // userId取得後にnormalizeMealPhotoPathへ通してmanualPhotoPathへ反映する）。
  const [rawPhotoReference, setRawPhotoReference] = useState<string | null>(null)
  // Display-only: a blob: preview (pre-upload) or a short-lived signed URL. Never persisted.
  const [photoDisplayUrl, setPhotoDisplayUrl] = useState<string | null>(null)
  const [photoDisplayFailed, setPhotoDisplayFailed] = useState(false)
  // generation:category:path の複合key。同一pathでの再試行を1回だけに制限しつつ、
  // category切替後は別keyとして扱われ、旧categoryの再試行状態を引き継がない。
  const photoErrorRetriedKeyRef = useRef<string | null>(null)
  // フォーム／写真操作の世代。open-add／start-edit／close／delete／新規uploadのたびに
  // incrementし、非同期処理は開始時にcaptureした世代が最新でなければ結果を破棄する。
  const photoGenerationRef = useRef(0)
  // 「どのcategory／どのitemを編集中か」を同期的に保持するref。カテゴリ切替や
  // フォーム開閉のhandler内でstate更新前に同期更新し、非同期callbackはこのrefと
  // 自分がcaptureしたcontextを比較して、結果を適用してよいか判定する。
  const formContextRef = useRef<MealFormContext>({ category: null, editingItemId: null })
  // 写真uploadの操作ID。新しいuploadを開始するたびにincrementし、古いuploadの
  // finallyが自分より新しいuploadのphotoUploadingを誤って解除しないようにする。
  const uploadOperationRef = useRef(0)
  // pendingPhotoPath ?? manualPhotoPath の最新値を保持するref。非同期callback完了時に
  // closure化されたstateではなくこちらを参照し、「requestしたpathと現在のactive pathが
  // 一致するか」を再確認する。
  const activePhotoPathRef = useRef<string | null>(null)
  const [photoUploading, setPhotoUploading] = useState(false)
  const manualFileInputRef = useRef<HTMLInputElement>(null)
  const manualCameraInputRef = useRef<HTMLInputElement>(null)
  const [showManualPhotoOptions, setShowManualPhotoOptions] = useState(false)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [mealAiMessage, setMealAiMessage] = useState<string | null>(null)
  const [aiForceRefresh, setAiForceRefresh] = useState(0)
  const aiRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [mealAiExpression, setMealAiExpression] = useState<import('@/lib/characters').ExpressionId | null>(null)

  useEffect(() => {
    if (!isGuest) {
      createClient().auth.getUser().then(({ data: { user } }) => {
        if (user) setUserId(user.id)
      })
    }
  }, [isGuest])

  // --- 写真state操作helper（すべてphotoGenerationRef／formContextRefと排他性を維持する） ---

  const nextPhotoGeneration = () => {
    photoGenerationRef.current += 1
    return photoGenerationRef.current
  }

  // 現在のcategory／編集対象itemをrefへ同期する。カテゴリ切替・追加開始・編集開始・
  // close各handlerの先頭で呼び、以後の非同期処理はこのrefのスナップショットと比較する。
  const syncFormContextRef = (category: MealCategory | null, editingItemId: string | null) => {
    formContextRef.current = { category, editingItemId }
  }
  const captureFormContext = (): MealFormContext => ({ ...formContextRef.current })

  // 写真upload操作ID。開始のたびにincrementし、finally節が「自分がまだ最新の
  // uploadか」を判定できるようにする。invalidateはuploadを一切開始せずに現在の
  // 操作を失効させたい場合（フォームclose等）に使う。
  const startPhotoUploadOperation = () => {
    uploadOperationRef.current += 1
    return uploadOperationRef.current
  }
  const invalidatePhotoUploadOperation = () => {
    uploadOperationRef.current += 1
  }

  // generation／category・編集対象item／（渡された場合は）upload操作IDのすべてが
  // 一致する場合のみfalseを返す。ひとつでも古ければstale＝結果を破棄すべき。
  const isPhotoOperationStale = (captured: { generation: number; context: MealFormContext; uploadOperationId?: number }) =>
    isStalePhotoOperation({
      capturedGeneration: captured.generation,
      currentGeneration: photoGenerationRef.current,
      capturedContext: captured.context,
      currentContext: formContextRef.current,
      capturedOperationId: captured.uploadOperationId,
      currentOperationId: captured.uploadOperationId !== undefined ? uploadOperationRef.current : undefined,
    })

  // pending（AI解析）とmanual（手動/編集）のpersistent referenceは常に排他的に保つ。
  const setActivePendingPhotoPath = (path: string | null) => {
    setManualPhotoPath(null)
    setPendingPhotoPath(path)
  }
  const setActiveManualPhotoPath = (path: string | null) => {
    setPendingPhotoPath(null)
    setManualPhotoPath(path)
  }

  const clearPhotoDisplay = () => {
    setPhotoDisplayUrl((prev) => {
      if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev)
      return null
    })
    setPhotoDisplayFailed(false)
    photoErrorRetriedKeyRef.current = null
  }

  // フォームclose／item切替／写真削除の起点。世代とupload操作IDをincrementする
  // ことで、進行中の非同期処理（upload・signed URL取得・retry）の結果を無効化し、
  // photoUploadingも新しいcontextのために強制的にfalseへ戻す（古いuploadの
  // finallyが自分のcontext変更後に来ても、二度とtrueへ戻さないようにするため）。
  const resetPhotoState = () => {
    nextPhotoGeneration()
    invalidatePhotoUploadOperation()
    setPhotoUploading(false)
    setPendingPhotoPath(null)
    setManualPhotoPath(null)
    setRawPhotoReference(null)
    clearPhotoDisplay()
  }

  // 写真以外の入力欄（品目名・量・栄養値・編集対象item）をresetする。
  // 既に保存済みのmealLogs一覧はここでは一切変更しない。
  const resetItemFormFields = () => {
    setNewItem({ name: '', amount: '', calorie: '', protein: '', fat: '', carbohydrate: '' })
    setBaseItem({ name: '', amount: '', calorie: '', protein: '', fat: '', carbohydrate: '' })
    setServings(1)
    setServingsStr('1')
    setEditingItemId(null)
  }

  // AI解析／手動写真UIの補助state（選択中ファイル・説明文・エラー・オプション表示）をresetする。
  const resetAiPhotoUiState = () => {
    setShowPhotoOptions(false)
    setPendingFile(null)
    setPendingDescription('')
    setAnalyzeError(null)
    setShowManualPhotoOptions(false)
  }

  // カテゴリ切替・追加開始・編集開始・close共通のフォームcontext resetの土台。
  // 呼び出し側はこの後にcategory固有／item固有のstateを設定する。
  const resetFormContext = () => {
    resetPhotoState()
    resetItemFormFields()
    resetAiPhotoUiState()
    setAnalyzing(false)
  }

  // activePhotoPathRefを常に最新のpending??manualへ同期する。
  useEffect(() => {
    activePhotoPathRef.current = pendingPhotoPath ?? manualPhotoPath
  }, [pendingPhotoPath, manualPhotoPath])

  // 編集開始時に保持したraw photo_urlを、userId取得後に正規化する。
  // 空文字／空白のみは「写真なし」として即座に確定し（修正8）、userId取得を待たない。
  // 非空の値だけが「正規化のためuserId取得を待つ、genuineな保留状態」となる。
  useEffect(() => {
    if (rawPhotoReference === null) return
    if (isBlankPhotoReference(rawPhotoReference)) {
      setRawPhotoReference(null)
      return
    }
    if (!userId) return
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    if (!supabaseUrl) return
    const generation = photoGenerationRef.current
    const formContext = captureFormContext()
    const normalized = normalizeMealPhotoPath(rawPhotoReference, { supabaseUrl, userId })
    if (isPhotoOperationStale({ generation, context: formContext })) return
    setRawPhotoReference(null)
    setActiveManualPhotoPath(normalized)
  }, [rawPhotoReference, userId])

  // AI解析写真: pathが決まり次第、表示用のsigned URLを取得する
  useEffect(() => {
    if (!pendingPhotoPath || !userId) return
    const generation = photoGenerationRef.current
    const formContext = captureFormContext()
    const requestedPath = pendingPhotoPath
    let cancelled = false
    photoErrorRetriedKeyRef.current = null
    setPhotoDisplayFailed(false)
    const supabase = createClient()
    getMealPhotoSignedUrl(supabase, requestedPath).then((url) => {
      if (cancelled) return
      if (isPhotoOperationStale({ generation, context: formContext })) return
      if (activePhotoPathRef.current !== requestedPath) return
      if (url) setPhotoDisplayUrl(url)
      else setPhotoDisplayFailed(true)
    })
    return () => { cancelled = true }
  }, [pendingPhotoPath, userId])

  // 手動写真／編集中item: pathが決まり次第、signed URLを取得してblobプレビューを置き換える
  useEffect(() => {
    if (!manualPhotoPath || !userId) return
    const generation = photoGenerationRef.current
    const formContext = captureFormContext()
    const requestedPath = manualPhotoPath
    let cancelled = false
    photoErrorRetriedKeyRef.current = null
    setPhotoDisplayFailed(false)
    const supabase = createClient()
    getMealPhotoSignedUrl(supabase, requestedPath).then((url) => {
      if (cancelled) return
      if (isPhotoOperationStale({ generation, context: formContext })) return
      if (activePhotoPathRef.current !== requestedPath) return
      if (url) {
        setPhotoDisplayUrl((prev) => {
          if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev)
          return url
        })
      } else {
        setPhotoDisplayFailed(true)
      }
    })
    return () => { cancelled = true }
  }, [manualPhotoPath, userId])

  const applyServings = (newVal: number) => {
    const mul = (v: string) => v ? String(Math.round(parseFloat(v) * newVal * 10) / 10) : ''
    setNewItem((p) => ({
      ...p,
      amount: mul(baseItem.amount ?? ''),
      calorie: mul(baseItem.calorie ?? ''),
      protein: mul(baseItem.protein ?? ''),
      fat: mul(baseItem.fat ?? ''),
      carbohydrate: mul(baseItem.carbohydrate ?? ''),
    }))
    setServings(newVal)
  }

  const handleNumericInput = (field: keyof typeof newItem) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const filtered = e.target.value.replace(/[^0-9.]/g, '').replace(/^(\d*\.?\d*).*$/, '$1')
    setNewItem((p) => ({ ...p, [field]: filtered }))
    const parsed = parseFloat(filtered)
    if (!isNaN(parsed)) setBaseItem((p) => ({ ...p, [field]: String(parsed / servings) }))
  }

  // カテゴリ切替。refを最初に同期更新してから非同期処理を失効させることで、
  // 「state更新とref更新の間に古い値が残る窓」を作らない。
  const handleCategoryChange = (nextCategory: MealCategory) => {
    syncFormContextRef(nextCategory, null)
    resetFormContext()
    setAddingItem(false)
    setActiveCategory(nextCategory)
  }

  // 「＋追加」ボタン。カテゴリは維持するが、フォームcontext（世代・upload操作・
  // 写真state・入力欄）はすべて新規addingとして初期化する。
  const handleStartAddItem = () => {
    syncFormContextRef(activeCategory, null)
    resetFormContext()
    setAddingItem(true)
  }

  const closeForm = () => {
    syncFormContextRef(activeCategory, null)
    resetFormContext()
    setAddingItem(false)
  }

  const startEditItem = (item: MealItem) => {
    syncFormContextRef(activeCategory, item.id)
    resetFormContext()
    const savedServings = item.servings ?? 1
    const div = (v: string) => v && savedServings !== 1 ? String(parseFloat(v) / savedServings) : v
    setBaseItem({ name: item.name, amount: div(item.amount), calorie: div(item.calorie), protein: div(item.protein), fat: div(item.fat), carbohydrate: div(item.carbohydrate) })
    setNewItem({ name: item.name, amount: item.amount, calorie: item.calorie, protein: item.protein, fat: item.fat, carbohydrate: item.carbohydrate })
    setServings(savedServings)
    setServingsStr(String(savedServings))
    setEditingItemId(item.id)
    setAddingItem(true)
    // そのアイテム固有の写真を編集フォームに表示。空文字／空白は「写真なし」として
    // 即座に確定する（修正8）。非空の値だけをrawPhotoReferenceへ保持し、userId未取得
    // の場合はuseEffectがuserId取得後に正規化する。legacy公開URL／object pathの
    // どちらでも、本人所有のmeal-photosパスだけをnormalizeMealPhotoPathが通す。
    setRawPhotoReference(isBlankPhotoReference(item.photo_url) ? null : (item.photo_url as string))
  }

  const compressImage = (file: File, maxPx = 800, quality = 0.7): Promise<{ base64: string; mimeType: string; blob: Blob }> =>
    new Promise((resolve, reject) => {
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(url)
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height))
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
        const dataUrl = canvas.toDataURL('image/jpeg', quality)
        canvas.toBlob((blob) => {
          if (!blob) { reject(new Error('blob failed')); return }
          resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg', blob })
        }, 'image/jpeg', quality)
      }
      img.onerror = reject
      img.src = url
    })

  // 戻り値はobject path（bucket公開URLではない）。DBへはこのpathを保存する。
  const uploadPhotoToStorage = async (blob: Blob, uid: string): Promise<string | null> => {
    const supabase = createClient()
    const path = `${uid}/${dateId}/${crypto.randomUUID()}.jpg`
    const { error } = await supabase.storage.from(MEAL_PHOTO_BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false })
    if (error) return null
    return path
  }

  // reference（legacy公開URLまたはobject path）を必ずnormalizeMealPhotoPathへ通し、
  // 本人所有のmeal-photosパスと確認できた場合だけStorage削除を行う。
  const deletePhotoFromStorage = async (reference: string, uid: string) => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    if (!supabaseUrl) return
    const path = normalizeMealPhotoPath(reference, { supabaseUrl, userId: uid })
    if (!path) return
    const supabase = createClient()
    await supabase.storage.from(MEAL_PHOTO_BUCKET).remove([path])
  }

  // 削除中にフォームclose／category切替／item切替が起きた場合、stale callbackが
  // 新フォームの写真stateをclearしないよう、削除完了後にgeneration・category・
  // 編集対象itemの一致を再確認する（修正9）。
  const handleRemovePhoto = async () => {
    const generation = nextPhotoGeneration()
    const formContext = captureFormContext()
    const pathToDelete = pendingPhotoPath ?? manualPhotoPath
    if (pathToDelete && userId) await deletePhotoFromStorage(pathToDelete, userId)
    if (isPhotoOperationStale({ generation, context: formContext })) return
    resetPhotoState()
  }

  // signed URLの期限切れ／読み込み失敗時、同一pathに対し1回だけ再発行を試みる。
  // 再発行済みでもエラーが続く場合は無限loopを避けfallback表示へ切り替える。
  // retryキーはgeneration:category:pathの複合キー（修正10）とし、category Aで
  // 開始したretryがcategory Bの表示へ解決されることはない。完了時はgeneration・
  // category・編集対象item・activePhotoPathRefの全てを再確認し、closure化された
  // stateだけに依存しない。
  const handlePhotoDisplayError = () => {
    const path = pendingPhotoPath ?? manualPhotoPath
    if (!path || !userId) {
      setPhotoDisplayUrl(null)
      setPhotoDisplayFailed(true)
      return
    }
    const generation = photoGenerationRef.current
    const formContext = captureFormContext()
    const retryKey = `${generation}:${formContext.category ?? ''}:${path}`
    if (photoErrorRetriedKeyRef.current === retryKey) {
      setPhotoDisplayUrl(null)
      setPhotoDisplayFailed(true)
      return
    }
    photoErrorRetriedKeyRef.current = retryKey
    const supabase = createClient()
    getMealPhotoSignedUrl(supabase, path).then((url) => {
      if (isPhotoOperationStale({ generation, context: formContext })) return
      if (activePhotoPathRef.current !== path) return
      if (url) {
        setPhotoDisplayUrl(url)
      } else {
        setPhotoDisplayUrl(null)
        setPhotoDisplayFailed(true)
      }
    })
  }

  const analyzeImage = async (file: File, description: string) => {
    // このAI解析セッションのgeneration・category・編集対象itemをcapture。await中に
    // カテゴリ切替／フォームclose／別itemの編集開始が起きた場合、解析結果・upload結果・
    // ローディング表示・エラー表示のいずれも新フォームへ反映しない（修正4）。
    const generation = nextPhotoGeneration()
    const formContext = captureFormContext()
    const isStale = () => isPhotoOperationStale({ generation, context: formContext })

    setPendingFile(null)
    setAnalyzeError(null)
    setAnalyzing(true)

    try {
      let base64: string
      let mimeType: string
      let blob: Blob
      try {
        const compressed = await compressImage(file)
        base64 = compressed.base64
        mimeType = compressed.mimeType
        blob = compressed.blob
      } catch {
        if (!isStale()) setAnalyzeError('画像の読み込みに失敗しました')
        return
      }
      // compressImage完了後: 切替済みなら以降のAPI呼び出し自体を行わない
      if (isStale()) return

      const res = await fetch('/api/analyze-meal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mimeType, description }),
      })
      // AI API応答後
      if (isStale()) return

      const text = await res.text()
      if (!res.ok) {
        let code: string | undefined
        try {
          code = (JSON.parse(text) as { error?: string }).error
        } catch {}
        const { message, retryAfterSeconds } = describeAiResponseError(res, code)
        if (!isStale()) setAnalyzeError(retryAfterSeconds ? `${message}（${retryAfterSeconds}秒後に再試行できます）` : message)
        return
      }

      let data: Record<string, string>
      try {
        data = JSON.parse(text)
      } catch {
        if (!isStale()) setAnalyzeError(`JSONパース失敗: ${text.slice(0, 200)}`)
        return
      }

      if (!data.name) {
        if (!isStale()) setAnalyzeError(data.error ?? '解析に失敗しました')
        return
      }

      // 栄養値state反映前
      if (isStale()) return
      setNewItem({
        name: data.name,
        calorie: data.calorie ?? '',
        protein: data.protein ?? '',
        fat: data.fat ?? '',
        carbohydrate: data.carbohydrate ?? '',
        amount: data.amount ?? '',
      })

      // AI解析に使った写真をStorageにアップロード（戻り値はobject path）
      if (userId) {
        const path = await uploadPhotoToStorage(blob, userId)
        // Storage upload完了後／photo path state反映前
        if (isStale()) return
        setActivePendingPhotoPath(path)
      }
      setAddingItem(true)
    } catch (e) {
      if (!isStale()) setAnalyzeError(String(e))
    } finally {
      // staleなら、このcontextのanalyzing表示は既にresetFormContextが解除済み。
      // ここで触ると、切替後に新たに始まった解析のローディング表示を誤って消しうる。
      if (!isStale()) setAnalyzing(false)
    }
  }

  const handleManualPhoto = async (file: File) => {
    // 新しいuploadの開始。generation・upload操作IDをbumpすることで、キャンセル・
    // カテゴリ切替・item切替・別の新しいuploadによって、この結果が後から古い
    // フォームへ反映されないようにする（修正3）。cleanupはtry/finallyで必ず実行し、
    // 「stale時にreturnしてcleanupを飛ばす」構成にはしない。finally内部でこの操作が
    // まだ最新かを判定してから状態を変更する。
    const generation = nextPhotoGeneration()
    const formContext = captureFormContext()
    const uploadId = startPhotoUploadOperation()
    const isStale = () => isPhotoOperationStale({ generation, context: formContext, uploadOperationId: uploadId })

    setPhotoUploading(true)
    // 選択直後はローカルのblob:プレビューを即表示し、upload完了後にsigned URLへ置き換える
    const previewUrl = URL.createObjectURL(file)
    setActiveManualPhotoPath(null)
    setPhotoDisplayUrl((prev) => {
      if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev)
      return previewUrl
    })
    setPhotoDisplayFailed(false)

    try {
      const { blob } = await compressImage(file)
      if (isStale()) {
        URL.revokeObjectURL(previewUrl)
        return
      }
      if (userId) {
        const path = await uploadPhotoToStorage(blob, userId)
        if (isStale()) {
          URL.revokeObjectURL(previewUrl)
          return
        }
        // upload失敗時はpathをnullのままにし、blobプレビューだけを残す
        // （公開URLへのfallbackは行わない。保存時はphoto_urlなしとして扱われる）
        if (path) setActiveManualPhotoPath(path)
      }
    } catch {
      // 失敗時は無視（blobプレビューは残るが、pathが未確定のためDBへは保存されない）
    } finally {
      // 自分がまだ最新の操作である場合のみloading解除・オプション閉じを行う。
      // supersededな古い操作のfinallyが、新しい操作のphotoUploading=trueを
      // 誤ってfalseへ戻すことはない。
      if (!isStale()) {
        setPhotoUploading(false)
        setShowManualPhotoOptions(false)
      }
    }
  }

  const getLog = (cat: MealCategory) => mealLogs.find((l) => l.category === cat)
  const totalCalories = mealLogs.reduce((a, l) => a + l.items.reduce((b, i) => b + (parseFloat(i.calorie) || 0), 0), 0)
  const totalProtein = mealLogs.reduce((a, l) => a + l.items.reduce((b, i) => b + (parseFloat(i.protein) || 0), 0), 0)
  const totalFat = mealLogs.reduce((a, l) => a + l.items.reduce((b, i) => b + (parseFloat(i.fat) || 0), 0), 0)
  const totalCarbs = mealLogs.reduce((a, l) => a + l.items.reduce((b, i) => b + (parseFloat(i.carbohydrate) || 0), 0), 0)

  const gw = parseFloat(goalWeight ?? '')
  const baseWeight = !isNaN(gw) && gw > 0 ? gw : 60
  const ratio = PFC_RATIO[fitnessGoal ?? 'maintain']
  const proteinTarget = Math.round(baseWeight * ratio.protein)
  const fatTarget = Math.round(baseWeight * ratio.fat)
  const carbsTarget = Math.round(baseWeight * ratio.carbs)
  // 目標カロリー：サーバーから渡された正確な値を優先（なければPFC計算値）
  const targetCalories = targetCaloriesProp ?? (proteinTarget * 4 + fatTarget * 9 + carbsTarget * 4)

  const hasLoggedFood = mealLogs.some((l) => l.items.length > 0)

  // 食事保存後30秒経過したらAIメッセージを最新データで再取得
  const scheduleAiRefresh = () => {
    if (!characterId || isGuest) return
    if (aiRefreshTimerRef.current) clearTimeout(aiRefreshTimerRef.current)
    aiRefreshTimerRef.current = setTimeout(() => {
      setAiForceRefresh((prev) => prev + 1)
    }, 30000)
  }

  // AI メッセージ＋表情取得（通常は6時間キャッシュ、食事追加後は強制更新）
  useEffect(() => {
    if (!characterId || isGuest) return
    const cacheKey = `meal_${characterId}_${dateId}`

    if (aiForceRefresh === 0) {
      // 初回：キャッシュがあれば使う
      const cached = getCachedResult(cacheKey)
      if (cached) {
        setMealAiMessage(cached.message)
        if (cached.expression) setMealAiExpression(cached.expression)
        return
      }
    } else {
      // 強制リフレッシュ：古いキャッシュを削除して最新データで取得
      removeCachedResult(cacheKey)
    }

    fetch('/api/character-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        characterId,
        page: 'meal',
        userData: {
          totalCalories: Math.round(totalCalories),
          targetCalories,
          protein: Math.round(totalProtein),
          proteinTarget,
          fat: Math.round(totalFat),
          fatTarget,
          carbs: Math.round(totalCarbs),
          carbsTarget,
          weight: goalWeight ?? undefined,
        },
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.message) {
          setCachedResult(cacheKey, data.message, data.expression)
          setMealAiMessage(data.message)
          if (data.expression) setMealAiExpression(data.expression)
        }
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId, dateId, aiForceRefresh])

  const pfcItems = [
    { key: 'proteinLabel' as const, value: totalProtein, target: proteinTarget, color: '#3b82f6' },
    { key: 'fatLabel' as const, value: totalFat, target: fatTarget, color: '#f59e0b' },
    { key: 'carbsLabel' as const, value: totalCarbs, target: carbsTarget, color: '#10b981' },
  ]

  const pfcWarnings: { key: string; msg: string }[] = hasLoggedFood ? [
    totalProtein < proteinTarget * 0.8 ? { key: 'protein-low', msg: `${t('proteinLow')} (あと ${Math.round(proteinTarget - totalProtein)}g)` } : null,
    totalFat > fatTarget * 1.2 ? { key: 'fat-high', msg: `脂質が超過しています (+${Math.round(totalFat - fatTarget)}g)` } : null,
    totalCarbs > carbsTarget * 1.2 ? { key: 'carbs-high', msg: `炭水化物が超過しています (+${Math.round(totalCarbs - carbsTarget)}g)` } : null,
  ].filter(Boolean) as { key: string; msg: string }[] : []

  const handleSaveItem = async () => {
    if (!activeCategory || !newItem.name) return
    // 写真参照の正規化が完了するまで保存しない。rawPhotoReferenceが残ったまま
    // 保存すると、userId未取得タイミングの都合で既存写真参照をnullへ
    // 上書きしてしまう可能性がある（修正5）。
    if (rawPhotoReference !== null) return
    // pendingPhotoPath／manualPhotoPathは常にmeal-photos object path（またはnull）であり、
    // blob:プレビューはphotoDisplayUrlだけに存在するため、ここでのフィルタは不要。
    // 既存itemを編集した場合は、legacy公開URLがnormalizeMealPhotoPath済みのpathへ自然に移行する。
    const persistentPhotoPath = pendingPhotoPath ?? manualPhotoPath ?? null

    const updatedFields = {
      name: newItem.name ?? '',
      amount: newItem.amount ?? '',
      calorie: newItem.calorie ?? '0',
      protein: newItem.protein ?? '',
      fat: newItem.fat ?? '',
      carbohydrate: newItem.carbohydrate ?? '',
      sugar: '', dietary_fiber: '', salt: '', sodium: '', potassium: '', calcium: '', magnesium: '',
      servings,
      photo_url: persistentPhotoPath,
    }

    if (isGuest) {
      setMealLogs((prev) => {
        const existing = prev.find((l) => l.category === activeCategory)
        if (editingItemId) {
          return prev.map((l) => l.category === activeCategory
            ? { ...l, items: l.items.map((i) => i.id === editingItemId ? { ...i, ...updatedFields } : i) }
            : l)
        }
        const item: MealItem = { id: crypto.randomUUID(), ...updatedFields }
        if (existing) return prev.map((l) => l.category === activeCategory ? { ...l, items: [...l.items, item] } : l)
        return [...prev, { id: crypto.randomUUID(), user_id: 'guest', date_id: dateId, category: activeCategory, items: [item], did_not_eat: false, created_at: new Date().toISOString() }]
      })
      closeForm()
      setSignupVariant('after-save')
      setShowSignupModal(true)
      return
    }

    setSaving(true)
    if (!userId) { setSaving(false); return }
    const supabase = createClient()

    const existing = getLog(activeCategory)
    const items = editingItemId
      ? (existing?.items ?? []).map((i) => i.id === editingItemId ? { ...i, ...updatedFields } : i)
      : [...(existing?.items ?? []), { id: crypto.randomUUID(), ...updatedFields }]

    const upsertPayload: Record<string, unknown> = {
      ...(existing ? { id: existing.id } : {}),
      user_id: userId!,
      date_id: dateId,
      category: activeCategory,
      items,
      did_not_eat: false,
    }

    const { data, error } = await supabase
      .from('meal_logs')
      .upsert(upsertPayload, { onConflict: 'user_id,date_id,category' })
      .select()
      .single()

    if (error) {
      console.error('meal save error:', error)
      setSaving(false)
      return
    }

    if (data) {
      setMealLogs((prev) => {
        const filtered = prev.filter((l) => l.category !== activeCategory)
        return [...filtered, data]
      })
    }

    closeForm()
    setSaving(false)
    scheduleAiRefresh()
  }

  const handleDidNotEat = async (category: MealCategory) => {
    if (isGuest) {
      setMealLogs((prev) => {
        const existing = prev.find((l) => l.category === category)
        const newVal = !(existing?.did_not_eat)
        if (existing) return prev.map((l) => l.category === category ? { ...l, did_not_eat: newVal } : l)
        return [...prev, { id: crypto.randomUUID(), user_id: 'guest', date_id: dateId, category, items: [], did_not_eat: newVal, created_at: new Date().toISOString() }]
      })
      setSignupVariant('after-save')
      setShowSignupModal(true)
      return
    }
    if (!userId) return
    const log = getLog(category)
    const supabase = createClient()

    const newDidNotEat = !(log?.did_not_eat)
    const { data } = await supabase
      .from('meal_logs')
      .upsert({
        ...(log ? { id: log.id } : {}),
        user_id: userId!,
        date_id: dateId,
        category,
        items: [],
        did_not_eat: newDidNotEat,
      }, { onConflict: 'user_id,date_id,category' })
      .select()
      .single()

    if (data) {
      setMealLogs((prev) => {
        const filtered = prev.filter((l) => l.category !== category)
        return [...filtered, data]
      })
    }
  }

  const handleDeleteItem = async (category: MealCategory, itemId: string) => {
    const log = getLog(category)
    if (!log) return
    const items = log.items.filter((i) => i.id !== itemId)
    const supabase = createClient()
    const { data } = await supabase
      .from('meal_logs')
      .update({ items })
      .eq('id', log.id)
      .select()
      .single()
    if (data) setMealLogs((prev) => prev.map((l) => l.category === category ? data : l))
  }

  const dateLabel = `${dateId.slice(0, 4)}/${dateId.slice(4, 6)}/${dateId.slice(6, 8)}`
  const dateInputValue = `${dateId.slice(0, 4)}-${dateId.slice(4, 6)}-${dateId.slice(6, 8)}`
  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDateId = e.target.value.replace(/-/g, '')
    if (newDateId.length === 8) router.push(`/meal?date=${newDateId}`)
  }

  return (
    <div className="space-y-6">
      {showSignupModal && <SignupPromptModal variant={signupVariant} onClose={() => { setShowSignupModal(false); setSignupVariant('default') }} />}

      {/* Page title */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black" style={{ color: 'var(--text)' }}>{t('mealsTitle')} 🥗</h1>
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

      {/* キャラクター＋カロリー統合カード */}
      {characterId ? (() => {
        const char = CHARACTERS[characterId]
        const msgs = char.defaultMessages
        const fallback = msgs[Math.floor(Math.random() * msgs.length)]
        const message = mealAiMessage ?? fallback
        return (
          <div className="rounded-2xl overflow-hidden shadow-sm flex items-stretch"
            style={{ backgroundColor: char.bgColor, border: `1px solid ${char.accentColor}40` }}>
            {/* キャラ画像（縦中央） */}
            <div className="flex-shrink-0 w-32 flex items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getCharacterImageUrl(characterId, mealAiExpression ?? 'normal')}
                alt={char.name}
                className="w-full object-contain object-bottom"
                style={{ maxHeight: 220 }}
              />
            </div>
            {/* 右側：名前＋カロリー＋吹き出し */}
            <div className="flex-1 min-w-0 flex flex-col justify-between p-4 gap-3">
              <div>
                <p className="text-xs font-bold mb-2" style={{ color: char.accentColor }}>
                  {char.name}
                  <span className="font-normal ml-1" style={{ color: 'var(--text-muted)' }}>/ {char.role}</span>
                </p>
                {/* カロリー表示（吹き出しの上） */}
                <div className="rounded-xl px-4 py-3 text-center mb-3" style={{ backgroundColor: char.accentColor }}>
                  <p className="text-xs font-bold text-white/80">{t('totalCalories')}</p>
                  <p className="text-3xl font-black text-white mt-0.5">
                    {totalCalories.toFixed(0)} <span className="text-base">kcal</span>
                  </p>
                </div>
                {/* 吹き出し */}
                <div className="relative">
                  <div className="absolute -left-2.5 top-4 w-0 h-0"
                    style={{
                      borderTop: '7px solid transparent',
                      borderBottom: '7px solid transparent',
                      borderRight: '10px solid var(--card)',
                    }} />
                  <div className="rounded-2xl px-4 py-3 shadow-sm" style={{ backgroundColor: 'var(--card)' }}>
                    <p className="text-sm font-bold leading-relaxed" style={{ color: 'var(--text)' }}>{message}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })() : (
        /* キャラ未設定時：従来のカロリーカード */
        <div className="rounded-2xl p-5 shadow-sm text-center" style={{ backgroundColor: 'var(--primary)', color: '#fff' }}>
          <p className="text-sm font-bold opacity-80">{t('totalCalories')}</p>
          <p className="text-4xl font-black mt-1">{totalCalories.toFixed(0)} <span className="text-xl">kcal</span></p>
        </div>
      )}

      {/* PFC balance card */}
      <div className="rounded-2xl p-5 shadow-sm" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-black text-sm" style={{ color: 'var(--text)' }}>{t('pfcBalance')}</h3>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('dailyTarget')}</span>
        </div>
        <div className="space-y-3">
          {pfcItems.map(({ key, value, target, color }) => {
            const pct = Math.min(100, (value / target) * 100)
            const barColor = pct >= 80 ? color : pct >= 50 ? '#f59e0b' : '#ef4444'
            return (
              <div key={key}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-bold" style={{ color: 'var(--text)' }}>{t(key)}</span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {value.toFixed(1)}g / {target}g
                  </span>
                </div>
                <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, backgroundColor: barColor }}
                  />
                </div>
              </div>
            )
          })}
        </div>
        {pfcWarnings.length > 0 && (
          <div className="mt-4 space-y-1.5">
            {pfcWarnings.map(({ key, msg }) => (
              <div key={key} className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca' }}>
                <span>⚠️</span>
                <p className="text-xs font-bold" style={{ color: '#dc2626' }}>{msg}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Category tabs */}
      <div className="grid grid-cols-4 gap-2">
        {MEAL_CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => handleCategoryChange(cat)}
            className="flex flex-col items-center py-3 rounded-xl transition font-bold text-xs"
            style={{
              border: `2px solid ${activeCategory === cat ? 'var(--primary)' : 'var(--border)'}`,
              backgroundColor: activeCategory === cat ? 'var(--accent-light)' : 'var(--card)',
              color: activeCategory === cat ? 'var(--primary)' : 'var(--text-muted)',
            }}
          >
            <span className="text-2xl mb-1">{MEAL_CATEGORY_EMOJI[cat]}</span>
            {t(cat.toLowerCase() as TranslationKey)}
          </button>
        ))}
      </div>

      {/* Active category */}
      {activeCategory && (
        <div className="rounded-2xl p-5 shadow-sm" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-black" style={{ color: 'var(--text)' }}>
              {MEAL_CATEGORY_EMOJI[activeCategory]} {t(activeCategory.toLowerCase() as TranslationKey)}
            </h3>
            <div className="flex gap-2">
              {(getLog(activeCategory)?.items ?? []).length === 0 && (
                <button
                  onClick={() => handleDidNotEat(activeCategory)}
                  className="px-3 py-1.5 rounded-lg text-sm font-bold transition"
                  style={{
                    backgroundColor: getLog(activeCategory)?.did_not_eat ? '#6b7280' : 'var(--bg)',
                    color: getLog(activeCategory)?.did_not_eat ? 'white' : 'var(--text-muted)',
                    border: `1px solid ${getLog(activeCategory)?.did_not_eat ? '#6b7280' : 'var(--border)'}`,
                  }}
                >
                  {getLog(activeCategory)?.did_not_eat ? '✓ 食べなかった' : '食べなかった'}
                </button>
              )}
              <button
                onClick={handleStartAddItem}
                disabled={!!getLog(activeCategory)?.did_not_eat}
                className="px-4 py-1.5 rounded-lg text-sm font-bold text-white disabled:opacity-40"
                style={{ backgroundColor: 'var(--primary)' }}
              >
                + {t('addFood')}
              </button>
            </div>
          </div>
          {getLog(activeCategory)?.did_not_eat && (
            <div className="rounded-xl py-4 px-3 mb-4 text-center" style={{ backgroundColor: 'var(--bg)', border: '1px dashed var(--border)' }}>
              <p className="text-sm font-bold" style={{ color: 'var(--text-muted)' }}>この食事はスキップしました</p>
            </div>
          )}

          {/* AI解析ボタン */}
          {!addingItem && <div className="mb-3">
            {/* ギャラリーから選択 */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) { setPendingFile(file); setPendingDescription('') }
                e.target.value = ''
                setShowPhotoOptions(false)
              }}
            />
            {/* カメラ撮影 */}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) { setPendingFile(file); setPendingDescription('') }
                e.target.value = ''
                setShowPhotoOptions(false)
              }}
            />

            {/* 説明入力ステップ（写真選択後） */}
            {pendingFile ? (
              <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'var(--accent-light)', border: '2px solid var(--accent)' }}>
                <p className="font-bold text-sm" style={{ color: 'var(--text)' }}>📝 食品の詳細を入力してください</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>量や種類を入力するとより正確に解析できます</p>
                <textarea
                  placeholder="例：ラーメン 大盛り、チキンカレー 普通盛り200g"
                  value={pendingDescription}
                  onChange={(e) => setPendingDescription(e.target.value)}
                  rows={3}
                  className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none resize-none"
                  style={{ borderColor: 'var(--accent)', backgroundColor: 'var(--bg)', color: 'var(--text)' }}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => { setPendingFile(null); setPendingDescription('') }}
                    className="flex-1 py-2 rounded-xl text-sm font-bold"
                    style={{ border: '1px solid var(--border)', color: 'var(--text-muted)', backgroundColor: 'var(--bg)' }}
                  >
                    やり直す
                  </button>
                  <button
                    onClick={() => analyzeImage(pendingFile, pendingDescription)}
                    className="flex-1 py-2 rounded-xl text-sm font-bold text-white"
                    style={{ backgroundColor: 'var(--accent)' }}
                  >
                    🤖 解析する
                  </button>
                </div>
              </div>
            ) : analyzing ? (
              <div className="w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2"
                style={{ backgroundColor: 'var(--accent-light)', color: 'var(--accent)', border: '2px dashed var(--accent)' }}>
                🤖 解析中...
              </div>
            ) : !showPhotoOptions ? (
              <>
                <button
                  onClick={() => {
                    if (isGuest) { setSignupVariant('ai'); setShowSignupModal(true); return }
                    setShowPhotoOptions(true); setAnalyzeError(null)
                  }}
                  className="w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition hover:opacity-80"
                  style={{ backgroundColor: 'var(--accent-light)', color: 'var(--accent)', border: '2px dashed var(--accent)' }}
                >
                  📸 写真でAI解析
                </button>
                {analyzeError && (
                  <div className="mt-2 rounded-xl px-4 py-3 text-sm font-bold" style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}>
                    ⚠️ エラー: {analyzeError}
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-xl overflow-hidden" style={{ border: '2px dashed var(--accent)' }}>
                <div className="flex">
                  <button
                    onClick={() => cameraInputRef.current?.click()}
                    className="flex-1 py-3 font-bold flex items-center justify-center gap-1 transition hover:opacity-80"
                    style={{ backgroundColor: 'var(--accent-light)', color: 'var(--accent)', borderRight: '1px solid var(--accent)' }}
                  >
                    📷 撮影
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-1 py-3 font-bold flex items-center justify-center gap-1 transition hover:opacity-80"
                    style={{ backgroundColor: 'var(--accent-light)', color: 'var(--accent)' }}
                  >
                    🖼️ アップロード
                  </button>
                </div>
                <button
                  onClick={() => setShowPhotoOptions(false)}
                  className="w-full py-1.5 text-xs transition hover:opacity-70"
                  style={{ backgroundColor: 'var(--accent-light)', color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}
                >
                  キャンセル
                </button>
              </div>
            )}
          </div>}

          {/* 食品検索バー → food-search ページへ */}
          {!getLog(activeCategory)?.did_not_eat && !addingItem && (
            <button
              onClick={() => router.push(`/meal/food-search?date=${dateId}&category=${activeCategory}`)}
              className="w-full mb-3 flex items-center gap-2 border rounded-xl px-3 py-2.5 text-sm text-left transition active:opacity-70 focus:outline-none"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)', color: 'var(--text-muted)', WebkitTapHighlightColor: 'transparent' }}
            >
              <span>🔍</span>
              <span>食品名で検索して追加...</span>
            </button>
          )}

          {/* 最近の食品 / 登録アイテム カード */}
          {!getLog(activeCategory)?.did_not_eat && !addingItem && (
            <div className="mb-3 space-y-2">
              <button
                onClick={() => router.push(`/meal/history?date=${dateId}&category=${activeCategory}`)}
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl transition active:opacity-60 focus:outline-none"
                style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', WebkitTapHighlightColor: 'transparent' }}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">🕐</span>
                  <div className="text-left">
                    <p className="font-bold text-sm" style={{ color: 'var(--text)' }}>最近の食品</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>過去に記録した食品から追加</p>
                  </div>
                </div>
                <span className="text-lg" style={{ color: 'var(--text-muted)' }}>›</span>
              </button>
              {!isGuest && (
                <button
                  onClick={() => router.push(`/meal/custom-items?date=${dateId}&category=${activeCategory}`)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl transition active:opacity-60 focus:outline-none"
                  style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', WebkitTapHighlightColor: 'transparent' }}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xl">📋</span>
                    <div className="text-left">
                      <p className="font-bold text-sm" style={{ color: 'var(--text)' }}>登録アイテム</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>自分で登録した食品から追加</p>
                    </div>
                  </div>
                  <span className="text-lg" style={{ color: 'var(--text-muted)' }}>›</span>
                </button>
              )}
            </div>
          )}

          {/* Add item form */}
          {addingItem && (
            <div className="rounded-xl p-4 mb-4 space-y-3" style={{ backgroundColor: 'var(--accent-light)' }}>
              <h4 className="font-bold text-sm" style={{ color: 'var(--text)' }}>{editingItemId ? '食品を編集' : t('addFood')}</h4>


              <input
                placeholder={t('foodName')}
                value={newItem.name}
                onChange={(e) => setNewItem((p) => ({ ...p, name: e.target.value }))}
                className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)', color: 'var(--text)' }}
              />
              <div className="flex items-center gap-2 py-1">
                <label className="text-xs font-bold shrink-0" style={{ color: 'var(--text-muted)' }}>何人前</label>
                <div className="flex items-center gap-1">
                  <button onClick={() => { const v = Math.max(1, servings - 1); applyServings(v); setServingsStr(String(v)) }}
                    className="w-7 h-7 rounded-lg text-sm font-bold flex items-center justify-center"
                    style={{ border: '1px solid var(--border)', color: 'var(--text-muted)', backgroundColor: 'var(--bg)' }}>−</button>
                  <input type="text" inputMode="decimal" value={servingsStr}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^0-9.]/g, '')
                      setServingsStr(raw)
                      const parsed = parseFloat(raw)
                      if (!isNaN(parsed) && parsed > 0) applyServings(parsed)
                    }}
                    className="w-14 text-center border rounded-lg px-1 py-1 text-sm font-bold focus:outline-none"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)', color: 'var(--text)' }} />
                  <button onClick={() => { const v = servings + 1; applyServings(v); setServingsStr(String(v)) }}
                    className="w-7 h-7 rounded-lg text-sm font-bold flex items-center justify-center"
                    style={{ border: '1px solid var(--border)', color: 'var(--text-muted)', backgroundColor: 'var(--bg)' }}>＋</button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>{t('amount')}</label>
                  <input type="text" inputMode="decimal" placeholder="0" value={newItem.amount} onChange={handleNumericInput('amount')}
                    className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)', color: 'var(--text)' }} />
                </div>
                <div>
                  <label className="text-xs font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>{t('calorie')}</label>
                  <input type="text" inputMode="decimal" placeholder="0" value={newItem.calorie} onChange={handleNumericInput('calorie')}
                    className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)', color: 'var(--text)' }} />
                </div>
                <div>
                  <label className="text-xs font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>{t('protein')}</label>
                  <input type="text" inputMode="decimal" placeholder="0" value={newItem.protein} onChange={handleNumericInput('protein')}
                    className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)', color: 'var(--text)' }} />
                </div>
                <div>
                  <label className="text-xs font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>{t('fat')}</label>
                  <input type="text" inputMode="decimal" placeholder="0" value={newItem.fat} onChange={handleNumericInput('fat')}
                    className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)', color: 'var(--text)' }} />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>{t('carbs')}</label>
                  <input type="text" inputMode="decimal" placeholder="0" value={newItem.carbohydrate} onChange={handleNumericInput('carbohydrate')}
                    className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)', color: 'var(--text)' }} />
                </div>
              </div>
              {/* 手動写真添付 */}
              <div>
                <input ref={manualFileInputRef} type="file" accept="image/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleManualPhoto(f); e.target.value = '' }} />
                <input ref={manualCameraInputRef} type="file" accept="image/*" capture="environment" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleManualPhoto(f); e.target.value = '' }} />
                {photoDisplayUrl ? (
                  <div className="relative rounded-xl overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photoDisplayUrl} alt="食事写真" className="w-full rounded-xl object-contain" style={{ maxHeight: 200, backgroundColor: 'var(--bg)' }} onError={handlePhotoDisplayError} />
                    <button
                      onClick={handleRemovePhoto}
                      className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
                      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
                    >✕</button>
                    {pendingPhotoPath && <span className="absolute bottom-2 left-2 text-xs font-bold px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>🤖 AI解析写真</span>}
                  </div>
                ) : photoUploading ? (
                  <div className="w-full py-2 rounded-xl text-xs text-center font-bold" style={{ backgroundColor: 'var(--bg)', color: 'var(--text-muted)', border: '1px dashed var(--border)' }}>
                    アップロード中...
                  </div>
                ) : photoDisplayFailed ? (
                  <div className="w-full py-2 rounded-xl text-xs text-center font-bold flex items-center justify-between gap-2 px-3" style={{ backgroundColor: 'var(--bg)', color: 'var(--text-muted)', border: '1px dashed var(--border)' }}>
                    <span>画像を表示できませんでした</span>
                    <button onClick={handleRemovePhoto} className="underline hover:opacity-70">写真を削除</button>
                  </div>
                ) : (pendingPhotoPath || manualPhotoPath || rawPhotoReference !== null) ? (
                  <div className="w-full py-2 rounded-xl text-xs text-center font-bold" style={{ backgroundColor: 'var(--bg)', color: 'var(--text-muted)', border: '1px dashed var(--border)' }}>
                    画像を読み込み中...
                  </div>
                ) : !showManualPhotoOptions ? (
                  <button onClick={() => setShowManualPhotoOptions(true)} className="w-full py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition hover:opacity-80"
                    style={{ backgroundColor: 'var(--bg)', color: 'var(--text-muted)', border: '1px dashed var(--border)' }}>
                    📷 写真を添付（任意）
                  </button>
                ) : (
                  <div className="rounded-xl overflow-hidden" style={{ border: '1px dashed var(--border)' }}>
                    <div className="flex">
                      <button onClick={() => manualCameraInputRef.current?.click()} className="flex-1 py-2 text-xs font-bold flex items-center justify-center gap-1 transition hover:opacity-80"
                        style={{ backgroundColor: 'var(--bg)', color: 'var(--text-muted)', borderRight: '1px solid var(--border)' }}>📷 撮影</button>
                      <button onClick={() => manualFileInputRef.current?.click()} className="flex-1 py-2 text-xs font-bold flex items-center justify-center gap-1 transition hover:opacity-80"
                        style={{ backgroundColor: 'var(--bg)', color: 'var(--text-muted)' }}>🖼️ アップロード</button>
                    </div>
                    <button onClick={() => setShowManualPhotoOptions(false)} className="w-full py-1 text-xs transition hover:opacity-70"
                      style={{ backgroundColor: 'var(--bg)', color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>キャンセル</button>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={closeForm}
                  className="flex-1 py-2 rounded-xl text-sm font-bold"
                  style={{ border: '1px solid var(--border)', color: 'var(--text-muted)', backgroundColor: 'var(--bg)' }}
                >
                  {t('cancel')}
                </button>
                <button
                  onClick={handleSaveItem}
                  disabled={saving || photoUploading || rawPhotoReference !== null}
                  className="flex-1 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                  style={{ backgroundColor: 'var(--primary)' }}
                >
                  {photoUploading || rawPhotoReference !== null ? '写真アップロード中...' : saving ? t('saving') : t('save')}
                </button>
              </div>
            </div>
          )}

          {/* Meal items */}
          {(getLog(activeCategory)?.items ?? []).length === 0 && !addingItem ? (
            <p className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>{t('noFood')}</p>
          ) : (
            <div className="space-y-2">
              {(getLog(activeCategory)?.items ?? []).length > 0 && (
                <p className="text-xs font-bold pt-1 pb-0.5" style={{ color: 'var(--text-muted)' }}>✓ 本日の記録</p>
              )}
              {(getLog(activeCategory)?.items ?? []).filter((item) => item.id !== editingItemId).map((item) => (
                <div key={item.id} className="flex justify-between items-start rounded-xl p-3" style={{ backgroundColor: 'var(--accent-light)', border: '1px solid var(--border)' }}>
                  <div>
                    <p className="font-bold text-sm" style={{ color: 'var(--text)' }}>{item.name}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      {[
                        item.servings != null ? `${item.servings}人前` : '',
                        item.amount ? `${item.amount}g` : '',
                        item.calorie ? `${item.calorie}kcal` : '',
                        item.protein ? `P:${item.protein}g` : '',
                        item.fat ? `F:${item.fat}g` : '',
                      ].filter(Boolean).join(' • ')}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    <button onClick={() => startEditItem(item)} className="text-sm px-1" style={{ color: 'var(--accent)' }}>✏️</button>
                    <button onClick={() => handleDeleteItem(activeCategory, item.id)} className="text-red-400 text-sm px-1">✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!activeCategory && (
        <div className="space-y-3">
          {MEAL_CATEGORIES.map((cat) => {
            const log = getLog(cat)
            const items = log?.items ?? []
            const catCalories = items.reduce((sum, i) => sum + (parseFloat(i.calorie) || 0), 0)
            return (
              <button
                key={cat}
                onClick={() => handleCategoryChange(cat)}
                className="w-full rounded-2xl p-4 shadow-sm text-left transition hover:opacity-90"
                style={{ backgroundColor: 'var(--card)', border: `1px solid ${items.length > 0 ? 'var(--primary)' : 'var(--border)'}` }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-black text-sm" style={{ color: 'var(--text)' }}>
                    {MEAL_CATEGORY_EMOJI[cat]} {t(cat.toLowerCase() as TranslationKey)}
                  </span>
                  {log?.did_not_eat ? (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: '#f3f4f6', color: '#6b7280' }}>食べなかった</span>
                  ) : items.length > 0 ? (
                    <span className="text-sm font-bold" style={{ color: 'var(--primary)' }}>{catCalories.toFixed(0)} kcal</span>
                  ) : (
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>未記録</span>
                  )}
                </div>
                {items.length > 0 ? (
                  <div className="space-y-1">
                    {items.map((item) => (
                      <div key={item.id} className="flex justify-between items-center rounded-lg px-3 py-1.5" style={{ backgroundColor: 'var(--accent-light)' }}>
                        <span className="text-sm font-bold" style={{ color: 'var(--text)' }}>{item.name}</span>
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {[
                            item.servings != null ? `${item.servings}人前` : '',
                            item.amount ? `${item.amount}g` : '',
                            item.calorie ? `${item.calorie}kcal` : '',
                          ].filter(Boolean).join(' • ')}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('noFood')}</p>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
