# 07 — 藥師 LIFF 建處方表單 + 照片謄寫 + 壞圖處理

## Context

藥師建檔用藥明細的介面。工程外部聲音點名:**照片→結構化謄寫是真正的採用阻擋點**(藥師無償人工)。聊天視窗輸入結構化資料反人類,所以用 LIFF 網頁表單。壞圖/非處方圖/純文字的失敗路徑也要定義(長輩流量主導)。

## Current State

依賴 #02 的拆解器與處方模型、#06 的處方影像。

## Proposed Change

1. LIFF 表單(LINE 內嵌網頁):藥師對著 #06 收到的處方箋影像,填結構化欄位 → 建處方(觸發 #02 materialize)。
2. 表單欄位:病人(對應 member)、藥品名、劑量、頻率(QD/BID/TID/QID 下拉)、餐別(餐前/餐後/睡前)、天數。即時驗證 + 錯誤狀態。
3. 謄寫流程:影像並排表單,藥師看圖填欄位(本 issue 不做 OCR,OCR 是 Phase 2 候選 E5;此處先把人工謄寫做順)。
4. **壞圖處理**:病人傳非處方圖/純文字/不可讀影像 → 藥局後台標記「無法辨識」→ 推病人「請重傳清楚的處方箋照片」。

### Implementation Details

- LIFF app 註冊 + endpoint;表單 POST `/api/prescriptions` → prescription-service.create → materialize。
- 驗證:天數 1-90、頻率必選、至少一藥品；錯誤 inline 顯示。
- 壞圖:prescription_image.status = 'unreadable' → 觸發病人重傳推播。

## Acceptance Criteria

1. 藥師在 LIFF 填 TID/飯後/7 天 → 建出處方 + materialize 出 dose_event。
2. 缺必填(頻率/藥品)→ inline 錯誤,不送出。
3. 天數超範圍(0 或 999)→ 驗證擋下。
4. 標記影像「無法辨識」→ 病人收到重傳提示。

## Testing Plan

| Layer | What | Count |
|-------|------|-------|
| Unit | 表單驗證(天數/頻率/藥品邊界) | +3 |
| Integration | 建處方 → materialize；壞圖 → 重傳推播 | +2 |
| E2E | 藥師看圖填表 → 病人收到第一筆提醒 | +1 |

## Files Reference

| File | Change |
|------|--------|
| `liff/prescription-form/` | LIFF 表單 SPA |
| `src/api/prescriptions.ts` | 建處方 API + 驗證 |
| `src/webhook/handlers.ts` | 壞圖重傳推播 |

## Out of Scope

OCR 自動謄寫(Phase 2,E5)。

## Dependencies

#02、#06。
