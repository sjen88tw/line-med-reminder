import type { messagingApi } from '@line/bot-sdk';
import type { Slot } from '../dosing/decomposer.js';

const SLOT_LABEL: Record<Slot, string> = {
  morning: '早上',
  noon: '中午',
  evening: '晚上',
  bedtime: '睡前',
};

export function slotLabel(slot: string): string {
  return SLOT_LABEL[slot as Slot] ?? '服藥時間';
}

export interface DoseMedLike {
  name: string;
  qty: number;
}

export function medsLine(meds: DoseMedLike[]): string {
  return meds.map((m) => `${m.name} ${m.qty} 顆`).join('、');
}

export interface ReminderView {
  doseEventId: string;
  slot: string;
  meds: DoseMedLike[];
}

// The "已服藥" button is the single dominant action (design: elderly users).
function confirmButton(doseEventId: string): messagingApi.FlexButton {
  return {
    type: 'button',
    style: 'primary',
    height: 'md',
    action: {
      type: 'postback',
      label: '✅ 已服藥',
      data: `action=confirm&dose=${doseEventId}`,
      displayText: '已服藥',
    },
  };
}

export function buildReminderFlex(v: ReminderView): messagingApi.FlexMessage {
  const line = medsLine(v.meds);
  return {
    type: 'flex',
    altText: `服藥提醒：${line}`,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          { type: 'text', text: `服藥提醒 · ${slotLabel(v.slot)}`, weight: 'bold', size: 'lg' },
          { type: 'text', text: line, size: 'md', wrap: true },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [confirmButton(v.doseEventId)],
      },
    },
  };
}

// #07: pharmacist marked the photo unreadable -> ask the patient to resend.
export function buildResendMessage(): messagingApi.TextMessage {
  return {
    type: 'text',
    text: '這張處方箋看不太清楚，麻煩再傳一張清楚的照片給我們 🙏',
  };
}

// #05 refill nudge. No confirm button — the pharmacy calls/serves the patient.
export function buildRefillMessage(drugSummary: string): messagingApi.TextMessage {
  return {
    type: 'text',
    text: `提醒您：您的藥（${drugSummary}）快用完了，記得回藥局續領 🙏`,
  };
}

// Escalation card: visually distinct (red header), stronger copy, same button.
export function buildEscalationFlex(v: ReminderView): messagingApi.FlexMessage {
  const line = medsLine(v.meds);
  return {
    type: 'flex',
    altText: `您還沒回報服藥：${line}`,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          { type: 'text', text: '⚠️ 您還沒回報今天的藥', weight: 'bold', size: 'lg', color: '#C0392B' },
          { type: 'text', text: `${slotLabel(v.slot)}：${line}`, size: 'md', wrap: true },
          { type: 'text', text: '吃了嗎？請按下方確認。', size: 'sm', color: '#666666', wrap: true },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [confirmButton(v.doseEventId)],
      },
    },
  };
}
