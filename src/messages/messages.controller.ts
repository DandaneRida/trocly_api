import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { MessagesService } from './messages.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private messagesService: MessagesService) {}

  /**
   * C4 - Get paginated chat history for an offer
   * GET /messages/offer/:offerId?page=1&limit=50
   */
  @Get('offer/:offerId')
  async getOfferMessages(
    @Param('offerId') offerId: string,
    @Request() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.messagesService.getOfferMessages(
      offerId,
      req.user.sub,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  /**
   * C4 - REST fallback to send a message on an offer
   * POST /messages/offer/:offerId
   */
  @Post('offer/:offerId')
  async sendMessage(
    @Param('offerId') offerId: string,
    @Body() body: { content: string },
    @Request() req: any,
  ) {
    return this.messagesService.createMessage(
      offerId,
      req.user.sub,
      body.content,
    );
  }

  /**
   * C4 - Mark messages in an offer as read
   * PATCH /messages/offer/:offerId/read
   */
  @Patch('offer/:offerId/read')
  async markOfferRead(@Param('offerId') offerId: string, @Request() req: any) {
    const marked = await this.messagesService.markOfferMessagesAsRead(
      offerId,
      req.user.sub,
    );
    return { marked };
  }

  /**
   * Get unread messages for authenticated user
   * GET /messages/unread
   */
  @Get('unread')
  async getUnreadMessages(@Request() req: any) {
    return this.messagesService.getUnreadMessages(req.user.sub);
  }

  /**
   * Get unread count for authenticated user
   * GET /messages/unread/count
   */
  @Get('unread/count')
  async getUnreadCount(@Request() req: any) {
    const count = await this.messagesService.getUnreadCount(req.user.sub);
    return { unreadCount: count };
  }

  /**
   * Get recent conversations (offers with messages)
   * GET /messages/conversations
   */
  @Get('conversations')
  async getRecentConversations(
    @Request() req: any,
    @Query('limit') limit?: string,
  ) {
    return this.messagesService.getRecentConversations(
      req.user.sub,
      limit ? parseInt(limit, 10) : 30,
    );
  }

  /**
   * Delete a message (sender only)
   * DELETE /messages/:id
   */
  @Delete(':id')
  async deleteMessage(@Param('id') messageId: string, @Request() req: any) {
    return this.messagesService.deleteMessage(messageId, req.user.sub);
  }
}
