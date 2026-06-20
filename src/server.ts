import { join } from 'node:path';
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import { middleware, type WebhookRequestBody } from '@line/bot-sdk';
import { handleEvents, type WebhookDeps } from './webhook/handlers.js';
import type { PrescriptionService } from './prescription/prescription-service.js';
import type { JobQueue } from './scheduler/scheduler.js';
import type { DashboardService } from './dashboard/dashboard-service.js';
import { validateCreatePrescription } from './api/prescriptions.js';

export interface AppDeps extends WebhookDeps {
  channelSecret: string;
  prescriptions?: PrescriptionService; // #07: pharmacist create-prescription API
  queue?: JobQueue;
  dashboard?: DashboardService; // #08: pharmacy retention dashboard API
}

export function createApp(deps: AppDeps): Express {
  const app = express();

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // LIFF surfaces: pharmacist prescription form + retention dashboard.
  app.use('/liff', express.static(join(process.cwd(), 'liff')));

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

  // #07: pharmacist LIFF APIs. express.json() is scoped to these routes only —
  // it must NOT run before the LINE middleware (which needs the raw body).
  if (deps.prescriptions) {
    app.post('/api/prescriptions', express.json(), async (req: Request, res: Response) => {
      const v = validateCreatePrescription(req.body);
      if (!v.ok) {
        res.status(400).json({ errors: v.errors });
        return;
      }
      try {
        const result = await deps.prescriptions!.create({ ...v.value, queue: deps.queue });
        res.status(201).json({
          prescriptionId: result.prescriptionId,
          doseCount: result.doseCount,
        });
      } catch (err) {
        // Most failures here are a bad memberId (FK violation) -> client error,
        // not a crash. Return a clean message instead of leaking a 500 HTML page.
        console.error('create prescription failed', err);
        res.status(400).json({ errors: ['建立失敗，請確認會員 ID 是否存在'] });
      }
    });
  }

  if (deps.images) {
    app.post(
      '/api/images/:id/unreadable',
      express.json(),
      async (req: Request, res: Response) => {
        try {
          const ok = await deps.images!.markUnreadable(req.params.id);
          res.status(ok ? 200 : 404).json({ ok });
        } catch (err) {
          console.error('markUnreadable failed', err);
          res.status(500).json({ error: 'internal' });
        }
      },
    );
  }

  // #08: pharmacy retention dashboard.
  if (deps.dashboard) {
    const apiError = (res: Response, err: unknown): void => {
      console.error('dashboard api error', err);
      if (!res.headersSent) res.status(500).json({ error: 'internal' });
    };
    app.get('/api/dashboard/at-risk', async (_req: Request, res: Response) => {
      try {
        res.json({ atRisk: await deps.dashboard!.atRisk(new Date()) });
      } catch (err) {
        apiError(res, err);
      }
    });
    app.get('/api/dashboard/metrics', async (_req: Request, res: Response) => {
      try {
        res.json(await deps.dashboard!.metrics(new Date()));
      } catch (err) {
        apiError(res, err);
      }
    });
    app.post(
      '/api/dashboard/remind/:id',
      express.json(),
      async (req: Request, res: Response) => {
        try {
          const ok = await deps.dashboard!.remind(req.params.id);
          res.status(ok ? 200 : 404).json({ ok });
        } catch (err) {
          apiError(res, err);
        }
      },
    );
  }

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
