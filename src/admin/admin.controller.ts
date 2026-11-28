import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ReportStatus } from '../reports/report.entity';
import { ListingStatus } from '../listings/listing.entity';

@Controller('admin')
export class AdminController {
  constructor(private adminService: AdminService) {}

  /**
   * Web Admin Panel login (email + password -> signed JWT)
   */
  @Post('login')
  async adminLogin(@Body() body: { email: string; password: string }) {
    return this.adminService.loginAdmin(body?.email, body?.password);
  }

  @UseGuards(JwtAuthGuard)
  @Get('dashboard')
  async getDashboard() {
    return this.adminService.getDashboardStats();
  }

  @UseGuards(JwtAuthGuard)
  @Get('system-health')
  async getSystemHealth() {
    return this.adminService.getSystemHealth();
  }

  @UseGuards(JwtAuthGuard)
  @Get('users')
  async getUsers(@Query('search') search?: string) {
    return this.adminService.getAllUsers(search, 200);
  }

  @UseGuards(JwtAuthGuard)
  @Get('listings')
  async getListings(
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('search') search?: string,
  ) {
    return this.adminService.getAllListings({ status, category, search }, 200);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('listings/:id/status')
  async updateListingStatus(
    @Param('id') id: string,
    @Body() body: { status: ListingStatus },
  ) {
    return this.adminService.updateListingStatus(id, body.status);
  }

  @UseGuards(JwtAuthGuard)
  @Get('exchanges')
  async getRecentExchanges() {
    return this.adminService.getRecentExchanges(50);
  }

  @UseGuards(JwtAuthGuard)
  @Get('reports')
  async getReports(@Query('status') status?: ReportStatus) {
    return this.adminService.getReports(status, 100);
  }

  @UseGuards(JwtAuthGuard)
  @Get('pending-reports')
  async getPendingReports() {
    return this.adminService.getPendingReports(50);
  }

  @UseGuards(JwtAuthGuard)
  @Get('top-users')
  async getTopUsers() {
    return this.adminService.getTopUsers(10);
  }

  @UseGuards(JwtAuthGuard)
  @Get('popular-categories')
  async getPopularCategories() {
    return this.adminService.getPopularCategories(10);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('reports/:id/resolve')
  async resolveReport(
    @Param('id') reportId: string,
    @Body()
    body: {
      status?: ReportStatus;
      archiveListing?: boolean;
      adminNotes?: string;
    },
  ) {
    return this.adminService.resolveReport(
      reportId,
      body?.status || ReportStatus.RESOLVED,
      body?.archiveListing === true,
      body?.adminNotes,
    );
  }
}
