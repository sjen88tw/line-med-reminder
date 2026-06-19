# 05 — 續領提醒迴圈(E1 變現鉤)+ 療程結束停提醒

## Context

**這是藥局付費路的變現鉤(CEO 審查 E1 ACCEPTED)。** 藥局不為「提醒吃藥」付錢,為「病人回來續領」付錢。處方天數將盡 → 推「該回來續領」給病人 + 通知藥局召回。同時療程結束要停服藥提醒(否則過期還在推,打擾病人)。

## Current State

依賴 #02(處方天數)、#03(排程器 + 藥局通知管道)。

## Proposed Change

1. materialize 處方時,額外排一個 **續領提醒 job**:`start_date + days − R 天`(R 預設 2,可設)。
2. 續領 job:推 Flex「您的藥快用完了,記得回來續領」+ 通知藥局後台(此病人進續領待召回名單)。
3. 療程結束:`start_date + days` 到 → 處方 `status = 'ended'`,停掉該處方剩餘服藥提醒 job(取消 pg-boss 未來 job)。
4. 續領狀態:記錄續領提醒已發/病人是否回診續領(供 #08 儀表板「續領率」「已挽回」計算)。

### Implementation Details

```sql
ALTER TABLE prescription ADD COLUMN refill_reminded_at TIMESTAMPTZ;
ALTER TABLE prescription ADD COLUMN refilled_at TIMESTAMPTZ;  -- 藥師在後台標記回來續領
```
- 續領率 = 期間內 `refilled_at IS NOT NULL` 的處方 / 應續領處方。
- 處方變更(提早停、調劑量)→ 重生未來 dose job + 重排續領 job(stale-row 處理,A8 取捨)。

## Acceptance Criteria

1. 處方剩 R 天 → 病人收到續領提醒,藥局後台收到召回通知。
2. 療程結束(天數到)→ 處方 status=ended,不再推服藥提醒。
3. 藥師標記「已續領」→ refilled_at 記錄,計入續領率/已挽回。
4. 處方提早停 → 未來服藥 + 續領 job 都取消,不誤推。

## Testing Plan

| Layer | What | Count |
|-------|------|-------|
| Unit | 續領 job 時間計算(start + days − R) | +2 |
| Integration | 剩 R 天推續領 + 通知藥局 | +1 |
| Integration | 天數到停提醒;提早停取消未來 job | +2 |
| Unit | 續領率計算 | +1 |

## Files Reference

| File | Change |
|------|--------|
| `src/scheduler/refill-job.ts` | 續領提醒 + 藥局召回通知 |
| `src/prescription/lifecycle.ts` | 療程結束停 job + 變更重排 |
| `src/stats/refill.ts` | 續領率/已挽回計算 |
| `db/migrations/003_refill.sql` | refill 欄位 |

## Out of Scope

回診提醒(綁診所資料,Phase 2)。

## Dependencies

#02、#03。
