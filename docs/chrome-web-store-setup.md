# Chrome Web Store 自動發布設定

Push tag（如 `git tag v2.5.0 && git push --tags`）即自動：測試 → 打包 → 上傳 → 送審。

## 一次性設定步驟

### 1. 註冊 Chrome Web Store 開發者

- 前往 [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
- 支付一次性 $5 USD 註冊費
- 確保帳號已啟用兩步驟驗證（Google 強制要求）

### 2. 手動上傳第一版

1. 在 Developer Dashboard → **New Item**
2. 上傳 extension zip（可用 `zip -r extension.zip . -x "*.test.js" -x "tests/*" -x "node_modules/*" -x ".git/*" -x ".github/*"` 產生）
3. 填寫 listing 資訊：名稱、描述、截圖、分類
4. Submit for review
5. 記下 extension ID（Dashboard URL 中的 32 字元字串）

### 3. 取得 OAuth2 API 憑證

#### Step A — Google Cloud Console

1. 前往 [Google Cloud Console](https://console.cloud.google.com)
2. 建立新 Project（如 `chrome-webstore-upload`）
3. APIs & Services → Library → 搜尋 **Chrome Web Store API** → Enable
4. APIs & Services → OAuth consent screen → Get started
   - App name: `Chrome Webstore Upload`
   - User support email: 你的 email
   - Audience: **External**（儲存後把自己加入 test users）
5. APIs & Services → Credentials → Create Credentials → **OAuth client ID**
   - Application type: **Desktop app**
   - 建立後記下 `CLIENT_ID` 和 `CLIENT_SECRET`

#### Step B — 取得 Refresh Token

```bash
npx chrome-webstore-upload-keys
```

按提示輸入 CLIENT_ID 和 CLIENT_SECRET → 瀏覽器開啟 Google 授權 → 完成後印出 `REFRESH_TOKEN`。

> 注意：必須用**擁有該 extension 的 Google 帳號**登入。

### 4. 設定 GitHub Secrets

到 repo [Settings → Secrets → Actions](https://github.com/marskingx/anytype-web-clipper/settings/secrets/actions) 新增：

| Secret Name | 值 |
|------------|-----|
| `CWS_EXTENSION_ID` | extension 的 32 字元 ID |
| `CWS_CLIENT_ID` | Step A 取得的 client_id |
| `CWS_CLIENT_SECRET` | Step A 取得的 client_secret |
| `CWS_REFRESH_TOKEN` | Step B 取得的 refresh_token |

## 使用方式

```bash
# 更新 manifest.json 中的 version
# commit 後打 tag
git tag v2.6.0
git push && git push --tags
```

GitHub Actions 會自動：
1. 跑 261 個 unit tests
2. 打包 zip（排除 test/dev 檔案）
3. 上傳到 Chrome Web Store
4. 送審（通常 1-3 天）

## 除錯

- **Token 失效**：重跑 `npx chrome-webstore-upload-keys` 取得新 token
- **審核被拒**：到 Developer Dashboard 查看拒絕原因，修正後重新 push tag
- **只上傳不送審**：將 `publish.yml` 中的 `publish: true` 改為 `publish: false`
