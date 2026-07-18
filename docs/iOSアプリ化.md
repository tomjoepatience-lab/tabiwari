# iOSアプリ化

マネコ家計簿を iOS ネイティブアプリ（App Store 配布想定）として提供するための構想・実装メモ。

> 注記: このファイルは M1 実装時点（sonnet 実装）でこの worktree に存在しなかったため新規作成した。
> fable が全体のフェーズ計画（M0〜MN 等）を別途整理する場合はこのファイルへ追記・再構成してよい。

## M1: Capacitor シェル ＋ シミュレータビルド（実装済み）

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
