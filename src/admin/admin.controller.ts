import { Controller, Get } from '@nestjs/common';
import { AdminService } from './admin.service';

@Controller('admin')
export class AdminController {
  constructor(private adminService: AdminService) {}

  /**
   * E4 - Get admin dashboard statistics
   * GET /admin/dashboard
   */
  @Get('dashboard')
  async getDashboard() {
    return this.adminService.getDashboardStats();
  }

  /**
   * Get recent exchanges (validated meetings)
   * GET /admin/exchanges
   */
  @Get('exchanges')
  async getRecentExchanges() {
    return this.adminService.getRecentExchanges(20);
  }

  /**
   * Get pending reports (moderation queue)
   * GET /admin/pending-reports
   */
  @Get('pending-reports')
  async getPendingReports() {
    return this.adminService.getPendingReports(20);
  }

  /**
   * Get top users by rating
   * GET /admin/top-users
   */
  @Get('top-users')
  async getTopUsers() {
    return this.adminService.getTopUsers(10);
  }

  /**
   * Get popular categories
   * GET /admin/popular-categories
   */
  @Get('popular-categories')
  async getPopularCategories() {
    return this.adminService.getPopularCategories(10);
  }
}
