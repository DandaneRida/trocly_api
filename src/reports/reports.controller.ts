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
import { ReportsService } from './reports.service';
import { ReportType, ReportStatus } from './report.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  /**
   * E2 - Report a user or listing (JWT authenticated)
   * POST /reports
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
    @Request() req: any,
  ) {
    return this.reportsService.createReport(req.user.sub, body);
  }

  /**
   * E3 - Get all reports (moderation)
   * GET /reports?status=pending&limit=50
   */
  @Get()
  async getAllReports(
    @Query('status') status?: ReportStatus,
    @Query('limit') limit?: string,
  ) {
    return this.reportsService.getAllReports(
      status,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  @Get('user/:userId')
  async getUserReports(@Param('userId') userId: string) {
    return this.reportsService.getUserReports(userId);
  }

  @Get('listing/:listingId')
  async getListingReports(@Param('listingId') listingId: string) {
    return this.reportsService.getListingReports(listingId);
  }

  /**
   * E3 - Update report status (admin moderation)
   */
  @Patch(':id/status')
  async updateReportStatus(
    @Param('id') reportId: string,
    @Body('status') status: ReportStatus,
    @Body('adminNotes') adminNotes?: string,
  ) {
    if (!Object.values(ReportStatus).includes(status)) {
      throw new BadRequestException('Statut invalide');
    }
    return this.reportsService.updateReportStatus(reportId, status, adminNotes);
  }

  /**
   * E3 - Suspend user (admin moderation)
   */
  @Post('admin/suspend/:userId')
  async suspendUser(
    @Param('userId') userId: string,
    @Body('reason') reason?: string,
  ) {
    return this.reportsService.suspendUser(
      userId,
      reason || 'Violation des règles Trocly',
    );
  }

  /**
   * E3 - Reactivate user (admin)
   */
  @Post('admin/reactivate/:userId')
  async reactivateUser(@Param('userId') userId: string) {
    return this.reportsService.reactivateUser(userId);
  }

  /**
   * E4 - Get report statistics
   */
  @Get('admin/stats')
  async getReportStats() {
    return this.reportsService.getReportStats();
  }
}
