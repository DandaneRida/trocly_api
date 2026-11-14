import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { Listing, ListingStatus } from '../listings/listing.entity';
import { Offer, OfferStatus } from '../offers/offer.entity';
import { Meeting, MeetingStatus } from '../meetings/meeting.entity';
import { Review } from '../reviews/review.entity';
import { Report, ReportStatus } from '../reports/report.entity';

/**
 * E4 - Admin dashboard with statistics
 */
@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Listing) private listingRepo: Repository<Listing>,
    @InjectRepository(Offer) private offerRepo: Repository<Offer>,
    @InjectRepository(Meeting) private meetingRepo: Repository<Meeting>,
    @InjectRepository(Review) private reviewRepo: Repository<Review>,
    @InjectRepository(Report) private reportRepo: Repository<Report>,
  ) {}

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
   * Get list of recent exchanges (meetings validated)
   */
  async getRecentExchanges(limit = 20): Promise<any[]> {
    return this.meetingRepo.find({
      where: { status: MeetingStatus.VALIDATED },
      relations: { initiator: true, responder: true },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Get list of pending reports (moderation queue)
   */
  async getPendingReports(limit = 20): Promise<Report[]> {
    return this.reportRepo.find({
      where: { status: ReportStatus.PENDING },
      relations: { reporter: true, reportedListing: true },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Get top users by rating
   */
  async getTopUsers(limit = 10): Promise<any[]> {
    // TODO: Implement with proper query
    return [];
  }

  /**
   * Get popular categories
   */
  async getPopularCategories(limit = 10): Promise<any[]> {
    // TODO: Implement with proper query
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
}
