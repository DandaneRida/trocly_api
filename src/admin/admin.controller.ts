import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

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
}
