# 配達ペースメーカー（PWA）

仕様: [reference/SPEC.md](reference/SPEC.md) / デザイン元: [reference/mock-reference.html](reference/mock-reference.html)

ビルド不要の静的ファイルだけで動くオフラインPWAです。

## 構成
| ファイル | 内容 |
|---|---|
| `index.html` / `style.css` / `app.js` | アプリ本体（フレームワークなし） |
| `sw.js` | 全ファイルを事前キャッシュするservice worker（キャッシュ優先） |
| `manifest.webmanifest` | standalone・縦向き固定 |
| `fonts/` | Inter・Noto Sans JP のサブセット（woff2、ウェイト400〜700の可変フォント） |
| `icons/` | アプリアイコン（通常・maskable・apple-touch） |
| `tools/` | フォントのサブセット化・アイコン生成スクリプト（デプロイ不要） |

## GitHub Pages へのデプロイ
1. このフォルダをGitHubリポジトリにpushする
2. リポジトリの Settings → Pages → Source を「Deploy from a branch」、ブランチ `main` / フォルダ `/ (root)` にする
3. `https://<ユーザー名>.github.io/<リポジトリ名>/` をAndroidのChromeで開き、メニューの「ホーム画面に追加」（または「アプリをインストール」）

パスはすべて相対なので、サブパス（`/<リポジトリ名>/`）でもそのまま動きます。

## 更新するとき
- ファイルを変えたら `sw.js` の `VERSION` を上げる（上げないと端末に古いキャッシュが残る）
- 画面の日本語テキストを増やしたら、フォントを作り直す（使っている文字だけ収録しているため）:
  ```
  pip install fonttools brotli
  python tools/subset_fonts.py . <元フォントのフォルダ>
  ```
  元フォントは google/fonts の `ofl/inter/Inter[opsz,wght].ttf` と `ofl/notosansjp/NotoSansJP[wght].ttf`（ファイル名を `Inter.ttf` / `NotoSansJP.ttf` にして置く）。

## ローカル確認
```
python -m http.server 8765
```
http://localhost:8765 を開く（service workerは localhost か HTTPS でのみ動作）。
