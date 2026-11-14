import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { ReviewsService } from './reviews.service';

@Controller('reviews')
export class ReviewsController {
  constructor(private reviewsService: ReviewsService) {}

  /**
   * D5 - Post a review after QR validation
   * POST /reviews
   * Body: { meetingId, rating: 1-5, comment? }
   */
  @Post()
  async createReview(
    @Body()
    body: {
      meetingId: string;
      rating: number;
      comment?: string;
    },
    @Query('reviewerId') reviewerId?: string, // TODO: Get from JWT
  ) {
    if (!reviewerId) throw new BadRequestException('reviewerId required');

    return this.reviewsService.createReview(reviewerId, body.meetingId, {
      rating: body.rating,
      comment: body.comment,
    });
  }

  /**
   * Get reviews received by user
   * GET /reviews/user/:userId/received
   */
  @Get('user/:userId/received')
  async getUserReviews(@Param('userId') userId: string) {
    return this.reviewsService.getUserReviews(userId);
  }

  /**
   * Get reviews given by user
   * GET /reviews/user/:userId/given
   */
  @Get('user/:userId/given')
  async getReviewsGiven(@Param('userId') userId: string) {
    return this.reviewsService.getReviewsGivenByUser(userId);
  }

  /**
   * E1 - Get user statistics (trust score)
   * GET /reviews/user/:userId/stats
   */
  @Get('user/:userId/stats')
  async getUserStats(@Param('userId') userId: string) {
    return this.reviewsService.getUserStats(userId);
  }

  /**
   * Get review for a specific meeting
   * GET /reviews/meeting/:meetingId
   */
  @Get('meeting/:meetingId')
  async getMeetingReview(
    @Param('meetingId') meetingId: string,
    @Query('reviewerId') reviewerId?: string,
  ) {
    if (!reviewerId) throw new BadRequestException('reviewerId required');
    return this.reviewsService.getReviewForMeeting(meetingId, reviewerId);
  }
}
