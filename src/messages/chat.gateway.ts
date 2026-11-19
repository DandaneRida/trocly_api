import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { MessagesService } from './messages.service';

/**
 * C4 - Real-time chat via Socket.IO with JWT handshake authentication
 */
@WebSocketGateway({
  cors: { origin: '*', credentials: true },
})
@Injectable()
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private connectedUsers: Map<string, string> = new Map();
  private typingUsers: Map<string, Set<string>> = new Map();

  constructor(
    private messagesService: MessagesService,
    private jwtService: JwtService,
  ) {}

  private extractToken(client: Socket): string | null {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.trim()) {
      return authToken.replace(/^Bearer\s+/i, '');
    }
    const headerAuth = client.handshake.headers?.authorization;
    if (typeof headerAuth === 'string' && headerAuth.startsWith('Bearer ')) {
      return headerAuth.slice(7).trim();
    }
    const queryToken = client.handshake.query?.token;
    if (typeof queryToken === 'string' && queryToken.trim()) {
      return queryToken.replace(/^Bearer\s+/i, '');
    }
    return null;
  }

  handleConnection(client: Socket) {
    const token = this.extractToken(client);
    if (!token) {
      client.emit('error', { message: 'Authentication token required' });
      client.disconnect(true);
      return;
    }

    try {
      const payload = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET || 'secret-temporaire-dev',
        ignoreExpiration: true,
      });
      if (!payload?.sub || payload.pendingProfile) {
        client.disconnect(true);
        return;
      }
      client.data.userId = payload.sub;
      this.connectedUsers.set(payload.sub, client.id);
    } catch {
      client.emit('error', { message: 'Invalid JWT token' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data?.userId;
    if (userId && this.connectedUsers.get(userId) === client.id) {
      this.connectedUsers.delete(userId);
    }
  }

  @SubscribeMessage('join-offer')
  async handleJoinOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { offerId: string },
  ): Promise<void> {
    const userId = client.data?.userId;
    if (!userId || !data?.offerId) {
      client.emit('error', { message: 'Unauthorized or missing offerId' });
      return;
    }

    try {
      await this.messagesService.verifyParticipant(data.offerId, userId);
      const roomId = `offer-${data.offerId}`;
      client.join(roomId);

      this.server.to(roomId).emit('user-joined', {
        userId,
        timestamp: new Date(),
      });

      const messages = await this.messagesService.getOfferMessages(
        data.offerId,
        userId,
      );
      client.emit('chat-history', messages);
    } catch (error: any) {
      client.emit('error', {
        message: error?.message || 'Unable to join offer chat',
      });
    }
  }

  @SubscribeMessage('send-message')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { offerId: string; content: string },
  ): Promise<void> {
    const userId = client.data?.userId;
    if (!userId || !data?.offerId) {
      client.emit('error', { message: 'Unauthorized or missing offerId' });
      return;
    }

    const roomId = `offer-${data.offerId}`;
    if (!data.content || data.content.trim().length === 0) {
      client.emit('error', { message: 'Message cannot be empty' });
      return;
    }

    try {
      const message = await this.messagesService.createMessage(
        data.offerId,
        userId,
        data.content,
      );

      this.server.to(roomId).emit('message', {
        id: message.id,
        offerId: data.offerId,
        senderId: message.sender?.id || userId,
        senderName: message.sender?.displayName || 'Membre',
        content: message.content,
        createdAt: message.createdAt,
        timestamp: message.createdAt,
      });

      this.clearTypingIndicator(roomId, userId);
    } catch (error: any) {
      client.emit('error', {
        message: error?.message || 'Failed to send message',
      });
    }
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { offerId: string; isTyping: boolean },
  ): void {
    const userId = client.data?.userId;
    if (!userId || !data?.offerId) return;

    const roomId = `offer-${data.offerId}`;
    if (!this.typingUsers.has(roomId)) {
      this.typingUsers.set(roomId, new Set());
    }
    const typing = this.typingUsers.get(roomId)!;

    if (data.isTyping) {
      typing.add(userId);
    } else {
      typing.delete(userId);
    }

    this.server.to(roomId).emit('users-typing', {
      typingUsers: Array.from(typing),
      timestamp: new Date(),
    });
  }

  @SubscribeMessage('mark-read')
  async handleMarkRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { offerId: string },
  ): Promise<void> {
    const userId = client.data?.userId;
    if (!userId || !data?.offerId) return;

    try {
      await this.messagesService.markOfferMessagesAsRead(data.offerId, userId);
      const roomId = `offer-${data.offerId}`;
      this.server.to(roomId).emit('messages-read', {
        userId,
        timestamp: new Date(),
      });
    } catch (error: any) {
      client.emit('error', {
        message: error?.message || 'Failed to mark messages as read',
      });
    }
  }

  @SubscribeMessage('leave-offer')
  handleLeaveOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { offerId: string },
  ): void {
    const userId = client.data?.userId;
    if (!userId || !data?.offerId) return;

    const roomId = `offer-${data.offerId}`;
    client.leave(roomId);
    this.clearTypingIndicator(roomId, userId);

    this.server.to(roomId).emit('user-left', {
      userId,
      timestamp: new Date(),
    });
  }

  private clearTypingIndicator(roomId: string, userId: string): void {
    const typing = this.typingUsers.get(roomId);
    if (typing && typing.delete(userId)) {
      this.server.to(roomId).emit('users-typing', {
        typingUsers: Array.from(typing),
        timestamp: new Date(),
      });
    }
  }

  notifyUser(userId: string, event: string, data: any): void {
    const socketId = this.connectedUsers.get(userId);
    if (socketId) {
      this.server.to(socketId).emit(event, data);
    }
  }
}
