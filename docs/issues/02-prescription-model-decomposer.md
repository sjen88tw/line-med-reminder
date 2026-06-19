# 02 — 處方模型 + dose_event 狀態機(materialize)+ 拆解器

## Context

整個系統的心臟。dose_event 狀態機決定提醒、確認、防重複、逾時、統計全部行為。拆解器把處方(藥品/頻率/餐別/天數)轉成每餐絕對時間 —— 這是「拆解成每餐服藥陣列」需求。

## Current State

依賴 #01 的 DB 連線與 member 表。

## Proposed Change

1. **拆解器**:單一 table-driven 純函數 `decompose(prescription, mealTimes) -> Dose[]`。頻率→槽位、餐別→相對偏移皆查表,不用 if/else 散落。
2. **資料模型**:prescription 表 + dose_event 表。建檔時 **materialize**:把 N 天 × 每餐展開成 dose_event 列(A8),每列帶狀態 + 唯一 doseEventId。
3. **狀態機**:`SCHEDULED → REMINDED → CONFIRMED`,旁支 `REMINDED → ESCALATED → CONFIRMED`,逾期 `→ MISSED`。CONFIRMED 為終態。

### Implementation Details

```sql
CREATE TABLE prescription (
  id BIGSERIAL PRIMARY KEY,
  member_id BIGINT NOT NULL REFERENCES member(id),
  start_date DATE NOT NULL, days INT NOT NULL,
  meds JSONB NOT NULL,           -- [{name, qty, freq:'TID', timing:'飯後'}]
  status TEXT NOT NULL DEFAULT 'active',  -- active | ended
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE dose_event (
  id TEXT PRIMARY KEY,           -- doseEventId = prescriptionId + 'YYYY-MM-DD' + slot
  prescription_id BIGINT NOT NULL REFERENCES prescription(id),
  member_id BIGINT NOT NULL,
  slot TEXT NOT NULL,            -- morning | noon | evening | bedtime
  scheduled_at TIMESTAMPTZ NOT NULL,
  meds JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'SCHEDULED',
  confirmed_at TIMESTAMPTZ
);
CREATE INDEX idx_dose_status_time ON dose_event(status, scheduled_at);
```

頻率表:`QD→[morning]`、`BID→[morning,evening]`、`TID→[morning,noon,evening]`、`QID→[morning,noon,evening,bedtime]`。餐別偏移:飯前 -30m、飯後 +30m、睡前 = bedtime。未知頻率 → 拋 `UnknownFrequencyError`。

## Acceptance Criteria

1. TID/飯後/7 天處方 → 拆出 21 列 dose_event,時間 = 餐時 +30 分,doseEventId 唯一。
2. 未知頻率 → 拋 `UnknownFrequencyError`,不靜默吞。
3. 邊界:1 天處方 → 正確列數;跨午夜 bedtime 正確歸日。
4. 狀態轉移函數拒絕非法轉移(如 CONFIRMED → SCHEDULED)。

## Testing Plan

| Layer | What | Count |
|-------|------|-------|
| Unit | 拆解器 QD/BID/TID/QID、餐別偏移、天數展開、未知頻率、邊界 | +8 |
| Unit | 狀態機合法/非法轉移 | +3 |
| Integration | 建檔 materialize 出正確 dose_event 列 | +2 |

## Files Reference

| File | Change |
|------|--------|
| `src/dosing/decomposer.ts` | table-driven 純函數 + 狀態機圖註解 |
| `src/dosing/state-machine.ts` | dose 狀態轉移 |
| `src/prescription/prescription-service.ts` | 建檔 + materialize |
| `db/migrations/002_prescription_dose.sql` | 表 + 索引 |

## Out of Scope

排程觸發(#03)、確認(#04)、UI 建檔(#07)。

## Dependencies

#01(DB、member)。
