# App Store 提出チェックリスト

## EAS / Vercel

- EAS `GOOGLE_MAPS_IOS_API_KEY`（production / preview）
- EAS `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`（production / preview）
- Vercel `PUBLIC_APP_URL=https://tabiwari-mu.vercel.app`
- Vercel `APPLE_TEAM_ID=9LJ766PUX5`
- Vercel `RESEND_API_KEY`
- Vercel `AUTH_EMAIL_FROM`（Resendで認証済みの送信元）
- Vercel `SUPPORT_EMAIL`（問い合わせ通知先）
- Vercel `REVENUECAT_SECRET_API_KEY`（RevenueCat Secret API Key。Expoへは入れない）

メール環境変数を追加したらVercelを再デプロイし、実在するアドレスで以下を確認する。

1. 新規登録後に確認メールが届く
2. `/auth-action?action=verify&token=...` で確認が完了する
3. 「パスワードを忘れた」から再設定メールが届く
4. サポートフォームを送信し、DB保存と通知メールを確認する

## App Store Connect URL

- Privacy Policy URL: `https://tabiwari-mu.vercel.app/privacy.html`
- Support URL: `https://tabiwari-mu.vercel.app/support.html`
- User Privacy Choices URL: `https://tabiwari-mu.vercel.app/privacy.html`

## App Privacy（実装に合わせた回答候補）

すべて「トラッキングには使用しない」。アカウントや共有スペースに紐づくため、基本的に「ユーザーに関連付けられる」として申告する。

- Contact Info: Email Address（App Functionality）
- User Content: Photos or Videos / Other User Content（App Functionality）
- Financial Info: Other Financial Info（App Functionality）
- Location: Precise Location（App Functionality、任意許可）
- Identifiers: User ID（App Functionality）
- Usage Data: Product Interaction（App Functionality / Product Personalization。ゲーム進行・設定を含む）

決済カードや銀行口座の情報、広告データは取得しない。App Privacyの回答は、Appleが定義するデータ型と第三者SDKの実際の挙動を提出直前に再確認する。

## 審査前の実機確認

- 新規登録、ログイン、ログアウト、パスワード再設定、アカウント削除
- 共有スペース作成、招待URL、参加、スペース切り替え
- 支出追加時のスペース選択、レポートのスペース切り替え
- 2人以上の共有家計簿で「支払った人」が正しく表示される
- レポート上部で複数スペースを同時選択できる
- カレンダーの収入 `+`・支出 `-` と日付色が正しい
- レシートOCR、店舗住所の検出表示、Google Maps表示
- 写真・位置情報を拒否した場合の継続利用
- 親子連携、お小遣い、お手伝い
- マネコプラス月額・年額、目標アイコン、季節衣装のSandbox購入と復元
- 月額から年額、年額から月額へのプラン変更
- 購入後の機能解放、再起動後の維持、解約・返金後の権限反映
- iPhone小画面・Dynamic Type・オフライン / 通信失敗時の表示

最終プレビューで確認が完了するまでproduction EAS buildは回さない。

## 2026-07-24 リリース準備状況

- [x] Vercel 本番デプロイ（認証メール・パスワード再設定を含む）
- [x] Expo production環境にGoogle Maps iOS APIキーを設定
- [x] App Icon 1024×1024・アルファなし
- [x] iPad対応を有効化（`ios.supportsTablet: true`）
- [x] カメラ・写真・位置情報の利用目的文言
- [x] 非免除暗号化なし（`ITSAppUsesNonExemptEncryption: false`）
- [x] `expo-doctor` 18/18、依存関係チェック正常
- [x] 6.5インチスクリーンショット 6枚（1242×2688）
- [x] 13インチスクリーンショット 6枚（2064×2752）
- [x] production EAS build完了（1.0.0 / build 4 / `4c81db25-66bf-4fe5-b1cd-f61314b1317f`）
- [ ] App Store ConnectとRevenueCatに4商品を作成（`docs/App内課金設定.md`）
- [ ] RevenueCatのEAS/Vercel環境変数を設定
- [ ] IAP対応を含む新しいproduction EAS buildを1回作成
- [ ] TestFlight実機で最終確認
- [ ] App Store Connectメタデータ・App Privacy入力
- [ ] 審査へ提出

提出素材:

- `app-store/README.md`
- `app-store/screenshots/iphone-6.5/`
- `app-store/screenshots/ipad-13/`

productionビルド完了後:

```powershell
cd expo
npx eas submit --platform ios --latest
```
