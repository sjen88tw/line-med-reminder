# 04 — 已服藥確認(冪等)+ 依從率統計

## Context

「按鈕確認已服藥 + 統計餐別次數 + 防止重複服藥」需求。冪等是核心:重複按不能重複計數。

## Current State

依賴 #02 的 dose_event 狀態機。提醒卡的 postback 來自 #03 的 Flex(本 issue 實作接收端)。

## Proposed Change

1. postback handler:解析 `doseEventId` → 狀態轉移 `REMINDED/ESCALATED → CONFIRMED`,記 `confirmed_at`。
2. **冪等**:CONFIRMED 為終態,重複 postback → no-op,回病人「已記錄」而非重複計數。
3. 確認回饋:回「已記錄,今天做得很好」(對長輩正向回饋)。
4. 依從率統計:`CONFIRMED / (CONFIRMED + MISSED)`,可依會員/處方/餐別聚合。MISSED = 當餐結束未確認(由 #03 逾時或每日結算標記)。

### Implementation Details

- `confirmDose(doseEventId)`:`UPDATE dose_event SET status='CONFIRMED', confirmed_at=now() WHERE id=$1 AND status IN ('REMINDED','ESCALATED') RETURNING *`。回傳 0 列 = 已確認或非法 → 視為冪等 no-op。
- 統計:`adherenceRate(memberId, range)` 聚合查詢。

## Acceptance Criteria

1. 首次按「已服藥」→ 狀態 CONFIRMED,統計 +1,回正向訊息。
2. **同一 doseEventId 重複按 → 計數不變**,仍回「已記錄」(冪等防重複)。
3. 對 SCHEDULED(還沒提醒)的 postback → 拒絕/no-op,不誤記。
4. 依從率分母含 MISSED;全 MISSED 的會員依從率 = 0%,不除以零崩潰。

## Testing Plan

| Layer | What | Count |
|-------|------|-------|
| Unit | `confirmDose` 冪等(重複呼叫計數不變) | +3 |
| Unit | `adherenceRate` 含 MISSED、零分母 | +2 |
| Integration | postback → 確認 → 統計;重複 postback no-op | +2 |

## Files Reference

| File | Change |
|------|--------|
| `src/webhook/handlers.ts` | postback handler |
| `src/dosing/confirm-service.ts` | confirmDose 冪等 |
| `src/stats/adherence.ts` | 依從率聚合 |

## Out of Scope

儀表板呈現(#08)。

## Dependencies

#02。可與 #03 平行。
