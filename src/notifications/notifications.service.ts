import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { Notification } from './notification.entity';
import { DeviceToken } from './device-token.entity';

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private fcmReady = false;

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

    // Initialize Firebase Admin SDK only when credentials are provided
    const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (rawJson && getApps().length === 0) {
      try {
        const serviceAccount = JSON.parse(rawJson);
        initializeApp({
          credential: cert(serviceAccount),
        });
        this.fcmReady = true;
        this.logger.log('FCM initialized with FIREBASE_SERVICE_ACCOUNT_JSON');
      } catch (e: any) {
        this.logger.warn(`FCM init skipped: ${e?.message}`);
      }
    } else if (getApps().length > 0) {
      this.fcmReady = true;
    } else {
      this.logger.log(
        'FCM credentials not set — notifications persisted to DB (dev mode)',
      );
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
