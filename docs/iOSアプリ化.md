# iOSアプリ化

マネコ家計簿を iOS ネイティブアプリ（App Store 配布想定）として提供するための計画・実装メモ。

## 全体計画（fable策定・2026-07-15 ユーザー承認）
- 方式: **Capacitor ラッパー**（既存 Web アプリを WKWebView で包む・全機能温存）
- ビルド: **GitHub Actions の macOS ランナー**（Windows のみのため）。実機/App Store 配布は Apple Developer Program（年99ドル）加入後
- **2026-07-18 更新**: 正式な配布経路は下記の **Expo シェル**（`expo/`）に一本化。ユーザーが tabikake で
  使い慣れた「Windowsターミナルから `eas build`/`eas submit`（Apple ID 対話ログイン）」フローに合わせたもの。
  Capacitor ＋ GitHub Actions（M1・TestFlight配布）は**予備**として温存する（下記セクションはそのまま残置）。
- マネタイズ: **フリーミアムサブスク＋広告**（プレミアム=OCR無制限・全期間レポート・家族枠拡張・広告なし。こども画面には広告を出さない。具体の価格/線引きはユーザー承認後に M3 で実装）
- マイルストーン:
  - **M1**: Capacitor シェル＋Actions シミュレータビルド（下記・実装済み）
  - **M2**: 利用タイプ（家族/個人）初回選択＋タイプ別チュートリアル＋せっていで切替／こども簡素化（プレゼント・コイン・ごきげん撤去）／OCR の Claude フォールバック復活（Gemini 429/障害時のみ）
  - **M3**: マネタイズ（user_settings.premium・ペイウォール・StoreKit IAP・AdMob）※Apple Developer / AdMob アカウント取得後に実配線
- 注意: push は Render 自動デプロイを兼ねる。M2 のプロダクト変更は「デプロイして」指示までローカル保持。審査（ガイドライン4.2）対策で、提出前に**ローカルバンドル＋トークン認証への移行**を検討

## Expo シェル（正式な配布経路・2026-07-18 実装）

### 位置づけ
- **これが正式な配布経路**。ユーザーが tabikake（[[tabikake]]）で実績のある Expo + EAS のフロー
  （Windows ターミナルから `eas build` / `eas submit`、初回のみ Apple ID 対話ログイン）に統一した。
- 上記の **Capacitor ＋ GitHub Actions（M1・TestFlight配布）は予備**として残す。Expo 側で詰まった場合の
  フォールバックとして温存し、削除しない。
- サーバー・DB・API・認証（cookieセッション）は一切変更しない。iOS 側は Capacitor 版と同じく
  「アプリの殻」で、`https://tabiwari-dacx.onrender.com` を WebView で表示するだけ。

### 構成（`expo/` ディレクトリ・kakeibo リポジトリと自己完結で共存）
- `expo/package.json`: アプリ名 `maneko-ios`。Expo SDK 57（最新安定版）＋ `react-native-webview`。
- `expo/app.json`:
  - `name`「マネコ家計簿」・`slug` `maneko-kakeibo`・`version` `1.0.0`
  - `ios.bundleIdentifier` **`com.tomjo.maneko`**（Capacitor版と同じバンドルID）。`buildNumber` は
    app.json には書かず、`eas.json` の `autoIncrement` で EAS が自動採番する
  - アイコン: `public/icons/icon-512.png`（512×512）を `expo/assets/icon.png` にコピーして使用。
    **暫定**（下記 DECISION NEEDED 参照。1024×1024 推奨）
  - スプラッシュ: `expo-splash-screen` プラグイン設定で背景色 `#E8B62B`（マネコの黄色）＋アイコン画像
  - `infoPlist`: `NSCameraUsageDescription`「レシートを読み取るために使用します」・
    `NSPhotoLibraryUsageDescription`「レシート画像や思い出写真を選ぶために使用します」
  - `userInterfaceStyle` は `light` 固定
