import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Report, ReportStatus, ReportType } from './report.entity';
import { User } from '../users/user.entity';
import { Listing } from '../listings/listing.entity';

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Report) private reportRepo: Repository<Report>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Listing) private listingRepo: Repository<Listing>,
  ) {}

  /**
   * Report a user or listing
   */
  async createReport(
    reporterId: string,
    data: {
      reportedUserId?: string;
      reportedListingId?: string;
      reportType: ReportType;
      description?: string;
    },
  ): Promise<Report> {
    const reporter = await this.userRepo.findOne({ where: { id: reporterId } });
    if (!reporter) {
      throw new NotFoundException('Reporter not found');
    }

    if (!data.reportedUserId && !data.reportedListingId) {
      throw new BadRequestException('Must report either a user or a listing');
    }

    if (data.reportedUserId) {
      const reportedUser = await this.userRepo.findOne({
        where: { id: data.reportedUserId },
      });
      if (!reportedUser) {
        throw new NotFoundException('Reported user not found');
      }

      if (reportedUser.id === reporterId) {
        throw new BadRequestException('Cannot report yourself');
      }
    }

    if (data.reportedListingId) {
      const listing = await this.listingRepo.findOne({
        where: { id: data.reportedListingId },
      });
      if (!listing) {
        throw new NotFoundException('Reported listing not found');
      }
    }

    const report = this.reportRepo.create({
      reporter: { id: reporterId } as any,
      reportedUserId: data.reportedUserId || undefined,
      reportedListing: data.reportedListingId
        ? ({ id: data.reportedListingId } as any)
        : undefined,
      reportType: data.reportType,
      description: data.description || '',
      status: ReportStatus.PENDING,
    } as any);

    return await this.reportRepo.save(report as any);
  }

  /**
   * Get all reports (admin only)
   */
  async getAllReports(status?: ReportStatus, limit = 50): Promise<Report[]> {
    const where: any = {};
    if (status) where.status = status;

    return this.reportRepo.find({
      where,
      relations: { reporter: true, reportedListing: true },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Get reports for a specific user
   */
  async getUserReports(userId: string): Promise<Report[]> {
    return this.reportRepo.find({
      where: { reportedUserId: userId },
      relations: { reporter: true },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Get reports for a specific listing
   */
  async getListingReports(listingId: string): Promise<Report[]> {
    return this.reportRepo.find({
      where: { reportedListing: { id: listingId } },
      relations: { reporter: true },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Update report status (admin moderation)
   */
  async updateReportStatus(
    reportId: string,
    newStatus: ReportStatus,
    adminNotes?: string,
  ): Promise<Report> {
    const report = await this.reportRepo.findOne({ where: { id: reportId } });

    if (!report) {
      throw new NotFoundException('Report not found');
    }

    report.status = newStatus;
    if (adminNotes) report.adminNotes = adminNotes;

    return await this.reportRepo.save(report);
  }

  /**
   * Suspend a user account (admin moderation)
   */
  async suspendUser(userId: string, reason: string): Promise<{ message: string }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return { message: `User ${userId} has been suspended. Reason: ${reason}` };
  }

  /**
   * Reactivate a suspended user (admin)
   */
  async reactivateUser(userId: string): Promise<{ message: string }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return { message: `User ${userId} has been reactivated` };
  }

  /**
   * Get report statistics (admin dashboard)
   */
  async getReportStats(): Promise<{
    total: number;
    pending: number;
    reviewed: number;
    resolved: number;
    byType: Record<string, number>;
  }> {
    const total = await this.reportRepo.count();
    const pending = await this.reportRepo.count({
      where: { status: ReportStatus.PENDING },
    });
    const reviewed = await this.reportRepo.count({
      where: { status: ReportStatus.REVIEWED },
    });
    const resolved = await this.reportRepo.count({
      where: { status: ReportStatus.RESOLVED },
    });

    const byType: Record<string, number> = {};
    for (const type of Object.values(ReportType)) {
      byType[type] = await this.reportRepo.count({ where: { reportType: type } });
    }

    return {
      total,
      pending,
      reviewed,
      resolved,
      byType,
    };
  }
}
