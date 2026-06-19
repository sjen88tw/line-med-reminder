# 03 — 排程器(pg-boss)+ 提醒推播 + 逾時升級 + 推播重試/死信

## Context

「服藥前幾分鐘提醒」+「逾時 3 分升級」需求。用 pg-boss 的 delayed jobs,**不輪詢全表**。A3:推播會失敗(429/網路/被封鎖),漏推 = 病人漏藥,必須重試 + 死信。

## Current State

依賴 #02 的 dose_event 列(SCHEDULED 狀態 + scheduled_at)。

## Proposed Change

1. 引入 pg-boss(Postgres-backed,不另起 Redis)。
2. materialize 時(或排程 worker 啟動掃描),為每個 dose 排兩個 delayed job:**提醒 job**(scheduled_at − N 分)、**逾時檢查 job**(scheduled_at + 3 分)。
3. 提醒 job:推 Flex Message(藥品 + 餐別 + 「已服藥」postback 按鈕,data 帶 doseEventId)→ 狀態 `SCHEDULED → REMINDED`。
4. 逾時 job:若該 doseEventId 仍非 CONFIRMED → `→ ESCALATED`,推升級訊息(更強措辭)+ 通知藥局(pilot 不通知家屬)。
5. 推播失敗:指數退避重試(pg-boss retry),用盡 → 死信 + 告警 log。區分「沒送達」與「送達未確認」。

### Implementation Details

- 提醒 job payload:`{ doseEventId }`,handler 讀最新狀態(避免 stale)。
- 逾時 job 觸發時若狀態已 CONFIRMED → no-op。
- pg-boss 設 `retryLimit`、`retryBackoff: true`。
- 推播逾配額(429)→ 進重試;被封鎖(403)→ 標記會員不可達,不無限重試。

## Acceptance Criteria

1. dose 時間前 N 分準時推 Flex,狀態變 REMINDED。
2. 不確認 → 3 分後升級推播 + 藥局通知,狀態 ESCALATED。
3. 推播 429 → 退避重試;達上限 → 死信 + 告警,不靜默丟。
4. **排程器重啟後,未到期的提醒仍會發**(持久化佇列,非記憶體 timer)。
5. 逾時 job 觸發時若已 CONFIRMED → 不發升級。

## Testing Plan

| Layer | What | Count |
|-------|------|-------|
| Unit | 推播失敗分類(429 重試 / 403 標記不可達) | +2 |
| Integration | 時間 mock:準時觸發、逾時升級、已確認則不升級 | +3 |
| Integration | 重啟後未到期提醒仍發(持久化) | +1 |

## Files Reference

| File | Change |
|------|--------|
| `src/scheduler/queue.ts` | pg-boss 設定 + job 註冊 |
| `src/scheduler/reminder-job.ts` | 提醒推播 + 狀態轉移 |
| `src/scheduler/escalation-job.ts` | 逾時升級 + 藥局通知 |
| `src/line/push.ts` | 推播 + 重試/死信分類 |
| `src/line/flex-reminder.ts` | Flex 提醒卡(已服藥單一主導按鈕) |

## Out of Scope

確認 handler(#04)、續領提醒(#05)。

## Dependencies

#02(dose_event)。可與 #04 平行。
