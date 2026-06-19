# 06 — 處方箋影像上傳 + 私有儲存 + signed URL + 病人同意

## Context

「LINE 傳處方箋圖片至後台,後台收通知」需求。處方箋影像是敏感醫療資料 —— 合規當天生效(不是上線前才補)。私有桶 + signed URL + 病人同意是 pilot 最小合規基線。

## Current State

依賴 #01 的 webhook image handler 樁。

## Proposed Change

1. webhook `message(type=image)` handler:用 Messaging API `getMessageContent(messageId)` 抓圖 → 存**私有物件儲存**(S3/GCS,非公開)。
2. 存 DB 一筆 prescription_image(member、object key、收到時間、狀態 pending)。
3. 推播通知藥局後台「收到 X 的處方箋影像」。
4. **病人同意流程**:首次傳圖前(或加好友時)推一則同意說明 + 同意按鈕,記 consent。未同意不存醫療影像。
5. 藥師看圖用 **signed URL**(短效),app server 不串流圖檔。

### Implementation Details

```sql
CREATE TABLE consent (
  member_id BIGINT PRIMARY KEY REFERENCES member(id),
  agreed_at TIMESTAMPTZ NOT NULL, version TEXT NOT NULL
);
CREATE TABLE prescription_image (
  id BIGSERIAL PRIMARY KEY,
  member_id BIGINT NOT NULL,
  object_key TEXT NOT NULL,          -- 私有桶 key,非公開 URL
  status TEXT NOT NULL DEFAULT 'pending',
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
- 桶政策:private,blockPublicAccess。讀取一律 signed URL(TTL ≤15 分)。

## Acceptance Criteria

1. 病人傳圖 → 抓取成功 → 存私有桶 → DB 記錄 → 藥局收通知。
2. **無任何公開可讀 URL**;直接 GET object key 被拒。
3. 未同意的會員傳圖 → 先走同意流程,同意後才存。
4. 藥師取圖走 signed URL,過期後該 URL 失效。

## Testing Plan

| Layer | What | Count |
|-------|------|-------|
| Unit | signed URL 產生 + TTL | +2 |
| Integration | image 事件 → 抓取 → 私有存 → 通知 | +2 |
| Integration | 公開存取被拒;未同意先同意 | +2 |

## Files Reference

| File | Change |
|------|--------|
| `src/webhook/handlers.ts` | image handler |
| `src/storage/object-store.ts` | 私有桶 put + signed URL |
| `src/consent/consent-service.ts` | 同意流程 |
| `db/migrations/004_image_consent.sql` | 表 |

## Out of Scope

完整個資法/醫療法遵循審查(上線前法務,非 pilot)。

## Dependencies

#01。可獨立平行。
