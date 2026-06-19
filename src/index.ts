import { Pool } from 'pg';
import { messagingApi } from '@line/bot-sdk';
import { loadConfig } from './config.js';
import { runMigrations } from './db.js';
import { makeMemberService } from './member/member-service.js';
import { createApp } from './server.js';

async function main(): Promise<void> {
  const cfg = loadConfig();

  const pool = new Pool({ connectionString: cfg.databaseUrl });
  await runMigrations(pool);

  const members = makeMemberService(pool);

  const lineApi = new messagingApi.MessagingApiClient({
    channelAccessToken: cfg.channelAccessToken,
  });
  const getDisplayName = async (userId: string): Promise<string | null> => {
    try {
      const profile = await lineApi.getProfile(userId);
      return profile.displayName ?? null;
    } catch {
      // Profile lookup is best-effort; never block member creation on it.
      return null;
    }
  };

  const app = createApp({ channelSecret: cfg.channelSecret, members, getDisplayName });
  app.listen(cfg.port, () => {
    console.log(`line-med-reminder listening on :${cfg.port}`);
  });
}

main().catch((err) => {
  console.error('fatal startup error', err);
  process.exit(1);
});
