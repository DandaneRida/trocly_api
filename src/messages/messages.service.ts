import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Message } from './message.entity';
import { Offer } from '../offers/offer.entity';
import { User } from '../users/user.entity';

@Injectable()
export class MessagesService {
  constructor(
    @InjectRepository(Message) private messageRepo: Repository<Message>,
    @InjectRepository(Offer) private offerRepo: Repository<Offer>,
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {}

  /**
   * Create a message (persisted to database)
   */
  async createMessage(offerId: string, senderId: string, content: string): Promise<Message> {
    // Validate offer exists
    const offer = await this.offerRepo.findOne({
      where: { id: offerId },
      relations: { initiator: true, responder: true },
    });

    if (!offer) {
      throw new NotFoundException('Offer not found');
    }

    // Validate sender is participant
    const isParticipant = offer.initiator.id === senderId || offer.responder.id === senderId;
    if (!isParticipant) {
      throw new BadRequestException('You are not participant in this offer');
    }

    // Validate content
    if (!content || content.trim().length === 0) {
      throw new BadRequestException('Message content cannot be empty');
    }

    // Create message
    const message = this.messageRepo.create({
      offer: { id: offerId } as any,
      sender: { id: senderId } as any,
      content: content.trim(),
      readAt: undefined,
    });

    return await this.messageRepo.save(message);
  }

  /**
   * Get all messages for an offer (chat history)
   */
  async getOfferMessages(offerId: string): Promise<Message[]> {
    return this.messageRepo.find({
      where: { offer: { id: offerId } },
      relations: { sender: true, offer: true },
      order: { createdAt: 'ASC' },
      take: 50,
    });
  }

  /**
   * Get unread messages for a user
   */
  async getUnreadMessages(userId: string): Promise<Message[]> {
    return this.messageRepo.find({
      where: {
        offer: { responder: { id: userId } },
        readAt: undefined,
      } as any,
      relations: { sender: true, offer: true },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Mark all messages in offer as read by user
   */
  async markOfferMessagesAsRead(offerId: string, userId: string): Promise<void> {
    const messages = await this.messageRepo.find({
      where: {
        offer: { id: offerId },
        readAt: undefined,
      } as any,
    });

    for (const message of messages) {
      message.readAt = new Date();
      await this.messageRepo.save(message);
    }
  }

  /**
   * Get unread count for user
   */
  async getUnreadCount(userId: string): Promise<number> {
    return this.messageRepo.count({
      where: {
        offer: { responder: { id: userId } },
        readAt: undefined,
      } as any,
    });
  }

  /**
   * Get recent conversations (offers with messages)
   */
  async getRecentConversations(userId: string, limit = 10): Promise<any[]> {
    const messages = await this.messageRepo
      .createQueryBuilder('msg')
      .leftJoinAndSelect('msg.offer', 'offer')
      .leftJoinAndSelect('msg.sender', 'sender')
      .where(
        '(offer.initiator_id = :userId OR offer.responder_id = :userId)',
        { userId },
      )
      .orderBy('msg.created_at', 'DESC')
      .distinct(true)
      .limit(limit)
      .getMany();

    const conversationMap = new Map();
    for (const msg of messages) {
      if (!conversationMap.has(msg.offer.id)) {
        conversationMap.set(msg.offer.id, msg);
      }
    }

    return Array.from(conversationMap.values());
  }

  /**
   * Delete a message (by sender only)
   */
  async deleteMessage(messageId: string, userId: string): Promise<{ message: string }> {
    const msg = await this.messageRepo.findOne({
      where: { id: messageId },
      relations: { sender: true },
    });

    if (!msg) {
      throw new NotFoundException('Message not found');
    }

    if (msg.sender.id !== userId) {
      throw new BadRequestException('You can only delete your own messages');
    }

    await this.messageRepo.remove(msg);
    return { message: 'Message deleted' };
  }
}
