# 01 — 專案骨架 + LINE webhook + 簽章驗證 + 會員註冊

## Context

地基 issue。沒有 webhook,系統收不到任何 LINE 事件(加好友、傳圖、按按鈕)。會員註冊是「LINE 簡易註冊」需求:病人加官方帳號好友,後台自動建檔。

## Current State

Greenfield,空 repo。需建 Node + TypeScript 專案骨架、PostgreSQL 連線、LINE channel 設定。

## Proposed Change

1. 專案骨架:`package.json`、TypeScript、測試框架(vitest 或 jest)、`.env.example`(LINE channel secret/token、DB URL)。
2. LINE webhook 端點 `POST /webhook`,用 `@line/bot-sdk` 的 `middleware()` 驗 `X-Line-Signature`(A1 必做,不自己驗 HMAC)。
3. 事件路由:`follow` / `message(image)` / `postback` 各自 handler(本 issue 只實作 `follow`,其餘留樁)。
4. 會員服務:`follow` 事件帶 `userId` → upsert 會員(以 LINE userId 為唯一鍵,重複加好友不重建,冪等)。

### Implementation Details

```sql
CREATE TABLE member (
  id            BIGSERIAL PRIMARY KEY,
  line_user_id  TEXT UNIQUE NOT NULL,
  display_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
- `upsertMemberByLineUserId(userId, displayName)` → `INSERT ... ON CONFLICT (line_user_id) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING *`。

## Acceptance Criteria

1. 偽造簽章的 POST /webhook 回 401,不進 handler。
2. 合法 `follow` 事件 → member 表新增一列,回 200。
3. 同一 userId 重複 `follow` → member 列數不變(冪等),display_name 更新。
4. 無效 JSON body → 400,不崩。

## Testing Plan

| Layer | What | Count |
|-------|------|-------|
| Unit | `upsertMemberByLineUserId` 冪等 | +2 |
| Integration | webhook 簽章 valid/invalid、follow 建會員、重複 follow no-op | +4 |

## Files Reference

| File | Change |
|------|--------|
| `package.json`, `tsconfig.json`, `.env.example` | 骨架 |
| `src/server.ts` | webhook 端點 + sdk middleware |
| `src/webhook/handlers.ts` | follow/image/postback 路由 |
| `src/member/member-service.ts` | upsert 會員 |
| `db/migrations/001_member.sql` | member 表 |

## Out of Scope

image/postback 的實際邏輯(留 #02/#04/#06/#07)。

## Dependencies

無(地基)。
