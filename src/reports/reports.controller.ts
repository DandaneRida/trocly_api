import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportType, ReportStatus } from './report.entity';

@Controller('reports')
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  /**
   * E2 - Report a user or listing
   * POST /reports
   * Body: { reportedUserId?, reportedListingId?, reportType, description? }
   */
  @Post()
  async createReport(
    @Body()
    body: {
      reportedUserId?: string;
      reportedListingId?: string;
      reportType: ReportType;
      description?: string;
    },
    @Query('reporterId') reporterId?: string,
  ) {
    if (!reporterId) throw new BadRequestException('reporterId required');
    return this.reportsService.createReport(reporterId, body);
  }

  /**
   * Get all reports (admin only)
   * GET /reports?status=pending&limit=50
   */
  @Get()
  async getAllReports(
    @Query('status') status?: ReportStatus,
    @Query('limit') limit?: string,
  ) {
    return this.reportsService.getAllReports(status, limit ? parseInt(limit) : 50);
  }

  /**
   * Get reports for a user (admin)
   * GET /reports/user/:userId
   */
  @Get('user/:userId')
  async getUserReports(@Param('userId') userId: string) {
    return this.reportsService.getUserReports(userId);
  }

  /**
   * Get reports for a listing (admin)
   * GET /reports/listing/:listingId
   */
  @Get('listing/:listingId')
  async getListingReports(@Param('listingId') listingId: string) {
    return this.reportsService.getListingReports(listingId);
  }

  /**
   * E3 - Update report status (admin moderation)
   * PATCH /reports/:id/status
   */
  @Patch(':id/status')
  async updateReportStatus(
    @Param('id') reportId: string,
    @Body('status') status: ReportStatus,
    @Body('adminNotes') adminNotes?: string,
  ) {
    if (!Object.values(ReportStatus).includes(status)) {
      throw new BadRequestException('Invalid status');
    }
    return this.reportsService.updateReportStatus(reportId, status, adminNotes);
  }

  /**
   * E3 - Suspend user (admin moderation)
   * POST /reports/admin/suspend/:userId
   */
  @Post('admin/suspend/:userId')
  async suspendUser(
    @Param('userId') userId: string,
    @Body('reason') reason?: string,
  ) {
    return this.reportsService.suspendUser(userId, reason || 'Policy violation');
  }

  /**
   * E3 - Reactivate user (admin)
   * POST /reports/admin/reactivate/:userId
   */
  @Post('admin/reactivate/:userId')
  async reactivateUser(@Param('userId') userId: string) {
    return this.reportsService.reactivateUser(userId);
  }

  /**
   * E4 - Get report statistics (admin dashboard)
   * GET /reports/admin/stats
   */
  @Get('admin/stats')
  async getReportStats() {
    return this.reportsService.getReportStats();
  }
}