- `expo/App.tsx`: 全画面 `WebView`（`react-native-webview`）
  - `source.uri` は `https://tabiwari-dacx.onrender.com`
  - セーフエリア: Web側（PWA）が既に `env(safe-area-inset-*)` でセーフエリアを扱っているため、
    ネイティブ側で二重に余白を足さないよう `contentInsetAdjustmentBehavior="never"`
    （実は既定値だが明示）。`SafeAreaView` では包まず、WebView自体を画面全体に敷いている
  - `allowsBackForwardNavigationGestures`（横スワイプで戻る/進む）・`sharedCookiesEnabled`
    （cookieセッションを維持）を有効化
  - `<input type="file">`（レシート撮影・思い出写真選択）は iOS の WKWebView 標準機能で動作する想定
    （react-native-webview 側の追加設定は不要。iOS側は Info.plist の権限文言のみで足りる）
  - オフライン/読み込み失敗時: `onError`・`onHttpError`（5xxのみ）でシンプルな日本語エラービュー
    （🙀「読み込めませんでした」＋再読み込みボタン）に切り替え
  - 外部リンク（別オリジン）: `onShouldStartLoadWithRequest` で `isTopFrame` かつ別ホストのときだけ
    `Linking.openURL` で外部ブラウザへ逃がし、WebView内の遷移は `false` を返して止める。地図タイル等の
    サブリソース取得はメインフレーム遷移ではない（`isTopFrame !== true` または navigation 自体を伴わない）
    ため対象外
- `expo/eas.json`: `production`（`ios.autoIncrement: true` でビルド番号を自動増分）・
  `preview`（`distribution: "internal"`、社内配布用）の2プロファイル
- `expo/.gitignore`: `create-expo-app` 標準生成のもの（`node_modules/`・`.expo/`・生成される
  `/ios` `/android`・`*.p8` `*.mobileprovision` 等の署名関連ファイルも除外済み）

### 検証（Windows でできる範囲・実施済み）
- `cd expo && npm install` … 成功
- `npx tsc --noEmit` … 型エラーなし（RN 0.86 で `StyleSheet.absoluteFillObject` が無くなっており
  `StyleSheet.absoluteFill` に置き換えた点のみ注意）
- `npx expo-doctor` … **20/20 checks passed**
- `npx expo export --platform ios` … 成功（`dist/` にJSバンドル出力、iOS実機/EASビルドはこの時点では未実施）
- リポジトリの既存部分（`src/` `public/` `ios/` `capacitor.config.ts` `.github/`）に差分なし
  （`git status` で確認。今回の変更は `expo/` 新設と本ドキュメントのみ）

### ユーザーが実行する手順（コピペ可能）
初回のみ Apple ID の対話ログインが必要なため、下記はユーザーの手元（Windowsターミナル）で実行する。

```
cd expo
npm install
npx eas login
# 初回は Apple ID ログイン・証明書/プロビジョニング/バンドルID登録/アプリレコード作成を
# EAS が対話的に自動処理する（tabikake と同じ流れ）
npx eas build --platform ios --profile production
npx eas submit --platform ios --latest
```

その後 App Store Connect で以下を行う:
1. アプリ情報・スクリーンショット・説明文・キーワード・App Privacy 等のメタデータ入力
2. 審査へ提出

### EAS 無料枠の注意
- 無料プランは **月あたりのビルド回数に上限**がある（tabikake開発時の教訓＝[[mistakes]]参照:
  暫定ビルド→本番ビルドの二度手間で無駄が出た）。ネイティブ設定（app.json/権限/アイコン等）を
  固めてから1回でビルドする。
- 混雑時間帯は無料枠のビルドキューが**混雑して待ち時間が発生**することがある。

### DECISION NEEDED
- **AppIcon の画質**: `public/icons/icon-512.png`（512×512）を暫定でそのまま使用。App Store 提出前には
  1024×1024 で新規に描き起こした画像への差し替えを推奨（Capacitor版と同じ注意点）。
- **Capacitor版との重複**: 両方を並行温存する方針だが、Expo版が安定して配布できると分かった段階で
  Capacitor＋GitHub Actions側（M1・TestFlight）を削除するかは未決定（現時点ではユーザー指示により両方残置）。

