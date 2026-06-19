import { describe, it, expect } from 'vitest';
import type { WebhookEvent } from '@line/bot-sdk';
import { handleEvent, type WebhookDeps } from '../src/webhook/handlers.js';

function postbackEvent(data: string): WebhookEvent {
  return {
    type: 'postback',
    mode: 'active',
    timestamp: 1,
    source: { type: 'user', userId: 'U1' },
    webhookEventId: 'e1',
    deliveryContext: { isRedelivery: false },
    replyToken: 'rt1',
    postback: { data },
  } as unknown as WebhookEvent;
}

const baseDeps = (): WebhookDeps => ({ members: {} as never });

describe('postback handler (已服藥)', () => {
  it('confirms the dose and replies with positive feedback', async () => {
    const replies: string[] = [];
    let confirmedId: string | null = null;
    await handleEvent(postbackEvent('action=confirm&dose=42-2026-06-20-morning'), {
      ...baseDeps(),
      confirms: {
        confirm: async (id: string) => {
          confirmedId = id;
          return 'confirmed';
        },
      },
      reply: async (_t, text) => {
        replies.push(text);
      },
    });
    expect(confirmedId).toBe('42-2026-06-20-morning');
    expect(replies[0]).toContain('已記錄');
  });

  it('ignores postbacks that are not confirm actions', async () => {
    let called = false;
    await handleEvent(postbackEvent('action=other&dose=x'), {
      ...baseDeps(),
      confirms: {
        confirm: async () => {
          called = true;
          return 'confirmed';
        },
      },
      reply: async () => {},
    });
    expect(called).toBe(false);
  });

  it('replies a not-found message when the dose is not applicable', async () => {
    const replies: string[] = [];
    await handleEvent(postbackEvent('action=confirm&dose=ghost'), {
      ...baseDeps(),
      confirms: { confirm: async () => 'not_applicable' },
      reply: async (_t, text) => {
        replies.push(text);
      },
    });
    expect(replies[0]).toContain('找不到');
  });
});
