import {
  Injectable,
  OnModuleInit,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Review } from './review.entity';
import { Meeting, MeetingStatus } from '../meetings/meeting.entity';
import { User } from '../users/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';

@Injectable()
export class ReviewsService implements OnModuleInit {
  constructor(
    @InjectRepository(Review) private reviewRepo: Repository<Review>,
    @InjectRepository(Meeting) private meetingRepo: Repository<Meeting>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private dataSource: DataSource,
    private notificationsService: NotificationsService,
  ) {}

  async onModuleInit() {
    await this.dataSource.query(`
      ALTER TABLE reviews
        ADD COLUMN IF NOT EXISTS tags jsonb,
        ADD COLUMN IF NOT EXISTS is_revealed boolean NOT NULL DEFAULT false;
    `);
  }

  /**
   * D5 - Post a mutual review after double-scan QR validation.
   * Blind reveal: reviews become visible once both sides submit (or after 7 days).
   */
  async createReview(
    meetingId: string,
    reviewerId: string,
    data: {
      rating: number;
      comment?: string;
      tags?: string[];
    },
  ): Promise<Review> {
    const meeting = await this.meetingRepo.findOne({
      where: { id: meetingId },
      relations: { initiator: true, responder: true },
    });

    if (!meeting) throw new NotFoundException('Rendez-vous introuvable');
    if (
      meeting.status !== MeetingStatus.VALIDATED &&
      meeting.status !== MeetingStatus.COMPLETED
    ) {
      throw new BadRequestException(
        'Vous ne pouvez évaluer qu\'un échange validé par QR',
      );
    }

    const isParticipant =
      meeting.initiator?.id === reviewerId ||
      meeting.responder?.id === reviewerId;
    if (!isParticipant) {
      throw new ForbiddenException('Vous n\'avez pas participé à cet échange');
    }

    const revieweeId =
      meeting.initiator.id === reviewerId
        ? meeting.responder.id
        : meeting.initiator.id;

    const existing = await this.reviewRepo.findOne({
      where: {
        meeting: { id: meetingId },
        reviewer: { id: reviewerId },
      },
    });
    if (existing) {
      throw new BadRequestException('Vous avez déjà évalué cet échange');
    }

    if (!data.rating || data.rating < 1 || data.rating > 5) {
      throw new BadRequestException('La note doit être comprise entre 1 et 5');
    }

    // Check if the partner already submitted their review
    const partnerReview = await this.reviewRepo.findOne({
      where: {
        meeting: { id: meetingId },
        reviewer: { id: revieweeId },
      },
    });

    const bothDone = !!partnerReview;

    const review = this.reviewRepo.create({
      meeting: { id: meetingId } as any,
      reviewer: { id: reviewerId } as any,
      reviewee: { id: revieweeId } as any,
      rating: data.rating,
      comment: data.comment?.trim() || '',
      tags: Array.isArray(data.tags) ? data.tags : [],
      isRevealed: bothDone,
    });

    const saved = await this.reviewRepo.save(review);

    if (bothDone && partnerReview) {
      partnerReview.isRevealed = true;
      await this.reviewRepo.save(partnerReview);

      meeting.status = MeetingStatus.COMPLETED;
      await this.meetingRepo.save(meeting);

      for (const uid of [reviewerId, revieweeId]) {
        this.notificationsService
          .notifyUser(
            uid,
            NotificationType.REVIEW_RECEIVED,
            'Vos avis mutuels sont publiés',
            'Les deux participants ont laissé leur avis. Consultez votre profil.',
            { meetingId, route: '/profile' },
          )
          .catch(() => {});
      }
    } else {
      this.notificationsService
        .notifyUser(
          revieweeId,
          NotificationType.REVIEW_RECEIVED,
          'Votre partenaire a évalué l\'échange',
          'Laissez votre avis pour découvrir le sien.',
          { meetingId, route: `/review/${meetingId}` },
        )
        .catch(() => {});
    }

    return saved;
  }

  /**
   * Visible reviews received by a user (revealed OR older than 7 days)
   */
  async getUserReviews(userId: string): Promise<Review[]> {
    const all = await this.reviewRepo.find({
      where: { reviewee: { id: userId } },
      relations: { reviewer: true, meeting: true },
      order: { createdAt: 'DESC' },
    });
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return all.filter(
      (r) => r.isRevealed || new Date(r.createdAt).getTime() <= sevenDaysAgo,
    );
  }

  async getReviewsGivenByUser(userId: string): Promise<Review[]> {
    return this.reviewRepo.find({
      where: { reviewer: { id: userId } },
      relations: { reviewee: true, meeting: true },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * D5 + E1 - User trust score and review statistics
   */
  async getUserStats(userId: string): Promise<{
    userId: string;
    averageRating: number;
    totalReviews: number;
    completedExchanges: number;
    trustScore: number;
    reviews: Review[];
  }> {
    const reviews = await this.getUserReviews(userId);
    const completedExchanges = await this.meetingRepo.count({
      where: [
        { initiator: { id: userId }, status: MeetingStatus.VALIDATED },
        { responder: { id: userId }, status: MeetingStatus.VALIDATED },
        { initiator: { id: userId }, status: MeetingStatus.COMPLETED },
        { responder: { id: userId }, status: MeetingStatus.COMPLETED },
      ],
    });

    const averageRating =
      reviews.length > 0
        ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
        : 0;

    // Trust score (0-100): base 60 (verified WhatsApp) + up to 25 from rating + up to 15 from completed exchanges
    const ratingBonus = reviews.length > 0 ? (averageRating / 5) * 25 : 15;
    const exchangeBonus = Math.min(completedExchanges * 3, 15);
    const trustScore = Math.min(100, Math.round(60 + ratingBonus + exchangeBonus));

    return {
      userId,
      averageRating: Math.round(averageRating * 10) / 10,
      totalReviews: reviews.length,
      completedExchanges,
      trustScore,
      reviews,
    };
  }

  async getReviewForMeeting(
    meetingId: string,
    reviewerId: string,
  ): Promise<Review | null> {
    return this.reviewRepo.findOne({
      where: {
        meeting: { id: meetingId },
        reviewer: { id: reviewerId },
      },
      relations: { reviewer: true, reviewee: true, meeting: true },
    });
  }
}
