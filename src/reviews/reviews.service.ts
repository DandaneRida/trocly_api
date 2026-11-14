import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Review } from './review.entity';
import { Meeting } from '../meetings/meeting.entity';
import { User } from '../users/user.entity';

@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(Review) private reviewRepo: Repository<Review>,
    @InjectRepository(Meeting) private meetingRepo: Repository<Meeting>,
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {}

  /**
   * D5 - Post a review after meeting validation
   * One user rates the other after QR validation
   */
  async createReview(
    meetingId: string,
    reviewerId: string,
    data: {
      rating: number;
      comment?: string;
    },
  ): Promise<Review> {
    // Validate meeting exists and is validated
    const meeting = await this.meetingRepo.findOne({
      where: { id: meetingId },
      relations: { initiator: true, responder: true },
    });

    if (!meeting) throw new NotFoundException('Meeting not found');
    if (meeting.status !== 'validated') {
      throw new BadRequestException('Can only review validated meetings');
    }

    // Reviewer must be one of the participants
    const isParticipant = meeting.initiator.id === reviewerId || meeting.responder.id === reviewerId;
    if (!isParticipant) {
      throw new ForbiddenException('You did not participate in this meeting');
    }

    // Find the reviewee (the other participant)
    const revieweeId =
      meeting.initiator.id === reviewerId ? meeting.responder.id : meeting.initiator.id;

    // Check if review already exists (can only review once)
    const existingReview = await this.reviewRepo.findOne({
      where: {
        meeting: { id: meetingId },
        reviewer: { id: reviewerId },
      },
    });

    if (existingReview) {
      throw new BadRequestException('You have already reviewed this exchange');
    }

    // Validate rating (1-5)
    if (data.rating < 1 || data.rating > 5) {
      throw new BadRequestException('Rating must be between 1 and 5');
    }

    // Create review
    const review = this.reviewRepo.create({
      meeting: { id: meetingId },
      reviewer: { id: reviewerId },
      reviewee: { id: revieweeId },
      rating: data.rating,
      comment: data.comment || '',
    });

    return await this.reviewRepo.save(review);
  }

  /**
   * Get reviews received by a user
   */
  async getUserReviews(userId: string): Promise<Review[]> {
    return this.reviewRepo.find({
      where: { reviewee: { id: userId } },
      relations: { reviewer: true, meeting: true },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Get reviews given by a user
   */
  async getReviewsGivenByUser(userId: string): Promise<Review[]> {
    return this.reviewRepo.find({
      where: { reviewer: { id: userId } },
      relations: { reviewee: true, meeting: true },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Get user statistics (trust score)
   * D5 - Calculate score based on reviews
   */
  async getUserStats(userId: string): Promise<{
    userId: string;
    averageRating: number;
    totalReviews: number;
    reviews: Review[];
  }> {
    const reviews = await this.getUserReviews(userId);

    const averageRating = reviews.length > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
      : 0;

    return {
      userId,
      averageRating: Math.round(averageRating * 10) / 10, // Round to 1 decimal
      totalReviews: reviews.length,
      reviews,
    };
  }

  /**
   * Get review for a specific meeting
   */
  async getReviewForMeeting(meetingId: string, reviewerId: string): Promise<Review | null> {
    return this.reviewRepo.findOne({
      where: {
        meeting: { id: meetingId },
        reviewer: { id: reviewerId },
      },
      relations: { reviewer: true, reviewee: true, meeting: true },
    });
  }
}
