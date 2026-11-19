import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  @Get()
  async getMyNotifications(@Request() req: any, @Query('limit') limit?: string) {
    return this.notificationsService.getUserNotifications(
      req.user.sub,
      limit ? parseInt(limit, 10) : 40,
    );
  }

  @Get('unread-count')
  async getUnreadCount(@Request() req: any) {
    const unreadCount = await this.notificationsService.getUnreadCount(
      req.user.sub,
    );
    return { unreadCount };
  }

  @Patch('read-all')
  async markAllAsRead(@Request() req: any) {
    return this.notificationsService.markAllAsRead(req.user.sub);
  }

  @Patch(':id/read')
  async markAsRead(@Param('id') id: string, @Request() req: any) {
    return this.notificationsService.markAsRead(id, req.user.sub);
  }

  @Post('device-token')
  async registerDeviceToken(
    @Body() body: { token: string; platform?: string },
    @Request() req: any,
  ) {
    if (!body?.token) {
      throw new BadRequestException('FCM token requis');
    }
    return this.notificationsService.registerDeviceToken(
      req.user.sub,
      body.token,
      body.platform || 'unknown',
    );
  }
}
