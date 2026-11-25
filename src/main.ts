import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { join } from 'path';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors();

  // Phase 3.1: Global input validation & payload transformation
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: false,
      forbidUnknownValues: false,
    }),
  );

  // Serve uploaded images publicly
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
  });

  // F1 - OpenAPI / Swagger documentation at /api/docs
  const config = new DocumentBuilder()
    .setTitle('Trocly API')
    .setDescription(
      'API de la plateforme de troc local Trocly (PI_4A_12 · ENSAM Meknès) — Auth OTP WhatsApp, Annonces, Smart Matching, Favoris, Offres multi-objets & contre-offres, Chat temps réel, RDV double scan QR, Avis mutuels, Signalements & Admin.',
    )
    .setVersion('2.0')
    .addBearerAuth()
    .addTag('auth', 'Connexion OTP WhatsApp (+212), JWT & Refresh Token rotatif')
    .addTag('listings', 'Annonces, filtres, règle anti-doublon B2 & Smart Matching')
    .addTag('favorites', 'Favoris / Wishlist synchronisés')
    .addTag('cities', 'Villes marocaines')
    .addTag('offers', 'Offres multi-objets avec soulte & contre-offres')
    .addTag('messages', 'Messagerie temps réel (REST + Socket.IO)')
    .addTag('notifications', 'Notifications in-app et push FCM V1')
    .addTag('meetings', 'Rendez-vous, QR codes HMAC, double scan, annulation & expiration +2h')
    .addTag('reviews', 'Avis mutuels à l\'aveugle & score de confiance')
    .addTag('reports', 'Signalements & modération')
    .addTag('admin', 'Statistiques & modération back-office')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Trocly API listening on http://localhost:${port}`);
  console.log(`OpenAPI docs available at http://localhost:${port}/api/docs`);
}
bootstrap();
