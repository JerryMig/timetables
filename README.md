# 台鐵時刻查詢網站

這是一個本機執行的台鐵直達班次查詢網站，資料來源走交通部 TDX Transport Data eXchange API。

## 使用方式

1. 申請 TDX 帳號並建立 API Key。
2. 複製環境設定：

   ```bash
   cp .env.example .env
   ```

3. 編輯 `.env`，填入：

   ```bash
   TDX_CLIENT_ID=你的 Client ID
   TDX_CLIENT_SECRET=你的 Client Secret
   ```

4. 安裝與啟動：

   ```bash
   npm install
   npm start
   ```

5. 開啟：

   ```text
   http://localhost:4173
   ```

## 功能

- 載入台鐵車站清單並提供站名建議。
- 查詢指定日期與出發時間之後的起訖站直達班次，預設顯示最多 20 筆。
- 顯示常用路線：台北到桃園、桃園到台北、桃園到松山、松山到桃園。
- 可新增或刪除常用路線，設定會保存在目前瀏覽器。
- 顯示車種、車次、起終點、出發/抵達時間、行車時間與停靠站數。
- TDX 憑證缺少或 API 失敗時，在頁面上顯示可讀錯誤。

## 限制

- 目前查詢直達班次，尚未規劃轉乘。
- TDX API 需要有效的 `TDX_CLIENT_ID` 與 `TDX_CLIENT_SECRET`。
