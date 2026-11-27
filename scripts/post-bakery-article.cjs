const https = require('https')

const SUPABASE_URL = 'https://ctgysnujraekjtuqocgc.supabase.co'
// Supabase管理接続にはSecret Keyのみを使用する。値はsource controlへ保存しない。
const SUPABASE_ADMIN_KEY = (process.env.SUPABASE_SECRET_KEY || '').trim()
if (!SUPABASE_ADMIN_KEY) {
  console.error('SUPABASE_SECRET_KEY is required.')
  process.exit(1)
}

// Supabase管理接続はapikeyヘッダーのみを使用する
function supabaseAuthHeaders(key) {
  return { apikey: key }
}

const content = `<h2>ダイエット中のスイーツ問題、どうしていますか？</h2>
<p>「ダイエット中だからスイーツは我慢…」そんな日々を送っていませんか？甘いものが食べたい衝動を抑え続けることは、長期的なダイエット継続を妨げる大きな壁のひとつです。実は、スイーツを「禁止」するより、<strong>ヘルシーな自家製スイーツに切り替える</strong>ほうがダイエット成功率は高いと言われています。市販のスイーツには砂糖・バター・添加物が多く含まれていますが、自分で作れば材料を選んでカロリーを大幅に抑えることができます。</p>

<h2>自家製スイーツがダイエットに有利な理由</h2>
<ul>
<li><strong>材料を自分でコントロールできる：</strong>砂糖の量を減らしたり、低カロリー甘味料に変えたりできます。市販品では難しいカロリーカットが自在に行えます。</li>
<li><strong>添加物・保存料フリー：</strong>市販品のような余計な成分が入らず、体に優しい仕上がりになります。</li>
<li><strong>グルテンフリーにも対応：</strong>米粉や大豆粉を使えば、糖質制限中の方にも安心です。</li>
<li><strong>タンパク質を増やせる：</strong>プロテインパウダーをレシピに加えることで、筋肉づくりをサポートするスイーツに変えられます。</li>
<li><strong>コスパが良い：</strong>市販のスイーツより大幅にコストを下げられます。</li>
</ul>

<h2>foodable公式レシピで作る｜ベーグル＋自家製りんごジャム</h2>
<p>foodable公式サイトでは、コンパクトベーカリーを使ったレシピが豊富に公開されています。参考にしながら自分好みにアレンジするのもおすすめです。<br>▶ <a href="https://foodable.jpn.panasonic.com/recipes/bakery" target="_blank" rel="nofollow">foodable 公式レシピ一覧</a></p>

<h3>ベーグル＋自家製りんごジャム</h3>
<p>ダイエット中にぴったりな組み合わせが、もちもち食感の<strong>ベーグル</strong>に<strong>自家製りんごジャム</strong>を添えるスタイルです。</p>
<p><strong>ベーグルの材料（8個分）：</strong>強力粉280g・砂糖25.5g・塩5g・水180g・油8g・ドライイースト2.8g。ホームベーカリーで生地を作り、成形→ゆで→焼きで完成します。1個あたり約150〜170kcalと低カロリーで、腹持ちも良いダイエット向けのパンです。<br>▶ <a href="https://foodable.jpn.panasonic.com/recipes/group-detail/1007" target="_blank" rel="nofollow">ベーグルレシピを見る</a></p>
<p><strong>りんごジャムの材料：</strong>りんご400g・砂糖140g・レモン汁（大さじ2と1/2）。ベーカリーの「ジャム」メニューにセットして約100分で完成します。砂糖とレモン汁という身近な調味料だけで、無添加の自家製ジャムが出来上がります。甘さを控えめにアレンジすれば、ダイエット中も安心して楽しめます。<br>▶ <a href="https://foodable.jpn.panasonic.com/recipes/group-detail/1189" target="_blank" rel="nofollow">りんごジャムレシピを見る</a></p>

<h3>その他のおすすめレシピ</h3>
<p>プロテインパウダーと米粉を使ったマフィン（1個あたり約100〜120kcal・タンパク質10g以上）や、クリームチーズとギリシャヨーグルトを混ぜ込んだ低糖質チーズケーキ風ブレッドなど、アレンジは無限大です。</p>

<h2>foodable コンパクトベーカリーの特徴と定期便サービス</h2>
<p>「大きな家電は置けない」という方でも安心な、パナソニックのフードサービス「<strong>foodable（フーダブル）</strong>」が提供する<strong>コンパクトベーカリー</strong>。幅18.8cm×奥行28.5cm×高さ24.3cmの<strong>業界最小クラスのサイズ</strong>（※）で、キッチンに常設しやすい設計です。少人数世帯で食べ切るのにちょうどいい<strong>約0.6斤サイズ</strong>なので、毎回焼きたてのおいしさを楽しめます。</p>
<ul>
<li><strong>独自のねり・発酵・焼成プログラム：</strong>材料を入れるだけで、気温によらず年中ふっくら焼き上がります。</li>
<li><strong>20メニュー・30種類搭載：</strong>食パン・高加水パン・米粉パン・ピザ生地・ジャムメニューなど多彩に対応しています。</li>
<li><strong>タイマー予約機能：</strong>寝る前にセットしておけば、朝起きたら焼きたてパンが完成します。</li>
<li><strong>米粉パンにも対応：</strong>グルテンフリー食を実践している方にも安心して使えます。</li>
</ul>
<p>※国内ホームベーカリー市場において、幅×奥行×高さのサイズ（2024年7月3日時点、当社調べ）</p>

<h3>定期便サービスの内容</h3>
<p><strong>初回は新品のコンパクトベーカリー本体とパンミックス3回分の材料がセットで届きます。</strong>その後は<strong>月額1,980円（税込・送料込）</strong>でパンミックスが届くため、計量不要で気軽に焼けます。パンミックスは毎月様々な種類から選べ、季節限定の<strong>いちごぱん・さくらパン・ココアパン・ショコラパン・ブリオッシュ</strong>なども楽しめます。定番の生食パンや、市販では割高になりがちな<strong>グルテンフリーの米粉パン</strong>も人気です。</p>
<p style="text-align:center;margin:2em 0;">
  <a href="https://foodable.jpn.panasonic.com/course/bakery/cb1_sw" target="_blank" rel="nofollow sponsored" style="display:inline-block;padding:0.8em 2em;background:#e8600a;color:#fff;border-radius:8px;font-weight:bold;text-decoration:none;">▶ foodable コンパクトベーカリー＋パンミックスコースの詳細はこちら</a>
</p>

<h2>グルテンフリー・米粉パンのダイエット効果</h2>
<p>最近注目されている<strong>グルテンフリー食</strong>。小麦のグルテンを避けることで、腸内環境の改善や消化機能の向上が期待できると言われています。米粉は小麦粉と比べてGI値がやや低く、血糖値の急上昇を抑えやすい特徴があります。ダイエット中の糖質コントロールにも取り入れやすい食材です。もちもちとした食感で少量でも満足感が高く、食べ過ぎを防ぐ効果も期待できます。</p>

<h2>継続するためのコツ｜毎日の習慣にする方法</h2>
<p>自家製スイーツを作り続けるためには、「手軽に始められること」が最も重要です。foodableのパンミックスは計量済みで届くため、思い立ったときにすぐ作れます。週末にまとめて焼いておき、平日の間食として小分けにする方法もおすすめです。冷凍保存すれば1週間分をストックしておけるため、忙しい平日でも手軽にヘルシーなスイーツを楽しめます。</p>

<h2>食事管理アプリと組み合わせて賢くスイーツを楽しむ</h2>
<p>自家製スイーツを取り入れるなら、カロリーとPFCバランスを把握することが大切です。FitMateのような食事管理アプリを使って自家製スイーツのカロリーを記録することで、1日の栄養バランスを崩さずに甘いものを楽しめます。「間食として100〜150kcal以内に収める」「タンパク質を10g以上含むレシピを選ぶ」など、自分のダイエット目標に合わせたルールを設けることで、スイーツを罪悪感なく楽しむことができます。</p>

<h2>まとめ｜スイーツを我慢しないダイエット法</h2>
<p>ダイエット中にスイーツを完全に断つ必要はありません。<strong>自家製スイーツに切り替えること</strong>で、罪悪感ゼロで甘いものを楽しみながら、カロリー・糖質をコントロールできます。foodable コンパクトベーカリーなら、業界最小クラスのコンパクトサイズで手軽に自家製パン・スイーツが作れます。初回は新品ベーカリー本体とパンミックス3回分がセットで届き、その後は月額1,980円（税込・送料込）でお好みのパンミックスが届く仕組みです。甘いものを楽しみながら、賢くダイエットを成功させましょう。</p>
<p style="text-align:center;margin:2em 0;">
  <a href="https://foodable.jpn.panasonic.com/course/bakery/cb1_sw" target="_blank" rel="nofollow sponsored" style="display:inline-block;padding:0.8em 2em;background:#e8600a;color:#fff;border-radius:8px;font-weight:bold;text-decoration:none;">▶ コンパクトベーカリー＋パンミックスコースを詳しく見る</a>
</p>`