## M1: Capacitor シェル ＋ シミュレータビルド（実装済み・予備の配布経路）

### 方針
- v1 は **リモートURL方式**。ネイティブの WKWebView から Render 上の既存Webアプリ
  （`https://tabiwari-dacx.onrender.com`）をそのまま読み込む。
- サーバー・DB・API・認証（cookieセッション）は一切変更しない。iOS 側は「アプリの皮」のみ。
- 将来的にオフライン対応やネイティブ機能（プッシュ通知等）が必要になったら、
  ローカルバンドル方式（webDir にビルド済みWebアプリを同梱）への切り替えを検討する（M2以降・未着手）。

### 構成
- `capacitor.config.ts`: `appId=com.tomjo.maneko` / `appName=マネコ家計簿` / `webDir=www` /
  `server.url=https://tabiwari-dacx.onrender.com`
- `www/index.html`: Capacitor が webDir を要求するためのプレースホルダ（server.url 使用時は通常表示されない）
- `ios/`: `npx cap add ios` で生成した Xcode プロジェクト一式（コミット対象。`Pods/`・`build/`・`DerivedData/` 等の生成物は `.gitignore` 済み）
- `ios/App/App/Info.plist`: `NSCameraUsageDescription`（レシート撮影用）・`NSPhotoLibraryUsageDescription`
  （思い出写真・レシート選択用）を日本語で追加。位置情報の権限は追加していない（未使用のため）。
- `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`: `public/icons/icon-512.png`
  （512×512）を 1024×1024 にリサイズして配置。**暫定対応**（後述 DECISION NEEDED 参照）。

### ビルド手順（Windows / Xcode なしでの開発フロー）

このリポジトリは Windows 上で開発しており、ローカルに Xcode・CocoaPods が無い前提。
シミュレータ向けビルドは GitHub Actions（`.github/workflows/ios-build.yml`）で行う。

1. GitHub の Actions タブ → `iOS Simulator Build` ワークフローを開く
2. `Run workflow`（workflow_dispatch）を手動実行する（push では自動実行されない）
3. 実行完了後、Artifacts から `maneko-ios-simulator`（`App.zip`）をダウンロードする
4. zip を展開して `App.app` を取り出す
5. Mac 上で Xcode の Simulator を起動し、`App.app` を Simulator のウィンドウへドラッグ＆ドロップするとインストールされる
6. Simulator のホーム画面から「マネコ家計簿」アイコンをタップして起動する

実機（実際のiPhone）へのインストールや App Store 配布には別途 Apple Developer Program の
署名・プロビジョニングが必要（M1 の範囲外・未着手）。

### DECISION NEEDED
- **AppIcon の画質**: `public/icons/icon-512.png`（512×512）を単純に 1024×1024 へリサイズしたものを
  暫定配置した。App Store 提出前には 1024×1024 で新規に描き起こした画像に差し替えることを推奨する。
- **`server.url` の向き先**: 現状 Render の本番URL（`tabiwari-dacx.onrender.com`）固定。
  開発中に別環境（ローカル・ステージング）に向けたい場合の切り替え方法（環境変数・configスキーム分割など）は未検討。
- **CocoaPods 検証**: Windows環境のため `pod install` はローカルで未検証。CI（macos-latest）で
  初回グリーンになるかは実行してみるまで確定しない（Podfile 生成自体は `cap add ios` 時点で作成済み）。
