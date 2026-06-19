# DESIGN — line-med-reminder

濃縮自四輪規劃審查(完整過程在 gstack 計畫檔 `~/.claude/plans/line-line-concurrent-seal.md`)。

## 一句話

LINE 當病人介面(零安裝),藥局後台建處方、推服藥提醒、追續領。賣的是**續領率**,不是按鈕自陳依從。

## 鎖定的架構決定

| 代號 | 決定 | 理由 |
|------|------|------|
| 路線 B | LINE + LIFF(非原生 App) | 保住「零安裝、長輩能用」wedge |
| 基礎設施 | pg-boss(Postgres 佇列),pilot 不用 Redis | 少一個維運依賴,boring by default |
| A1(必做) | webhook 用 `@line/bot-sdk` middleware 驗 `X-Line-Signature` | 不驗 = 任何人偽造已服藥/註冊 |
| A3(必做) | 推播失敗指數退避重試 + 死信告警 | 漏推 = 病人漏藥 = 核心價值崩 |
| A2 | 餐時用靜默預設 08:00/12:30/18:30/22:00 | 零摩擦。⚠️ 已知代價:作息不同的長輩會被早推「飯後」,動工前可重開 |
| A8 | dose_event 建檔時 materialize 成列,每列帶狀態機 + 唯一 doseEventId | 狀態機/依從率/防重複都自然掛在列上 |
| 拆解器 | 單一 table-driven 純函數 | 最高測試密度;新增頻率只改資料 |

## LINE 做不到鬧鐘/鳴笛(致命前提,已接受)

LINE 推播 = 系統通知音,不是鬧鈴,無法靜音強制發聲、無法鳴笛。原需求的「逾時 3 分鳴笛」用**升級推播 + 通知藥局/家屬**替代(pilot 家屬共享延後,先通知藥局)。

## dose event 狀態機

```
SCHEDULED ──(提醒前 N 分)──► REMINDED ──(按「已服藥」)──► CONFIRMED ✅
    │                          │                              ▲
    │                          │(逾時 3 分)                   │(再按 = no-op,防重複)
    │                          ▼                              │
    │                      ESCALATED ──(按「已服藥」)──────────┘
    │                          │(當餐結束仍未確認)
    └──────────────────────►  MISSED(記入依從率分母)
```
冪等:CONFIRMED 是終態,重複 postback 一律 no-op。

## 服藥排程拆解 JSON

頻率→槽位:QD→[早]、BID→[早,晚]、TID→[早,午,晚]、QID→[早,午,晚,睡前];餐別相對預設餐時換算絕對時間。

```json
{
  "memberId": "M00123", "prescriptionId": "RX2026-0042",
  "startDate": "2026-06-20", "days": 7,
  "mealTimes": { "breakfast": "08:00", "lunch": "12:30", "dinner": "18:30", "bedtime": "22:00" },
  "doses": [
    { "slot": "morning", "time": "08:30", "timing": "飯後", "meds": [{ "name": "Amoxicillin 500mg", "qty": 1 }] }
  ]
}
```
排程器將每筆 dose 依 days 展開成具體日期時間事件,doseEventId = prescriptionId + 日期 + slot。

## 六大功能 → 實作

1. 加好友 → webhook `follow` → 建會員(冪等)
2. 傳處方圖 → webhook `image` → 抓內容存私有桶 → 通知藥局
3. 藥師 LIFF 建檔 → 拆解器 → 每餐 JSON + Flex 呈現
4. 提醒前 N 分推 Flex(聲音 = 系統通知音)
5. 「已服藥」postback(帶 doseEventId)→ 冪等記錄 + 統計
6. 逾時 3 分 → 升級推播 + 通知藥局(非鳴笛)

## 商業模式未解(驗證標的)

藥局為何付錢未證實。Phase 0 = 留客儀表板 mockup + 老闆會議,測續領率願付。三問:現在多少病人沒回來續領?願付多少月費?願給 10 病人試?
