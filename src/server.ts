import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import { middleware, type WebhookRequestBody } from '@line/bot-sdk';
import { handleEvents, type WebhookDeps } from './webhook/handlers.js';

export interface AppDeps extends WebhookDeps {
  channelSecret: string;
}

export function createApp(deps: AppDeps): Express {
  const app = express();

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // line.middleware verifies X-Line-Signature against the raw body, then
  // parses it. It MUST run before any body parser so the raw bytes survive.
  app.post(
    '/webhook',
    middleware({ channelSecret: deps.channelSecret }),
    async (req: Request, res: Response) => {
      const body = req.body as WebhookRequestBody;
      try {
        await handleEvents(body.events ?? [], deps);
        res.status(200).json({ ok: true });
      } catch (err) {
        // Internal failure AFTER a valid signature. Log and 500; LINE will retry.
        console.error('webhook handler error', err);
        res.status(500).json({ ok: false });
      }
    },
  );

  // Map LINE SDK errors to HTTP status. Use constructor name so we don't depend
  // on the SDK exporting the error classes.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const name = (err as { constructor?: { name?: string } })?.constructor?.name;
    if (name === 'SignatureValidationFailed') {
      return res.status(401).json({ error: 'invalid signature' });
    }
    if (name === 'JSONParseError') {
      return res.status(400).json({ error: 'invalid body' });
    }
    console.error('unhandled error', err);
    return res.status(500).json({ error: 'internal' });
  });

  return app;
}
