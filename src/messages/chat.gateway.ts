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
import { Server, Socket } from 'socket.io';
import { MessagesService } from './messages.service';

/**
 * C4 - Real-time chat via WebSocket
 * Users can chat in the context of an offer
 * Events:
 * - join-offer: Join offer chat room
 * - send-message: Send message (persisted + broadcast)
 * - message: Receive message
 * - typing: User typing indicator
 */
@WebSocketGateway({
  cors: { origin: '*', credentials: true },
})
@Injectable()
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  // Map of connected users: userId -> socket.id
  private connectedUsers: Map<string, string> = new Map();

  // Map of user typing status: offerId -> Set<userId>
  private typingUsers: Map<string, Set<string>> = new Map();

  constructor(private messagesService: MessagesService) {}

  /**
   * Handle client connection
   */
  handleConnection(client: Socket) {
    console.log(`[WebSocket] Client connected: ${client.id}`);
  }

  /**
   * Handle client disconnect
   */
  handleDisconnect(client: Socket) {
    console.log(`[WebSocket] Client disconnected: ${client.id}`);

    // Remove from connected users
    for (const [userId, socketId] of this.connectedUsers.entries()) {
      if (socketId === client.id) {
        this.connectedUsers.delete(userId);
        break;
      }
    }
  }

  /**
   * User joins offer chat room
   * Event: 'join-offer'
   * Data: { userId, offerId }
   */
  @SubscribeMessage('join-offer')
  async handleJoinOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string; offerId: string },
  ): Promise<void> {
    const roomId = `offer-${data.offerId}`;

    // Store user connection
    this.connectedUsers.set(data.userId, client.id);

    // Join Socket.io room
    client.join(roomId);

    console.log(`[Chat] User ${data.userId} joined offer ${data.offerId}`);

    // Notify others in room that user joined
    this.server.to(roomId).emit('user-joined', {
      userId: data.userId,
      timestamp: new Date(),
    });

    // Send chat history to joining user
    const messages = await this.messagesService.getOfferMessages(data.offerId);
    client.emit('chat-history', messages);
  }

  /**
   * Send message in offer chat
   * Event: 'send-message'
   * Data: { userId, offerId, content }
   */
  @SubscribeMessage('send-message')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string; offerId: string; content: string },
  ): Promise<void> {
    const roomId = `offer-${data.offerId}`;

    // Validate message
    if (!data.content || data.content.trim().length === 0) {
      client.emit('error', { message: 'Message cannot be empty' });
      return;
    }

    try {
      // Save message to database
      const message = await this.messagesService.createMessage(
        data.offerId,
        data.userId,
        data.content,
      );

      // Broadcast message to all users in room
      this.server.to(roomId).emit('message', {
        id: message.id,
        senderId: message.sender.id,
        senderName: message.sender.displayName,
        content: message.content,
        timestamp: message.createdAt,
      });

      // Clear typing indicator
      this.clearTypingIndicator(roomId, data.userId);
    } catch (error) {
      client.emit('error', { message: 'Failed to send message' });
    }
  }

  /**
   * User typing indicator
   * Event: 'typing'
   * Data: { userId, offerId, isTyping }
   */
  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string; offerId: string; isTyping: boolean },
  ): void {
    const roomId = `offer-${data.offerId}`;

    if (!this.typingUsers.has(roomId)) {
      this.typingUsers.set(roomId, new Set());
    }

    const typing = this.typingUsers.get(roomId)!;

    if (data.isTyping) {
      typing.add(data.userId);
    } else {
      typing.delete(data.userId);
    }

    // Broadcast typing users
    this.server.to(roomId).emit('users-typing', {
      typingUsers: Array.from(typing || new Set()),
      timestamp: new Date(),
    });
  }

  /**
   * Mark message as read
   * Event: 'mark-read'
   * Data: { userId, offerId }
   */
  @SubscribeMessage('mark-read')
  async handleMarkRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string; offerId: string },
  ): Promise<void> {
    try {
      await this.messagesService.markOfferMessagesAsRead(data.offerId, data.userId);

      const roomId = `offer-${data.offerId}`;
      this.server.to(roomId).emit('messages-read', {
        userId: data.userId,
        timestamp: new Date(),
      });
    } catch (error) {
      client.emit('error', { message: 'Failed to mark messages as read' });
    }
  }

  /**
   * Leave offer chat room
   * Event: 'leave-offer'
   * Data: { userId, offerId }
   */
  @SubscribeMessage('leave-offer')
  handleLeaveOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string; offerId: string },
  ): void {
    const roomId = `offer-${data.offerId}`;
    client.leave(roomId);
    this.connectedUsers.delete(data.userId);

    console.log(`[Chat] User ${data.userId} left offer ${data.offerId}`);

    this.server.to(roomId).emit('user-left', {
      userId: data.userId,
      timestamp: new Date(),
    });
  }

  /**
   * Private helper: Clear typing indicator
   */
  private clearTypingIndicator(roomId: string, userId: string): void {
    const typing = this.typingUsers.get(roomId);
    if (typing) {
      typing.delete(userId);
      this.server.to(roomId).emit('users-typing', {
        typingUsers: Array.from(typing),
        timestamp: new Date(),
      });
    }
  }

  /**
   * Emit notification to specific user (offline support via Redis later)
   */
  notifyUser(userId: string, event: string, data: any): void {
    const socketId = this.connectedUsers.get(userId);
    if (socketId) {
      this.server.to(socketId).emit(event, data);
    }
  }
}
