import { Controller, Get, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ReportStatus } from '../reports/report.entity';

@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminController {
  constructor(private adminService: AdminService) {}

  /**
   * E4 - Back-office minimal statistiques
   */
  @Get('dashboard')
  async getDashboard() {
    return this.adminService.getDashboardStats();
  }

  @Get('exchanges')
  async getRecentExchanges() {
    return this.adminService.getRecentExchanges(20);
  }

  @Get('pending-reports')
  async getPendingReports() {
    return this.adminService.getPendingReports(20);
  }

  @Get('top-users')
  async getTopUsers() {
    return this.adminService.getTopUsers(10);
  }

  @Get('popular-categories')
  async getPopularCategories() {
    return this.adminService.getPopularCategories(10);
  }

  @Patch('reports/:id/resolve')
  async resolveReport(
    @Param('id') reportId: string,
    @Body() body: { status?: ReportStatus; archiveListing?: boolean },
  ) {
    return this.adminService.resolveReport(
      reportId,
      body?.status || ReportStatus.RESOLVED,
      body?.archiveListing === true,
    );
  }
}
