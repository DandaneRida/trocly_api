import {
  Injectable,
  OnModuleInit,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Not, Repository } from 'typeorm';
import { Message } from './message.entity';
import { Offer } from '../offers/offer.entity';
import { User } from '../users/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';

@Injectable()
export class MessagesService implements OnModuleInit {
  constructor(
    @InjectRepository(Message) private messageRepo: Repository<Message>,
    @InjectRepository(Offer) private offerRepo: Repository<Offer>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private dataSource: DataSource,
    private notificationsService: NotificationsService,
  ) {}

  async onModuleInit() {
    await this.dataSource.query(`
      ALTER TABLE messages
        ADD COLUMN IF NOT EXISTS offer_id uuid,
        ADD COLUMN IF NOT EXISTS content text;
      DO $$ BEGIN
        ALTER TABLE messages ALTER COLUMN negotiation_id DROP NOT NULL;
      EXCEPTION WHEN undefined_column THEN NULL; END $$;
      DO $$ BEGIN
        ALTER TABLE messages ALTER COLUMN body DROP NOT NULL;
      EXCEPTION WHEN undefined_column THEN NULL; END $$;
      DO $$ BEGIN
        ALTER TABLE messages ALTER COLUMN kind DROP NOT NULL;
      EXCEPTION WHEN undefined_column THEN NULL; END $$;
    `);
  }

  async verifyParticipant(offerId: string, userId: string): Promise<Offer> {
    const offer = await this.offerRepo.findOne({
      where: { id: offerId },
      relations: { initiator: true, responder: true },
    });
    if (!offer) {
      throw new NotFoundException('Offre introuvable');
    }
    const isParticipant =
      offer.initiator?.id === userId || offer.responder?.id === userId;
    if (!isParticipant) {
      throw new ForbiddenException('Vous ne participez pas à cette offre');
    }
    return offer;
  }

  /**
   * Create a message (persisted to database)
   */
  async createMessage(
    offerId: string,
    senderId: string,
    content: string,
  ): Promise<Message> {
    const offer = await this.verifyParticipant(offerId, senderId);

    if (!content || content.trim().length === 0) {
      throw new BadRequestException('Le message ne peut pas être vide');
    }

    const message = this.messageRepo.create({
      offer: { id: offerId } as any,
      sender: { id: senderId } as any,
      content: content.trim(),
    });

    const saved = await this.messageRepo.save(message);
    const full = await this.messageRepo.findOne({
      where: { id: saved.id },
      relations: { sender: true, offer: true },
    });

    // C5: notify recipient in background
    const recipientId =
      offer.initiator?.id === senderId ? offer.responder?.id : offer.initiator?.id;
    if (recipientId) {
      const senderName = full?.sender?.displayName || 'Un membre';
      this.notificationsService
        .notifyUser(
          recipientId,
          NotificationType.NEW_MESSAGE,
          `Nouveau message de ${senderName}`,
          content.trim().slice(0, 120),
          { offerId, route: `/chat/${offerId}` },
        )
        .catch(() => {});
    }

    return full || saved;
  }

