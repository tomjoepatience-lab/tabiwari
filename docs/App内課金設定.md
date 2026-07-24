# マネコ App内課金 設定手順

## 確定商品

| 種別 | 表示名 | Product ID | 価格 | RevenueCat entitlement |
| --- | --- | --- | --- | --- |
| 自動更新サブスクリプション | マネコプラス 月額 | `com.tomjo.maneko.plus.monthly` | 月額380円 | `maneko_plus` |
| 自動更新サブスクリプション | マネコプラス 年額 | `com.tomjo.maneko.plus.annual` | 年額2,980円 | `maneko_plus` |
| 非消費型（買い切り） | 目標アイコンパック | `com.tomjo.maneko.goalicons.cute` | 160円 | `goal_icon_pack` |
| 非消費型（買い切り） | 季節の衣装パック | `com.tomjo.maneko.costumes.seasons` | 320円 | `season_costume_pack` |

Product ID と entitlement ID は、上記の文字列をそのまま使う。

## 1. App Store Connect

1. 「ビジネス」画面で有料App契約、税務情報、銀行口座が有効になっていることを確認する。
2. 対象アプリ `com.tomjo.maneko` を開き、「収益化」→「サブスクリプション」を開く。
3. サブスクリプショングループ `マネコプラス` を1つ作る。
4. 同じグループ内に月額・年額の2商品を作り、上表のProduct IDと価格を設定する。
5. 「収益化」→「App内課金」で、アイコンパックと衣装パックを「非消費型」として作る。
6. 4商品すべてに、日本語の表示名・説明・審査用スクリーンショットを登録する。
7. 初回のApp内課金は、提出するアプリバージョンの「App内課金とサブスクリプション」欄にも追加する。

商品説明案:

- マネコプラス: `レシート読み取りをたくさん使える、マネコ家計簿の便利なプランです。`
- 目標アイコンパック: `目標貯金に使える、かわいい3Dアイコン10種類のセットです。`
- 季節の衣装パック: `マネコを春夏秋冬の衣装に着せ替えられる、全8種類のセットです。`

## 2. RevenueCat

1. RevenueCatでプロジェクトを作成し、iOSアプリを追加する。
2. Bundle IDに `com.tomjo.maneko` を指定し、App Store Connect連携を完了する。
3. App Store Connectから上表の4商品を取り込む。
4. Entitlementsを3つ作る。
   - `maneko_plus`
   - `goal_icon_pack`
   - `season_costume_pack`
5. 各商品を対応するEntitlementへ関連付ける。月額と年額は両方とも `maneko_plus` に関連付ける。
6. Offering `default` を作り、Current Offeringにする。
7. 月額をMonthly package、年額をAnnual package、買い切り2種をCustom packageとして追加する。

## 3. 環境変数

RevenueCatの公開iOS SDKキー（通常 `appl_` で始まる）をExpo/EASに設定する。

```text
EXPO_PUBLIC_REVENUECAT_IOS_API_KEY=appl_xxxxx
```

RevenueCatのSecret API KeyはVercelだけに設定する。公開環境やExpoへ入れない。

```text
REVENUECAT_SECRET_API_KEY=sk_xxxxx
```

VercelではProduction環境へ設定したあと、再デプロイする。

## 4. DB更新

本番の `DATABASE_URL` を使用できる環境で、既存データを保持したまま冪等なスキーマ更新を実行する。

```powershell
npm run db:setup
```

追加される主な列は `premium_until`、`iap_goal_icons`、`iap_season_costumes`、`iap_synced_at`、`season_costume`。

## 5. ビルドとテスト

`react-native-purchases` はネイティブモジュールなのでExpo Goでは購入テストできない。環境変数と商品設定をすべて終えてから、EASビルドを1回だけ作る。

```powershell
cd expo
eas build --platform ios --profile production
```

Sandbox/TestFlightで次を確認する。

- 月額購入後にマネコプラスが有効になる
- 年額購入後にマネコプラスが有効になる
- 目標アイコン購入後に鍵が外れ、10種類を選べる
- 衣装購入後に鍵が外れ、8種類を着せ替えられる
- アプリ再インストール後、「購入を復元」で権利が戻る
- 別のマネコアカウントへ切り替えたとき、購入情報が誤って混ざらない
- 解約後も有効期限までは使え、期限後にマネコプラスだけ無効になる
- 買い切り2商品は期限切れにならない

## 実装上の扱い

- App Storeの購入処理はiOS側で実行する。
- Web画面は購入後、サーバーへ同期を依頼する。
- サーバーがRevenueCat APIへ問い合わせ、検証できたEntitlementだけをDBへ反映する。
- 買い切りアイテムの解放状態をクライアントから直接書き換えるAPIは設けない。
- RevenueCatのユーザーIDはマネコの内部ユーザーIDから `maneko-user-{id}` の形式で作る。メールアドレスは使わない。
