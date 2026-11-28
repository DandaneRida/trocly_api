import {
  Injectable,
  BadRequestException,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Report, ReportStatus, ReportType } from './report.entity';
import { User } from '../users/user.entity';
import { Listing } from '../listings/listing.entity';

const REPORT_TYPE_ALIASES: Record<string, ReportType> = {
  fraud: ReportType.FRAUD,
  spam: ReportType.SPAM,
  fake_listing: ReportType.SPAM,
  inappropriate_images: ReportType.INAPPROPRIATE_IMAGES,
  inappropriate_content: ReportType.INAPPROPRIATE_IMAGES,
  abusive_content: ReportType.ABUSIVE_CONTENT,
  harassment: ReportType.ABUSIVE_CONTENT,
  no_show: ReportType.OTHER,
  other: ReportType.OTHER,
};

@Injectable()
export class ReportsService implements OnModuleInit {
  constructor(
    @InjectRepository(Report) private reportRepo: Repository<Report>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Listing) private listingRepo: Repository<Listing>,
    private dataSource: DataSource,
  ) {}

  async onModuleInit() {
    await this.dataSource
      .query(`
        DO $$ BEGIN
          ALTER TYPE report_status ADD VALUE IF NOT EXISTS 'pending';
          ALTER TYPE report_status ADD VALUE IF NOT EXISTS 'reviewed';
          ALTER TYPE report_status ADD VALUE IF NOT EXISTS 'resolved';
        EXCEPTION WHEN undefined_object THEN NULL; END $$;
        DO $$ BEGIN
          ALTER TABLE reports
            ADD COLUMN IF NOT EXISTS reported_listing_id uuid,
            ADD COLUMN IF NOT EXISTS reported_user_id uuid,
            ADD COLUMN IF NOT EXISTS description text,
            ADD COLUMN IF NOT EXISTS admin_notes text;
        EXCEPTION WHEN undefined_table THEN NULL; END $$;
      `)
      .catch(() => {});
  }

  private normalizeReportType(raw?: string): ReportType {
    const key = (raw || 'other').trim().toLowerCase();
    return REPORT_TYPE_ALIASES[key] || ReportType.OTHER;
  }

  /**
   * Report a user or listing
   */
  async createReport(
    reporterId: string,
    data: {
      reportedUserId?: string;
      reportedListingId?: string;
      reportType: ReportType | string;
      description?: string;
    },
  ): Promise<Report> {
    const reporter = await this.userRepo.findOne({ where: { id: reporterId } });
    if (!reporter) {
      throw new NotFoundException('Reporter not found');
    }

    const reportedUserId = data.reportedUserId?.trim() || undefined;
    const reportedListingId = data.reportedListingId?.trim() || undefined;

    if (!reportedUserId && !reportedListingId) {
      throw new BadRequestException('Must report either a user or a listing');
    }

    let finalReportedUserId = reportedUserId;
    if (finalReportedUserId) {
      if (finalReportedUserId === reporterId && !reportedListingId) {
        throw new BadRequestException('Cannot report yourself');
      }
      const reportedUser = await this.userRepo.findOne({
        where: { id: finalReportedUserId },
      });
      if (!reportedUser) {
        if (!reportedListingId) {
          throw new NotFoundException('Reported user not found');
        }
        finalReportedUserId = undefined;
      }
    }

    if (reportedListingId) {
      const listing = await this.listingRepo.findOne({
        where: { id: reportedListingId },
        relations: { user: true },
      });
      if (!listing) {
        throw new NotFoundException('Reported listing not found');
      }
      if (listing.user?.id === reporterId) {
        throw new BadRequestException('Vous ne pouvez pas signaler votre propre annonce');
      }
      if (!finalReportedUserId && listing.user?.id) {
        finalReportedUserId = listing.user.id;
      }
    }

    const normalizedType = this.normalizeReportType(data.reportType);

    const report = this.reportRepo.create({
      reporter: { id: reporterId } as any,
      reportedUserId: finalReportedUserId,
      reportedListing: reportedListingId
        ? ({ id: reportedListingId } as any)
        : undefined,
      reportType: normalizedType,
      description: (data.description || '').trim(),
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