const post = {
  slug: 'compact-bakery-diet-sweets-homemade',
  title: '【PR】ダイエット中でも罪悪感ゼロ！スイーツ作りにも活用できるコンパクトベーカリー',
  description: 'ダイエット中のスイーツ我慢はもう不要。自家製スイーツに切り替えることで罪悪感ゼロで甘いものを楽しめます。業界最小クラスのfoodableコンパクトベーカリー＋パンミックス定期便で健康的な自家製スイーツを手軽に実現する方法を紹介します。',
  category: 'ダイエット',
  published_at: '2026-07-09',
  reading_minutes: 7,
  content,
  og_image: null,
  is_published: true,
}

const body = JSON.stringify([post])
const url = new URL(`${SUPABASE_URL}/rest/v1/blogs`)

const opts = {
  hostname: url.hostname,
  path: url.pathname,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...supabaseAuthHeaders(SUPABASE_ADMIN_KEY),
    'Prefer': 'return=representation',
    'Content-Length': Buffer.byteLength(body),
  },
}

const req = https.request(opts, res => {
  let data = ''
  res.on('data', d => data += d)
  res.on('end', () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const result = JSON.parse(data)
      console.log('✅ 投稿成功:', result[0]?.slug)
      console.log('タイトル:', result[0]?.title)
    } else {
      console.error('❌ エラー', res.statusCode, data)
    }
  })
})
req.on('error', err => console.error(err))
req.write(body)
req.end()