  /**
   * Get paginated chat history for an offer
   */
  async getOfferMessages(
    offerId: string,
    userId?: string,
    page = 1,
    limit = 50,
  ): Promise<Message[]> {
    if (userId) {
      await this.verifyParticipant(offerId, userId);
    }
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safePage = Math.max(page, 1);

    return this.messageRepo.find({
      where: { offer: { id: offerId } },
      relations: { sender: true },
      order: { createdAt: 'ASC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });
  }

  /**
   * Get unread messages for a user across all their offers
   */
  async getUnreadMessages(userId: string): Promise<Message[]> {
    return this.messageRepo
      .createQueryBuilder('msg')
      .leftJoinAndSelect('msg.offer', 'offer')
      .leftJoinAndSelect('msg.sender', 'sender')
      .where('(offer.initiator_id = :userId OR offer.responder_id = :userId)', {
        userId,
      })
      .andWhere('msg.sender_id != :userId', { userId })
      .andWhere('msg.read_at IS NULL')
      .orderBy('msg.created_at', 'DESC')
      .getMany();
  }

  /**
   * Mark all messages sent by the other participant in an offer as read
   */
  async markOfferMessagesAsRead(offerId: string, userId: string): Promise<number> {
    await this.verifyParticipant(offerId, userId);
    const unread = await this.messageRepo.find({
      where: {
        offer: { id: offerId },
        sender: { id: Not(userId) },
        readAt: IsNull(),
      },
    });
    if (unread.length === 0) return 0;

    const now = new Date();
    for (const msg of unread) {
      msg.readAt = now;
    }
    await this.messageRepo.save(unread);
    return unread.length;
  }

  /**
   * Get unread count for user
   */
  async getUnreadCount(userId: string): Promise<number> {
    return this.messageRepo
      .createQueryBuilder('msg')
      .leftJoin('msg.offer', 'offer')
      .where('(offer.initiator_id = :userId OR offer.responder_id = :userId)', {
        userId,
      })
      .andWhere('msg.sender_id != :userId', { userId })
      .andWhere('msg.read_at IS NULL')
      .getCount();
  }

  /**
   * Get recent conversations (all offers where user participates, enriched with last message & unread count)
   */
  async getRecentConversations(userId: string, limit = 30): Promise<any[]> {
    const offers = await this.offerRepo.find({
      where: [
        { initiator: { id: userId } },
        { responder: { id: userId } },
      ],
      relations: {
        initiator: true,
        responder: true,
        items: { listing: true },
      },
      order: { updatedAt: 'DESC' },
      take: limit,
    });

    const result: any[] = [];
    for (const offer of offers) {
      const lastMsg = await this.messageRepo.findOne({
        where: { offer: { id: offer.id } },
        relations: { sender: true },
        order: { createdAt: 'DESC' },
      });
      const unreadCount = await this.messageRepo.count({
        where: {
          offer: { id: offer.id },
          sender: { id: Not(userId) },
          readAt: IsNull(),
        },
      });
      const otherUser =
        offer.initiator?.id === userId ? offer.responder : offer.initiator;
      const summaryTitles = (offer.items || [])
        .map((i) => i.listing?.title)
        .filter(Boolean);

      result.push({
        offerId: offer.id,
        status: offer.status,
        soulte: offer.soulte ? Number(offer.soulte) : 0,
        isResponder: offer.responder?.id === userId,
        otherUser: otherUser
          ? {
              id: otherUser.id,
              displayName: otherUser.displayName || 'Membre Trocly',
              phone: otherUser.whatsappNumber,
            }
          : { id: '', displayName: 'Membre Trocly' },
        itemSummary: summaryTitles.join(' ⇄ '),
        lastMessage:
          lastMsg?.content ||
          offer.message ||
          'Nouvelle proposition d\'échange',
        lastMessageAt: lastMsg?.createdAt || offer.updatedAt || offer.createdAt,
        unreadCount,
      });
    }

    result.sort(
      (a, b) =>
        new Date(b.lastMessageAt).getTime() -
        new Date(a.lastMessageAt).getTime(),
    );
    return result;
  }

  /**
   * Delete a message (by sender only)
   */
  async deleteMessage(
    messageId: string,
    userId: string,
  ): Promise<{ message: string }> {
    const msg = await this.messageRepo.findOne({
      where: { id: messageId },
      relations: { sender: true },
    });

    if (!msg) {
      throw new NotFoundException('Message introuvable');
    }
    if (msg.sender.id !== userId) {
      throw new ForbiddenException(
        'Vous ne pouvez supprimer que vos propres messages',
      );
    }

    await this.messageRepo.remove(msg);
    return { message: 'Message supprimé' };
  }
}
