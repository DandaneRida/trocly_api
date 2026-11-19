import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('reviews')
export class ReviewsController {
  constructor(private reviewsService: ReviewsService) {}

  /**
   * D5 - Post a mutual review after double-scan QR validation
   * POST /reviews
   */
  @Post()
  @UseGuards(JwtAuthGuard)
  async createReview(
    @Body()
    body: {
      meetingId: string;
      rating: number;
      comment?: string;
      tags?: string[];
    },
    @Request() req: any,
  ) {
    return this.reviewsService.createReview(body.meetingId, req.user.sub, {
      rating: body.rating,
      comment: body.comment,
      tags: body.tags,
    });
  }

  /**
   * Get visible reviews received by a user
   * GET /reviews/user/:userId/received
   */
  @Get('user/:userId/received')
  async getUserReviews(@Param('userId') userId: string) {
    return this.reviewsService.getUserReviews(userId);
  }

  /**
   * Get reviews given by a user
   * GET /reviews/user/:userId/given
   */
  @Get('user/:userId/given')
  async getReviewsGiven(@Param('userId') userId: string) {
    return this.reviewsService.getReviewsGivenByUser(userId);
  }

  /**
   * E1 - Get user trust score & review stats
   * GET /reviews/user/:userId/stats
   */
  @Get('user/:userId/stats')
  async getUserStats(@Param('userId') userId: string) {
    return this.reviewsService.getUserStats(userId);
  }

  /**
   * Get authenticated user's review for a specific meeting
   * GET /reviews/meeting/:meetingId
   */
  @Get('meeting/:meetingId')
  @UseGuards(JwtAuthGuard)
  async getMeetingReview(
    @Param('meetingId') meetingId: string,
    @Request() req: any,
  ) {
    return this.reviewsService.getReviewForMeeting(meetingId, req.user.sub);
  }
}