- **パッケージマネージャの選択（重要）**: Capacitor 8.x は `npx cap add ios` を素で実行すると
  既定で **Swift Package Manager（SPM）** を使う構成を生成する（`Podfile` も `App.xcworkspace` も
  生成されず、代わりに `ios/App/CapApp-SPM` というローカル Swift パッケージが `App.xcodeproj` に
  直接リンクされる）。fable の指定した CI 手順（`pod install` → `xcodebuild -workspace
  App.xcworkspace`）は CocoaPods 前提だったため、本実装では
  `npx cap add ios --packagemanager CocoaPods` を明示指定して生成し直し、`ios/App/Podfile` と
  `ios/App/App.xcworkspace` が存在する状態にした（＝仕様の CI ステップがそのまま通る構成）。
  SPM 方式の方が今後の Capacitor のデフォルト路線に近い可能性があるため、将来 CocoaPods 特有の
  トラブル（ビルド時間・Xcode 16以降の非推奨化など）が出た場合は SPM 方式への切り替えを検討してよい
  （その場合は CI ワークフローの `pod install` 削除と `-workspace` → `-project App.xcodeproj` への変更が必要）。

## TestFlight 配布（`.github/workflows/ios-testflight.yml`）

M1 のシミュレータビルドとは別に、実機（実際のiPhone）へ TestFlight 経由でインストールできる
署名付きビルドを作り、App Store Connect へ自動アップロードするワークフローを追加した。
`ios-build.yml`（シミュレータ用）とは concurrency グループが別のため互いに干渉しない。

### 必要な GitHub Secrets（4つ・fable が事前に登録）
- `ASC_KEY_ID` … App Store Connect API キーの Key ID
- `ASC_ISSUER_ID` … App Store Connect API の Issuer ID
- `ASC_KEY_P8_BASE64` … ダウンロードした `.p8` 秘密鍵ファイルを base64 化した文字列
- `APPLE_TEAM_ID` … Apple Developer Program のチームID

### ユーザーが事前に App Store Connect でやること
1. **API キー作成**: App Store Connect → Users and Access → Integrations（Keys）で新規キーを作成し、
   `.p8` ファイルをダウンロード（ダウンロードできるのは作成直後の一度きりなので保管に注意）。
   ロールは App Manager 以上を推奨（Developer 未満だとバンドルIDの自動登録やアップロードで
   権限エラーになることがある）。
2. **アプリレコード作成**: App Store Connect → マイApp → 新規Appで、
   名前「マネコ家計簿」・バンドルID `com.tomjo.maneko`・プラットフォーム iOS のアプリレコードを
   先に作っておく（これが無いと TestFlight アップロード時に「アプリレコードが見つからない」旨の
   エラーで失敗する）。

### 実行手順
1. GitHub の Actions タブ → `iOS TestFlight Deploy` ワークフローを開き、`Run workflow` で手動実行
   （workflow_dispatch のみ・push では自動実行されない）
2. ワークフローが成功すると、署名済みビルドが App Store Connect にアップロードされる
   （失敗しても `maneko-ios-ipa` artifact から署名済み .ipa 自体は回収できる）
3. **アップロード後、App Store Connect 側の処理（ビルドの解析・TestFlight への反映）に
   5〜30分ほど待ち時間が発生する**。処理が終わるまで TestFlight 側にビルドが表示されない
4. 処理完了後、TestFlight アプリ（またはメール招待）から「内部テスター」としてビルドを選び、
   iPhone に TestFlight アプリ経由でインストールする

ビルド番号（`CURRENT_PROJECT_VERSION`）は Actions の実行回数（`github.run_number`）を使って
毎回自動的に増える。バージョン番号（`MARKETING_VERSION`）は 1.0.0 固定（xcodebuild 実行時に
コマンドライン引数で上書きしているだけで、Xcode プロジェクト側の設定値は変更していない）。

### アップロード方式の選定
`xcodebuild -exportArchive` の `destination=upload` オプションで export とアップロードを
1ステップにまとめる方式は、Xcode バージョンによって挙動差があり、かつ失敗時にローカルへ
.ipa が残らない可能性がある（＝失敗時に artifact として回収できなくなる）ため採用しなかった。
代わりに「①ローカルに .ipa を export → ② artifact 保存 → ③ `xcrun altool --upload-app` で
明示的にアップロード」の2段階構成にし、③が失敗しても②の artifact は必ず残るようにしている。
`altool` は Apple から Transporter アプリへの移行が案内されているが、App Store Connect API
キー認証に対応し CI から非対話でアップロードできる実績があるため、現時点ではこちらを採用した。
