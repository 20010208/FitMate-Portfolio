export type TrainingSet = {
  weight: string
  reps: string
  memo: string
}

export type Training = {
  id: string
  user_id: string
  date_id: string
  category: string
  exercise: string
  sets: TrainingSet[]
  memo?: string
  created_at: string
}

export type WeightRecord = {
  id: string
  user_id: string
  date_id: string
  weight: string
  body_fat: string
  created_at: string
}

export type FoodItem = {
  id: string
  name: string
  brand: string
  category?: string
  amount: string
  calorie: string
  protein: string
  fat: string
  carbohydrate: string
  reading?: string | null
}

export type MealItem = {
  id: string
  name: string
  amount: string
  calorie: string
  protein: string
  fat: string
  carbohydrate: string
  sugar: string
  dietary_fiber: string
  salt: string
  sodium: string
  potassium: string
  calcium: string
  magnesium: string
  servings?: number
  // meal-photos参照。legacy値はgetPublicUrl()由来の完全な公開URLの場合があり、
  // 新規保存値はbucket内object path。表示用signed URLはここへ保存しない
  // （src/lib/storage/mealPhoto.ts の normalizeMealPhotoPath / getMealPhotoSignedUrl 参照）
  photo_url?: string | null
}

export type MealLog = {
  id: string
  user_id: string
  date_id: string
  category: 'Breakfast' | 'Lunch' | 'Dinner' | 'Snacking'
  items: MealItem[]
  did_not_eat: boolean
  photo_url?: string | null
  created_at: string
}

export type Profile = {
  id: string
  user_id: string
  name: string
  birthday: string | null
  height: string
  goal_weight: string
  nickname: string | null
  gender: 'male' | 'female' | null
  target_days: number | null
  target_date: string | null
  created_at: string
  character: 'leo' | 'saya' | 'mina' | null
  fitness_goal: 'lose_weight' | 'maintain' | 'gain_muscle' | null
}

export type TrainingCategory = {
  id: string
  name: string
  jaName: string
  image: string
  exercises: string[]
  jaExercises: string[]
}

export const TRAINING_CATEGORIES: TrainingCategory[] = [
  {
    id: 'chest',
    name: 'Chest',
    jaName: '胸',
    image: '/images/chest.png',
    exercises: ['Bench Press', 'Incline Press', 'Decline Press', 'Chest Fly', 'Push Up', 'Cable Crossover'],
    jaExercises: ['ベンチプレス', 'インクラインプレス', 'デクラインプレス', 'チェストフライ', '腕立て伏せ', 'ケーブルクロスオーバー'],
  },
  {
    id: 'back',
    name: 'Back',
    jaName: '背中',
    image: '/images/back.png',
    exercises: ['Pull Up', 'Lat Pulldown', 'Barbell Row', 'Dumbbell Row', 'Seated Row', 'Deadlift'],
    jaExercises: ['懸垂', 'ラットプルダウン', 'バーベルロウ', 'ダンベルロウ', 'シーテッドロウ', 'デッドリフト'],
  },
  {
    id: 'arm',
    name: 'Arms',
    jaName: '腕',
    image: '/images/arms.png',
    exercises: ['Bicep Curl', 'Hammer Curl', 'Tricep Pushdown', 'Skull Crusher', 'Chin Up', 'Dips'],
    jaExercises: ['バイセップカール', 'ハンマーカール', 'トライセップスプッシュダウン', 'スカルクラッシャー', 'チンアップ', 'ディップス'],
  },
  {
    id: 'shoulder',
    name: 'Shoulder',
    jaName: '肩',
    image: '/images/shoulder.png',
    exercises: ['Shoulder Press', 'Lateral Raise', 'Front Raise', 'Rear Delt Fly', 'Shrug', 'Arnold Press'],
    jaExercises: ['ショルダープレス', 'サイドレイズ', 'フロントレイズ', 'リアデルトフライ', 'シュラッグ', 'アーノルドプレス'],
  },
  {
    id: 'leg',
    name: 'Legs',
    jaName: '脚',
    image: '/images/legs.png',
    exercises: ['Squat', 'Leg Press', 'Lunges', 'Leg Curl', 'Leg Extension', 'Calf Raise', 'Romanian Deadlift'],
    jaExercises: ['スクワット', 'レッグプレス', 'ランジ', 'レッグカール', 'レッグエクステンション', 'カーフレイズ', 'ルーマニアンデッドリフト'],
  },
  {
    id: 'ab',
    name: 'Abs',
    jaName: '腹筋',
    image: '/images/abs.png',
    exercises: ['Crunch', 'Plank', 'Leg Raise', 'Russian Twist', 'Ab Wheel', 'Hanging Leg Raise'],
    jaExercises: ['クランチ', 'プランク', 'レッグレイズ', 'ロシアンツイスト', 'アブホイール', 'ハンギングレッグレイズ'],
  },
  {
    id: 'cardio',
    name: 'Cardio',
    jaName: '有酸素',
    image: '/images/cardio.png',
    exercises: ['Running', 'Cycling', 'Swimming', 'Jump Rope', 'HIIT', 'Dance'],
    jaExercises: ['ランニング', 'サイクリング', '水泳', '縄跳び', 'HIIT', 'ダンス'],
  },
]

export const MEAL_CATEGORIES = ['Breakfast', 'Lunch', 'Dinner', 'Snacking'] as const
export type MealCategory = typeof MEAL_CATEGORIES[number]
