# 08 — 藥局留客儀表板(接真資料,用已核准 mockup)

## Context

設計審查產出並核准的 Phase 0 mockup,本 issue 接真資料。**這是藥局付費看到的東西** —— 不是服藥次數表,是「哪些病人快斷藥沒回來」的留客儀表板,藥師可一鍵發 LINE 召回。

## Current State

已核准 mockup:`~/.claude/plans/pharmacy-retention-dashboard.html`(先勁藥局版,50 病人)。依賴 #04(依從率)、#05(續領率/已挽回/續領待召回名單)。

## Proposed Change

1. 儀表板(LIFF 或網頁 admin),版面照核准 mockup:標頭續領率 → 4 數字卡(續領率/依從率/風險人數/已挽回)→ **風險名單為主**(快斷藥沒回來,依剩餘天數排序)→ 每列一鍵「LINE 提醒」。
2. 風險名單查詢:處方剩餘天數 ≤ 門檻 且 未續領,join 依從率,依剩餘天數排序。
3. 一鍵 LINE 提醒:點按 → 對該病人發續領提醒(復用 #05 的續領推播),標記已提醒。
4. **空狀態有溫度**:無風險病人 →「本月沒有風險病人,做得好」,非「No data」。
5. 響應式:藥師手機看的行動版版面(設計審查列為待補項)。

### Implementation Details

- `GET /api/dashboard/at-risk` → `[{ member, drug, daysLeft, adherenceRate, riskLevel }]`,risk: ≤2 天高、≤5 天中。
- `POST /api/dashboard/remind/:doseOrMemberId` → 發續領提醒。
- 數字卡:續領率(#05)、依從率(#04)、風險人數(count)、已挽回(refilled this period)。

## Acceptance Criteria

1. 風險名單列出剩餘天數 ≤ 門檻且未續領的病人,依剩餘天數升序。
2. 一鍵 LINE 提醒 → 病人收到續領提醒,該列標「已提醒」。
3. 零風險 → 顯示有溫度的空狀態。
4. 行動版(≤520px)版面不破、可操作(觸控目標 ≥44px)。
5. 數字卡四個值與底層查詢一致(續領率/依從率/風險數/已挽回)。

## Testing Plan

| Layer | What | Count |
|-------|------|-------|
| Unit | at-risk 查詢排序 + risk 分級門檻 | +3 |
| Integration | 一鍵提醒 → 推播 + 標記 | +1 |
| E2E | 藥師開儀表板 → 看風險名單 → 點提醒 → 病人收到 | +1 |

## Files Reference

| File | Change |
|------|--------|
| `liff/dashboard/` 或 `web/dashboard/` | 儀表板 UI(照 mockup) |
| `src/api/dashboard.ts` | at-risk 查詢 + 提醒 API |
| `src/stats/` | 復用 #04/#05 統計 |

## Out of Scope

家屬共享儀表板(Phase 2)。

## Dependencies

#04、#05。建議最後做(接全部真資料)。
