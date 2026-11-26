import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { Notification } from './notification.entity';
import { DeviceToken } from './device-token.entity';

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private fcmReady = false;
  private fcmInitPromise: Promise<void> | null = null;

  constructor(
    @InjectRepository(Notification)
    private notificationRepo: Repository<Notification>,
    @InjectRepository(DeviceToken)
    private deviceTokenRepo: Repository<DeviceToken>,
    private dataSource: DataSource,
  ) {}

  async onModuleInit() {
    // Ensure tables exist even when synchronize: false
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        type varchar(64) NOT NULL,
        title varchar(200) NOT NULL,
        body text NOT NULL,
        data jsonb,
        is_read boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE notifications
        ADD COLUMN IF NOT EXISTS type varchar(64) NOT NULL DEFAULT 'info',
        ADD COLUMN IF NOT EXISTS title varchar(200) NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS body text NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS data jsonb,
        ADD COLUMN IF NOT EXISTS is_read boolean NOT NULL DEFAULT false;
      CREATE INDEX IF NOT EXISTS idx_notifications_user_created
        ON notifications (user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS device_tokens (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        token text NOT NULL UNIQUE,
        platform varchar(32) NOT NULL DEFAULT 'unknown',
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    // Initialize Firebase Admin SDK lazily in the background so cold start stays fast
    this.fcmInitPromise = this.initFcm();
  }

  private async initFcm(): Promise<void> {
    const rawJson = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
    const projectId = (process.env.FIREBASE_PROJECT_ID || '').trim();
    const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL || '').trim();
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(
      /\\n/g,
      '\n',
    );
    const localSdkPath = path.join(process.cwd(), 'firebase-adminsdk.json');

    const hasJson = rawJson.startsWith('{') && rawJson.includes('private_key');
    const hasEnvVars =
      Boolean(projectId) &&
      Boolean(clientEmail) &&
      privateKey.includes('BEGIN PRIVATE KEY');
    const hasLocalFile = fs.existsSync(localSdkPath);

    if (!hasJson && !hasEnvVars && !hasLocalFile) {
      this.logger.log(
        'FCM credentials not set — notifications persisted to DB (dev mode)',
      );
      return;
    }

    try {
      const { getApps, initializeApp, cert } = await import(
        'firebase-admin/app'
      );
      if (getApps().length > 0) {
        this.fcmReady = true;
        return;
      }

      let initialized = false;
      if (hasJson) {
        try {
          const parsed = JSON.parse(rawJson);
          if (
            typeof parsed.private_key === 'string' &&
            parsed.private_key.includes('BEGIN PRIVATE KEY')
          ) {
            initializeApp({ credential: cert(parsed) });
            this.fcmReady = true;
            initialized = true;
            this.logger.log('FCM initialized with FIREBASE_SERVICE_ACCOUNT_JSON');
          }
        } catch (e: any) {
          this.logger.warn(
            `FIREBASE_SERVICE_ACCOUNT_JSON invalid: ${e?.message}`,
          );
        }
      }

      if (!initialized && hasEnvVars) {
        try {
          initializeApp({
            credential: cert({ projectId, clientEmail, privateKey }),
          });
          this.fcmReady = true;
          initialized = true;
          this.logger.log(`FCM initialized via env vars (${projectId})`);
        } catch (e: any) {
          this.logger.warn(`FCM env vars invalid: ${e?.message}`);
        }
      }

      if (!initialized && hasLocalFile) {
        try {
          const serviceAccount = JSON.parse(
            fs.readFileSync(localSdkPath, 'utf-8'),
          );
          initializeApp({ credential: cert(serviceAccount) });
          this.fcmReady = true;
          initialized = true;
          this.logger.log(
            `FCM initialized via firebase-adminsdk.json (${serviceAccount.project_id})`,
          );
        } catch (e: any) {
          this.logger.warn(
            `FCM firebase-adminsdk.json init failed: ${e?.message}`,
          );
        }
      }
    } catch (e: any) {
      this.logger.warn(`FCM lazy load failed: ${e?.message}`);
    }
  }

  async registerDeviceToken(
    userId: string,
    token: string,
    platform = 'unknown',
  ): Promise<DeviceToken> {
    const existing = await this.deviceTokenRepo.findOne({ where: { token } });
    if (existing) {
      existing.userId = userId;
      existing.platform = platform;
      return this.deviceTokenRepo.save(existing);
    }
    const created = this.deviceTokenRepo.create({ userId, token, platform });
    return this.deviceTokenRepo.save(created);
  }

  async notifyUser(
    userId: string,
    type: string,
    title: string,
    body: string,
    data?: Record<string, any>,
  ): Promise<Notification> {
    const saved = await this.notificationRepo.save(
      this.notificationRepo.create({
        userId,
        type,
        title,
        body,
        data: data || null,
        isRead: false,
      }),
    );

    if (this.fcmReady) {
      const tokens = await this.deviceTokenRepo.find({ where: { userId } });
      if (tokens.length > 0) {
        const stringData: Record<string, string> = { type, notificationId: saved.id };
        if (data) {
          for (const [k, v] of Object.entries(data)) {
            if (v !== undefined && v !== null) stringData[k] = String(v);
          }
        }
        try {
          const { getMessaging } = await import('firebase-admin/messaging');
          await getMessaging().sendEachForMulticast({
            tokens: tokens.map((t) => t.token),
            notification: { title, body },
            data: stringData,
          });
        } catch (err: any) {
          this.logger.warn(`FCM push failed: ${err?.message}`);
        }
      }
    } else {
      this.logger.debug(`[DEV NOTIF] -> ${userId}: ${title} | ${body}`);
    }

    return saved;
  }

  async getUserNotifications(userId: string, limit = 40): Promise<Notification[]> {
    return this.notificationRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 100),
    });
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.notificationRepo.count({
      where: { userId, isRead: false },
    });
  }

  async markAsRead(id: string, userId: string): Promise<{ updated: boolean }> {
    const res = await this.notificationRepo.update({ id, userId }, { isRead: true });
    return { updated: (res.affected || 0) > 0 };
  }

  async markAllAsRead(userId: string): Promise<{ updated: number }> {
    const res = await this.notificationRepo.update(
      { userId, isRead: false },
      { isRead: true },
    );
    return { updated: res.affected || 0 };
  }
}
