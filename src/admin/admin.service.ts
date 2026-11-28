import {
  Injectable,
  OnModuleInit,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { DataSource, Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { Listing, ListingStatus } from '../listings/listing.entity';
import { Offer, OfferStatus } from '../offers/offer.entity';
import { Meeting, MeetingStatus } from '../meetings/meeting.entity';
import { Review } from '../reviews/review.entity';
import { Report, ReportStatus } from '../reports/report.entity';

/**
 * E4 - Admin dashboard & Web Back-office moderation service
 */
@Injectable()
export class AdminService implements OnModuleInit {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Listing) private listingRepo: Repository<Listing>,
    @InjectRepository(Offer) private offerRepo: Repository<Offer>,
    @InjectRepository(Meeting) private meetingRepo: Repository<Meeting>,
    @InjectRepository(Review) private reviewRepo: Repository<Review>,
    @InjectRepository(Report) private reportRepo: Repository<Report>,
    private dataSource: DataSource,
    private jwtService: JwtService,
  ) {}

  async loginAdmin(email: string, password: string) {
    const expectedEmail = (process.env.ADMIN_EMAIL || 'admin@trocly.ma')
      .trim()
      .toLowerCase();
    const expectedPassword = (
      process.env.ADMIN_PASSWORD || 'TroclyAdmin2026!'
    ).trim();

    if (
      (email || '').trim().toLowerCase() !== expectedEmail ||
      (password || '').trim() !== expectedPassword
    ) {
      throw new UnauthorizedException('Identifiants administrateur invalides');
    }

    const accessToken = this.jwtService.sign(
      { sub: 'trocly-admin', role: 'admin', email: expectedEmail },
      { expiresIn: '24h' },
    );

    return {
      accessToken,
      admin: {
        email: expectedEmail,
        name: 'Administrateur Trocly',
        role: 'super_admin',
      },
    };
  }

  async onModuleInit() {
    await this.dataSource
      .query(`ALTER TYPE report_status ADD VALUE IF NOT EXISTS 'pending'`)
      .catch(() => {});
    await this.dataSource
      .query(`ALTER TYPE report_status ADD VALUE IF NOT EXISTS 'reviewed'`)
      .catch(() => {});
    await this.dataSource
      .query(`ALTER TYPE report_status ADD VALUE IF NOT EXISTS 'resolved'`)
      .catch(() => {});
    await this.dataSource
      .query(`
        ALTER TABLE reports
          ADD COLUMN IF NOT EXISTS reported_listing_id uuid,
          ADD COLUMN IF NOT EXISTS reported_user_id uuid,
          ADD COLUMN IF NOT EXISTS description text,
          ADD COLUMN IF NOT EXISTS admin_notes text;
      `)
      .catch(() => {});
  }

  /**
   * E4 - Get admin dashboard statistics
   */
  async getDashboardStats(): Promise<{
    users: {
      total: number;
      activeToday: number;
      newThisWeek: number;
    };
    listings: {
      total: number;
      active: number;
      exchanged: number;
    };
    offers: {
      total: number;
      pending: number;
      accepted: number;
      rejected: number;
    };
    meetings: {
      total: number;
      proposed: number;
      accepted: number;
      validated: number;
      cancelled: number;
    };
    reviews: {
      total: number;
      averageRating: number;
    };
    reports: {
      total: number;
      pending: number;
      resolved: number;
    };
  }> {
    // User stats
    const totalUsers = await this.userRepo.count();

    // Listing stats
    const totalListings = await this.listingRepo.count();
    const activeListings = await this.listingRepo.count({
      where: { status: ListingStatus.ACTIVE },
    });
    const exchangedListings = await this.listingRepo.count({
      where: { status: ListingStatus.EXCHANGED },
    });

    // Offer stats
    const totalOffers = await this.offerRepo.count();
    const pendingOffers = await this.offerRepo.count({
      where: { status: OfferStatus.PENDING },
    });
    const acceptedOffers = await this.offerRepo.count({
      where: { status: OfferStatus.ACCEPTED },
    });
    const rejectedOffers = await this.offerRepo.count({
      where: { status: OfferStatus.REJECTED },
    });

    // Meeting stats
    const totalMeetings = await this.meetingRepo.count();
    const proposedMeetings = await this.meetingRepo.count({
      where: { status: MeetingStatus.PROPOSED },
    });
    const acceptedMeetings = await this.meetingRepo.count({
      where: { status: MeetingStatus.ACCEPTED },
    });
    const validatedMeetings = await this.meetingRepo.count({
      where: { status: MeetingStatus.VALIDATED },
    });
    const cancelledMeetings = await this.meetingRepo.count({
      where: { status: MeetingStatus.CANCELLED },
    });

    // Review stats
    const totalReviews = await this.reviewRepo.count();
    const reviews = await this.reviewRepo.find();
    const averageRating =
      totalReviews > 0
        ? Math.round(
            (reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews) * 10,
          ) / 10
        : 0;

    // Report stats
    const totalReports = await this.reportRepo.count();
    const pendingReports = await this.reportRepo.count({
      where: { status: ReportStatus.PENDING },
    });
    const resolvedReports = await this.reportRepo.count({
      where: { status: ReportStatus.RESOLVED },
    });

    return {
      users: {
        total: totalUsers,
        activeToday: 0, // TODO: Track lastActivity
        newThisWeek: 0, // TODO: Track createdAt
      },
      listings: {
        total: totalListings,
        active: activeListings,
        exchanged: exchangedListings,
      },
      offers: {
        total: totalOffers,
        pending: pendingOffers,
        accepted: acceptedOffers,
        rejected: rejectedOffers,
      },
      meetings: {
        total: totalMeetings,
        proposed: proposedMeetings,
        accepted: acceptedMeetings,
        validated: validatedMeetings,
        cancelled: cancelledMeetings,
      },
      reviews: {
        total: totalReviews,
        averageRating,
      },
      reports: {
        total: totalReports,
        pending: pendingReports,
        resolved: resolvedReports,
      },
    };
  }

  /**
   * Get list of recent exchanges / meetings (all statuses for live monitor)
   */
  async getRecentExchanges(limit = 50): Promise<any[]> {
    return this.meetingRepo.find({
      relations: { initiator: true, responder: true },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Get list of reports (all or filtered by status)
   */
  async getReports(status?: ReportStatus, limit = 50): Promise<Report[]> {
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
   * Get list of pending reports (moderation queue)
   */
  async getPendingReports(limit = 20): Promise<Report[]> {
    return this.getReports(ReportStatus.PENDING, limit);
  }

  /**
   * Get all users with computed activity stats
   */
  async getAllUsers(search?: string, limit = 100): Promise<any[]> {
    const users = await this.userRepo.find({
      relations: { city: true, listings: true },
      take: limit,
    });
    const reviews = await this.reviewRepo.find({
      relations: { reviewee: true },
    });
    const meetings = await this.meetingRepo.find({
      where: { status: MeetingStatus.VALIDATED },
      relations: { initiator: true, responder: true },
    });

    const filtered = search
      ? users.filter((u) => {
          const q = search.toLowerCase();
          return (
            (u.displayName || '').toLowerCase().includes(q) ||
            (u.whatsappNumber || '').toLowerCase().includes(q) ||
            (u.city?.name || '').toLowerCase().includes(q)
          );
        })
      : users;

    return filtered.map((u) => {
      const userReviews = reviews.filter((r) => r.reviewee?.id === u.id);
      const avgRating =
        userReviews.length > 0
          ? Math.round(
              (userReviews.reduce((s, r) => s + r.rating, 0) /
                userReviews.length) *
                10,
            ) / 10
          : null;
      const exchanges = meetings.filter(
        (m) => m.initiator?.id === u.id || m.responder?.id === u.id,
      ).length;
      return {
        id: u.id,
        displayName: u.displayName,
        whatsappNumber: u.whatsappNumber,
        city: u.city?.name || 'Meknès',
        listingsCount: u.listings?.length || 0,
        activeListingsCount:
          u.listings?.filter((l) => l.status === ListingStatus.ACTIVE).length ||
          0,
        exchangesCount: exchanges,
        reviewsCount: userReviews.length,
        averageRating: avgRating,
      };
    });
  }

  /**
   * Get all listings for back-office moderation
   */
  async getAllListings(
    filters: { status?: string; category?: string; search?: string } = {},
    limit = 100,
  ): Promise<any[]> {
    const listings = await this.listingRepo.find({
      relations: { user: true, city: true },
      order: { createdAt: 'DESC' },
      take: limit,
    });

    return listings
      .filter((l) => {
        if (filters.status && filters.status !== 'all' && l.status !== filters.status) {
          return false;
        }
        if (
          filters.category &&
          filters.category !== 'all' &&
          l.category !== filters.category
        ) {
          return false;
        }
        if (filters.search) {
          const q = filters.search.toLowerCase();
          const match =
            (l.title || '').toLowerCase().includes(q) ||
            (l.description || '').toLowerCase().includes(q) ||
            (l.user?.displayName || '').toLowerCase().includes(q) ||
            (l.city?.name || '').toLowerCase().includes(q);
          if (!match) return false;
        }
        return true;
      })
      .map((l) => ({
        id: l.id,
        title: l.title,
        description: l.description,
        category: l.category,
        condition: l.condition,
        status: l.status,
        photos: l.photos || [],
        attributes: l.attributes || {},
        city: l.city?.name || 'Meknès',
        ownerName: l.user?.displayName || 'Membre',
        ownerPhone: l.user?.whatsappNumber || '',
        ownerId: l.user?.id || '',
        createdAt: l.createdAt,
      }));
  }

  async updateListingStatus(
    listingId: string,
    status: ListingStatus,
  ): Promise<Listing> {
    const listing = await this.listingRepo.findOne({ where: { id: listingId } });
    if (!listing) throw new NotFoundException('Annonce introuvable');
    listing.status = status;
    return this.listingRepo.save(listing);
  }

  /**
   * Get top users by exchanges & rating
   */
  async getTopUsers(limit = 10): Promise<any[]> {
    const all = await this.getAllUsers(undefined, 100);
    return all
      .sort(
        (a, b) =>
          b.exchangesCount * 3 +
          b.listingsCount -
          (a.exchangesCount * 3 + a.listingsCount),
      )
      .slice(0, limit);
  }

  /**
   * Live system diagnostics for the Web Admin Panel
   */
  async getSystemHealth() {
    const t0 = Date.now();
    await this.dataSource.query('SELECT 1');
    const dbLatencyMs = Date.now() - t0;

    return {
      status: 'healthy',
      dbLatencyMs,
      database: process.env.DATABASE_URL?.includes('neon.tech')
        ? 'Neon PostgreSQL Cloud (SSL)'
        : 'PostgreSQL',
      whatsappConfigured: Boolean(
        process.env.WHATSAPP_PHONE_NUMBER_ID &&
          process.env.WHATSAPP_ACCESS_TOKEN,
      ),
      fcmConfigured: Boolean(
        process.env.FIREBASE_PROJECT_ID ||
          process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
      ),
      cloudinaryConfigured: Boolean(
        process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_URL,
      ),
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get popular categories
   */
  async getPopularCategories(limit = 10): Promise<any[]> {
    const listings = await this.listingRepo.find();
    const categoryCount = new Map();

    for (const listing of listings) {
      categoryCount.set(
        listing.category,
        (categoryCount.get(listing.category) || 0) + 1,
      );
    }

    return Array.from(categoryCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([category, count]) => ({ category, count }));
  }

  async resolveReport(
    reportId: string,
    status: ReportStatus,
    archiveListing = false,
    adminNotes?: string,
  ): Promise<Report | null> {
    const report = await this.reportRepo.findOne({
      where: { id: reportId },
      relations: { reportedListing: true },
    });
    if (!report) return null;
    report.status = status;
    if (adminNotes !== undefined) {
      report.adminNotes = adminNotes;
    }
    await this.reportRepo.save(report);

    if (archiveListing && report.reportedListing?.id) {
      await this.listingRepo.update(report.reportedListing.id, {
        status: ListingStatus.ARCHIVED,
      });
    }
    return report;
  }
}
