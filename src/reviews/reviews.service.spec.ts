import { jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { MeetingStatus } from '../meetings/meeting.entity';

describe('ReviewsService (Unit)', () => {
  let service: ReviewsService;
  let reviewRepo: any;
  let meetingRepo: any;
  let userRepo: any;
  let dataSource: any;
  let notificationsService: any;

  beforeEach(() => {
    reviewRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((x) => ({ id: 'rev-new', ...x })),
      save: jest.fn(async (x) => x),
    };
    meetingRepo = {
      findOne: jest.fn(),
      save: jest.fn(async (x) => x),
      count: jest.fn().mockResolvedValue(2),
    };
    userRepo = {};
    dataSource = { query: jest.fn() };
    notificationsService = {
      notifyUser: jest.fn().mockResolvedValue({}),
    };

    service = new ReviewsService(
      reviewRepo,
      meetingRepo,
      userRepo,
      dataSource,
      notificationsService,
    );
  });

  it('rejects review on non-validated meeting', async () => {
    meetingRepo.findOne.mockResolvedValue({
      id: 'm-1',
      status: MeetingStatus.PROPOSED,
      initiator: { id: 'u1' },
      responder: { id: 'u2' },
    });

    await expect(
      service.createReview('m-1', 'u1', { rating: 5 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('keeps first review blind until partner reviews, then reveals both', async () => {
    const meeting = {
      id: 'm-1',
      status: MeetingStatus.VALIDATED,
      initiator: { id: 'u1' },
      responder: { id: 'u2' },
    };
    meetingRepo.findOne.mockResolvedValue(meeting);

    // 1st review: no existing review, no partner review
    reviewRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const first = await service.createReview('m-1', 'u1', {
      rating: 5,
      tags: ['Ponctuel'],
    });
    expect(first.isRevealed).toBe(false);

    // 2nd review: no existing review for u2, partner review exists
    reviewRepo.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(first);
    const second = await service.createReview('m-1', 'u2', {
      rating: 4,
      tags: ['Aimable'],
    });
    expect(second.isRevealed).toBe(true);
    expect(first.isRevealed).toBe(true);
    expect(meeting.status).toBe(MeetingStatus.COMPLETED);
  });
});
