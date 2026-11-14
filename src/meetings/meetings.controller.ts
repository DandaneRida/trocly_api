import { Controller, Post, Get, Param, Body, BadRequestException } from '@nestjs/common';
import { MeetingsService } from './meetings.service';

@Controller('meetings')
export class MeetingsController {
  constructor(private meetingsService: MeetingsService) {}

  /**
   * Create a meeting (after offer accepted)
   * POST /meetings
   */
  @Post()
  async createMeeting(
    @Body()
    body: {
      offerId: string;
      initiatorId: string;
      responderId: string;
      proposedLocation: string;
      scheduledAt: string;
    },
  ) {
    return await this.meetingsService.createMeeting(
      body.offerId,
      body.initiatorId,
      body.responderId,
      body.proposedLocation,
      new Date(body.scheduledAt),
    );
  }

  /**
   * Accept a proposed meeting and get QR codes
   * POST /meetings/:id/accept
   */
  @Post(':id/accept')
  async acceptMeeting(@Param('id') meetingId: string) {
    return await this.meetingsService.acceptMeeting(meetingId);
  }

  /**
   * SINGLE-SCAN QR code validation endpoint
   * One scan validates the entire meeting
   * POST /meetings/qr/scan
   */
  @Post('qr/scan')
  async scanQRCode(
    @Body() body: { payload: string; scannedByUserId: string },
  ) {
    if (!body.payload || !body.scannedByUserId) {
      throw new BadRequestException('Missing payload or scannedByUserId');
    }
    return await this.meetingsService.scanQRCode(body.payload, body.scannedByUserId);
  }

  /**
   * Get meeting details
   * GET /meetings/:id
   */
  @Get(':id')
  async getMeeting(@Param('id') meetingId: string) {
    const meeting = await this.meetingsService.getMeeting(meetingId);
    if (!meeting) throw new BadRequestException('Meeting not found');
    return meeting;
  }
}
