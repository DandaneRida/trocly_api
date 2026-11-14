import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { MessagesService } from './messages.service';

@Controller('messages')
export class MessagesController {
  constructor(private messagesService: MessagesService) {}

  /**
   * Get chat history for an offer
   * GET /messages/offer/:offerId
   */
  @Get('offer/:offerId')
  async getOfferMessages(@Param('offerId') offerId: string) {
    return this.messagesService.getOfferMessages(offerId);
  }

  /**
   * Get unread messages for user
   * GET /messages/unread
   */
  @Get('unread')
  async getUnreadMessages(@Query('userId') userId?: string) {
    if (!userId) throw new BadRequestException('userId required');
    return this.messagesService.getUnreadMessages(userId);
  }

  /**
   * Get unread count for user
   * GET /messages/unread/count
   */
  @Get('unread/count')
  async getUnreadCount(@Query('userId') userId?: string) {
    if (!userId) throw new BadRequestException('userId required');
    const count = await this.messagesService.getUnreadCount(userId);
    return { unreadCount: count };
  }

  /**
   * Get recent conversations (offers with messages)
   * GET /messages/conversations
   */
  @Get('conversations')
  async getRecentConversations(
    @Query('userId') userId?: string,
    @Query('limit') limit?: string,
  ) {
    if (!userId) throw new BadRequestException('userId required');
    return this.messagesService.getRecentConversations(
      userId,
      limit ? parseInt(limit) : 10,
    );
  }

  /**
   * Delete a message
   * DELETE /messages/:id
   */
  @Delete(':id')
  async deleteMessage(
    @Param('id') messageId: string,
    @Query('userId') userId?: string,
  ) {
    if (!userId) throw new BadRequestException('userId required');
    return this.messagesService.deleteMessage(messageId, userId);
  }
}
