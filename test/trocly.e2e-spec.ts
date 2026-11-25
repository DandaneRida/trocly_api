import * as dotenv from 'dotenv';
dotenv.config();

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Trocly Full Integration Flow (e2e)', () => {
  let app: INestApplication;
  let tokenA = '';
  let tokenB = '';
  let listingAId = '';
  let listingBId = '';
  let offerId = '';
  let meetingId = '';
  let qrA = '';
  let qrB = '';
  let validCityId = 1;

  const phoneA = `+212699${Math.floor(100000 + Math.random() * 899999)}`;
  const phoneB = `+212698${Math.floor(100000 + Math.random() * 899999)}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  }, 30000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  async function registerUser(phoneNumber: string, displayName: string) {
    await request(app.getHttpServer())
      .post('/auth/send-otp')
      .send({ phoneNumber })
      .expect(201);

    const v = await request(app.getHttpServer())
      .post('/auth/verify-otp')
      .send({ phoneNumber, code: '123456' })
      .expect(201);

    const tempToken = v.body.accessToken || v.body.tempToken;
    if (v.body.isNewUser || v.body.requiresProfile) {
      const c = await request(app.getHttpServer())
        .post('/auth/complete-profile')
        .set('Authorization', `Bearer ${tempToken}`)
        .send({ displayName, cityId: validCityId })
        .expect(201);
      return c.body.accessToken as string;
    }
    return tempToken as string;
  }

  it('1. GET /cities returns seeded Moroccan cities', async () => {
    const res = await request(app.getHttpServer()).get('/cities').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(5);
    validCityId = res.body[0].id;
  });

  it('2. Registers two distinct users via OTP + JWT', async () => {
    tokenA = await registerUser(phoneA, 'User A E2E');
    tokenB = await registerUser(phoneB, 'User B E2E');
    expect(tokenA).toBeTruthy();
    expect(tokenB).toBeTruthy();
  });

  it('3. Creates listings, rejects B2 duplicate (409), and isolates /my-listings per user', async () => {
    const ts = Date.now();
    const resA = await request(app.getHttpServer())
      .post('/listings')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        title: `Velo E2E ${ts}`,
        description: 'VTT test',
        category: 'Sport',
        condition: 'tres_bon',
        estimatedValue: 0,
        cityId: validCityId,
        photos: [],
      })
      .expect(201);
    listingAId = resA.body.id;

    // B2 duplicate must be rejected with 409
    await request(app.getHttpServer())
      .post('/listings')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        title: `Velo E2E ${ts}`,
        description: 'VTT test',
        category: 'Sport',
        condition: 'tres_bon',
        estimatedValue: 0,
        cityId: validCityId,
        photos: [],
      })
      .expect(409);

    const resB = await request(app.getHttpServer())
      .post('/listings')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        title: `Console E2E ${ts}`,
        description: 'Console test',
        category: 'Électronique',
        condition: 'bon',
        estimatedValue: 0,
        cityId: validCityId,
        photos: [],
      })
      .expect(201);
    listingBId = resB.body.id;

    // Profile /my-listings for User B must ONLY contain User B's listing, never User A's!
    const myB = await request(app.getHttpServer())
      .get('/listings/user/my-listings')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    const idsB = myB.body.map((l: any) => l.id);
    expect(idsB).toContain(listingBId);
    expect(idsB).not.toContain(listingAId);
  });

  it('4. Rejects self-offer and empty offer, then creates valid offer between User B -> User A', async () => {
    // Self-offer rejected
    await request(app.getHttpServer())
      .post('/offers')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ targetListingId: listingAId, offeringListingIds: [listingAId] })
      .expect(400);

    // Empty offeringListingIds rejected
    await request(app.getHttpServer())
      .post('/offers')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ targetListingId: listingAId, offeringListingIds: [] })
      .expect(400);

    // Valid offer from User B to User A
    const offerRes = await request(app.getHttpServer())
      .post('/offers')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        targetListingId: listingAId,
        offeringListingIds: [listingBId],
        soultePossible: true,
        message: 'Bonjour, intéressé par votre vélo',
      })
      .expect(201);
    offerId = offerRes.body.id;
    expect(offerId).toBeTruthy();

    // User A accepts the offer
    await request(app.getHttpServer())
      .patch(`/offers/${offerId}/accept`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
  });

  it('5. Exchanges real-time chat messages and checks notifications', async () => {
    await request(app.getHttpServer())
      .post(`/messages/offer/${offerId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ content: 'On se retrouve Place El Hedim ?' })
      .expect(201);

    const msgs = await request(app.getHttpServer())
      .get(`/messages/offer/${offerId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(msgs.body.length).toBeGreaterThanOrEqual(1);

    const notifs = await request(app.getHttpServer())
      .get('/notifications')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(notifs.body.length).toBeGreaterThanOrEqual(1);
  });

  it('6. Proposes meeting, accepts + generates 2 QR codes, validates via double scan, and posts mutual reviews', async () => {
    const scheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const mRes = await request(app.getHttpServer())
      .post('/meetings')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        offerId,
        proposedLocation: 'Place El Hedim, Meknès',
        scheduledAt,
      })
      .expect(201);
    meetingId = mRes.body.id;

    const accRes = await request(app.getHttpServer())
      .post(`/meetings/${meetingId}/accept`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(201);
    qrB = accRes.body.qrPayloadInitiator; // User B initiated meeting
    qrA = accRes.body.qrPayloadResponder; // User A responded
    expect(qrA).toBeTruthy();
    expect(qrB).toBeTruthy();

    // Self-scan rejected
    await request(app.getHttpServer())
      .post('/meetings/qr/scan')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ payload: qrA })
      .expect(400);

    // 1st cross-scan -> still accepted
    const scan1 = await request(app.getHttpServer())
      .post('/meetings/qr/scan')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ payload: qrB })
      .expect(201);
    expect(scan1.body.status).toBe('accepted');

    // 2nd cross-scan -> validated
    const scan2 = await request(app.getHttpServer())
      .post('/meetings/qr/scan')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ payload: qrA })
      .expect(201);
    expect(scan2.body.status).toBe('validated');

    // Mutual blind reviews
    const rev1 = await request(app.getHttpServer())
      .post('/reviews')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ meetingId, rating: 5, comment: 'Top', tags: ['Ponctuel'] })
      .expect(201);
    expect(rev1.body.isRevealed).toBe(false);

    const rev2 = await request(app.getHttpServer())
      .post('/reviews')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ meetingId, rating: 5, comment: 'Parfait', tags: ['Objet conforme'] })
      .expect(201);
    expect(rev2.body.isRevealed).toBe(true);
  });

  it('7. Syncs Favorites, computes Smart Matches, and returns Admin KPIs', async () => {
    // Create a fresh active listing for User A to favorite & match
    const newListing = await request(app.getHttpServer())
      .post('/listings')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        title: `Sneakers Test ${Date.now()}`,
        description: 'Pointure 42',
        category: 'Vêtements',
        condition: 'neuf',
        estimatedValue: 0,
        cityId: validCityId,
        photos: [],
        attributes: { wishes: ['Veste'] },
      })
      .expect(201);

    const favAdd = await request(app.getHttpServer())
      .post(`/favorites/${newListing.body.id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(201);
    expect(favAdd.body.favorited).toBe(true);

    const favList = await request(app.getHttpServer())
      .get('/favorites')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    expect(favList.body.some((l: any) => l.id === newListing.body.id)).toBe(true);

    const matches = await request(app.getHttpServer())
      .get('/listings/matches')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    expect(Array.isArray(matches.body)).toBe(true);

    const adminDash = await request(app.getHttpServer())
      .get('/admin/dashboard')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(adminDash.body.users.total).toBeGreaterThanOrEqual(2);
  });
});
