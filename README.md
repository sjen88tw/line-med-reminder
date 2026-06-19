# line-med-reminder

先勁藥局 LINE 智能服藥提醒 + 續領留客 pilot。

病人用 LINE 收服藥提醒、一鍵回報「已服藥」;藥局後台看到「哪些病人快斷藥沒回來」的留客儀表板,一鍵發 LINE 把他們找回來續領。

## ⚠️ 狀態:驗證前(Pre-validation)

四輪規劃審查(office-hours / 工程 / CEO / 設計)一致判決:**先用留客儀表板 mockup 跑藥局老闆會議,拿到「續領率願付數字 + 病人名單」再動工。** 本 repo 的 Phase 1 issue 是備好的工料 —— 開工前請先確認那場會議拿到了正向訊號。

- 設計與決議全文:`docs/DESIGN.md`
- 老闆會議 mockup:`~/.claude/plans/pharmacy-retention-dashboard.html`

## 賣什麼

不是「按鈕自陳依從率」,是**續領率/回診率** —— 藥局損益表看得懂的數字。

## 技術選型

- 後端:Node + TypeScript,LINE Messaging API(`@line/bot-sdk`)
- 資料庫:PostgreSQL
- 排程:pg-boss(Postgres-backed delayed jobs,pilot 不引入 Redis)
- 前端:LIFF(LINE 內嵌網頁,藥師建處方表單 + 留客儀表板)
- 影像:私有物件儲存 + signed URL

## Phase 1 issues

| # | 標題 | 相依 |
|---|------|------|
| Epic | Phase 1 pilot | — |
| 01 | 專案骨架 + LINE webhook + 簽章驗證 + 會員註冊 | — |
| 02 | 處方模型 + dose_event 狀態機 + 拆解器 | 01 |
| 03 | 排程器 + 提醒推播 + 逾時升級 + 推播重試 | 02 |
| 04 | 已服藥確認(冪等)+ 依從率統計 | 02 |
| 05 | 續領提醒迴圈(E1 變現鉤)+ 療程結束 | 02, 03 |
| 06 | 處方箋影像上傳 + 私有儲存 + 病人同意 | 01 |
| 07 | 藥師 LIFF 建處方表單 + 照片謄寫 + 壞圖處理 | 02 |
| 08 | 藥局留客儀表板(接真資料) | 04, 05 |

全文在 `docs/issues/`。

## 建 GitHub repo + 匯入 issue(gh 未安裝,手動步驟)

1. 裝 GitHub CLI:https://cli.github.com/ → `gh auth login`
2. 建 **private** repo 並推上去:
   ```bash
   cd ~/projects/line-med-reminder
   git add . && git commit -m "chore: scaffold + Phase 1 specs"
   gh repo create line-med-reminder --private --source=. --remote=origin --push
   ```
3. 把 issue 檔匯成真 issue(逐個):
   ```bash
   gh issue create --title "Phase 1 pilot (epic)" --body-file docs/issues/00-epic-phase1.md
   gh issue create --title "專案骨架 + webhook + 會員" --body-file docs/issues/01-foundation-webhook-auth-member.md
   # ...其餘 02-08 同理
   ```
   或開 https://github.com/<you>/line-med-reminder/issues/new 把檔案內容貼上。

> repo 含病人健康資料概念 —— **務必 private**。
