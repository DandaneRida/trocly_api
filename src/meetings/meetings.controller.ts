import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  Request,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { MeetingsService } from './meetings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('meetings')
@UseGuards(JwtAuthGuard)
export class MeetingsController {
  constructor(private meetingsService: MeetingsService) {}

  /**
   * D1 - Propose a meeting (place + time slot)
   * POST /meetings
   */
  @Post()
  async createMeeting(
    @Body()
    body: {
      offerId: string;
      responderId?: string;
      proposedLocation: string;
      scheduledAt: string;
    },
    @Request() req: any,
  ) {
    if (!body.offerId || !body.proposedLocation || !body.scheduledAt) {
      throw new BadRequestException(
        'offerId, proposedLocation et scheduledAt sont requis',
      );
    }
    return this.meetingsService.createMeeting(
      body.offerId,
      req.user.sub,
      body.proposedLocation,
      new Date(body.scheduledAt),
      body.responderId,
    );
  }

  /**
   * List authenticated user's meetings
   * GET /meetings/my-meetings
   */
  @Get('my-meetings')
  async getMyMeetings(@Request() req: any) {
    return this.meetingsService.getMyMeetings(req.user.sub);
  }

  /**
   * List meetings for an offer
   * GET /meetings/offer/:offerId
   */
  @Get('offer/:offerId')
  async getOfferMeetings(@Param('offerId') offerId: string, @Request() req: any) {
    return this.meetingsService.getMeetingsByOffer(offerId, req.user.sub);
  }

  /**
   * D2 - Accept a proposed meeting and generate QR payloads
   * POST /meetings/:id/accept
   */
  @Post(':id/accept')
  async acceptMeeting(@Param('id') meetingId: string, @Request() req: any) {
    return this.meetingsService.acceptMeeting(meetingId, req.user.sub);
  }

  /**
   * D3 - Scan partner QR code
   * POST /meetings/qr/scan
   */
  @Post('qr/scan')
  async scanQRCode(@Body() body: { payload: string }, @Request() req: any) {
    if (!body?.payload) {
      throw new BadRequestException('payload QR requis');
    }
    return this.meetingsService.scanQRCode(body.payload, req.user.sub);
  }

  /**
   * Get meeting details
   * GET /meetings/:id
   */
  @Get(':id')
  async getMeeting(@Param('id') meetingId: string) {
    const meeting = await this.meetingsService.getMeeting(meetingId);
    if (!meeting) throw new NotFoundException('Rendez-vous introuvable');
    return meeting;
  }
}
