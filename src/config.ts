export interface Config {
  channelSecret: string;
  channelAccessToken: string;
  databaseUrl: string;
  port: number;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export function loadConfig(): Config {
  return {
    channelSecret: required('LINE_CHANNEL_SECRET'),
    channelAccessToken: required('LINE_CHANNEL_ACCESS_TOKEN'),
    databaseUrl: required('DATABASE_URL'),
    port: Number(process.env.PORT ?? 3000),
  };
}
