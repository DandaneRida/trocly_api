import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DataSource } from 'typeorm';
import { User } from './users/user.entity';
import { Listing, ListingStatus } from './listings/listing.entity';
import { City } from './cities/city.entity';

/**
 * Phase 1.1 — Seed Maroc idempotent (100% gratuit)
 * Exécution : npm run seed
 * Crée les 10 villes marocaines, 4 comptes membres vérifiés,
 * et 14 annonces réalistes (Vêtements en tête, Électronique, Livres, Sport, Maison, Bricolage)
 * avec souhaits croisés pour démontrer le Smart Matching.
 */
async function runSeed() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const ds = app.get(DataSource);
  const userRepo = ds.getRepository(User);
  const listingRepo = ds.getRepository(Listing);

  const cities = [
    { id: 1, name: 'Meknès' },
    { id: 2, name: 'Fès' },
    { id: 3, name: 'Rabat' },
    { id: 4, name: 'Casablanca' },
    { id: 5, name: 'Marrakech' },
    { id: 6, name: 'Tanger' },
    { id: 7, name: 'Agadir' },
    { id: 8, name: 'Oujda' },
    { id: 9, name: 'Kénitra' },
    { id: 10, name: 'Tétouan' },
  ];

  const cityIdMap: Record<number, number> = {};
  for (const c of cities) {
    await ds.query(
      `INSERT INTO cities (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
      [c.name],
    );
    const rows = await ds.query(
      `SELECT id FROM cities WHERE name = $1 LIMIT 1`,
      [c.name],
    );
    cityIdMap[c.id] = rows[0].id;
  }

  const demoUsers = [
    {
      phone: '+212661100201',
      name: 'Yassine El Amrani',
      cityId: 1,
    },
    {
      phone: '+212661100202',
      name: 'Salma Bennani',
      cityId: 1,
    },
    {
      phone: '+212661100203',
      name: 'Karim Tazi',
      cityId: 2,
    },
    {
      phone: '+212661100204',
      name: 'Nadia Idrissi',
      cityId: 3,
    },
  ];

  const userIds: Record<string, string> = {};
  for (const u of demoUsers) {
    let existing = await userRepo.findOne({
      where: { whatsappNumber: u.phone },
    });
    if (!existing) {
      existing = await userRepo.save(
        userRepo.create({
          whatsappNumber: u.phone,
          displayName: u.name,
          city: { id: cityIdMap[u.cityId] } as City,
        }),
      );
    }
    userIds[u.phone] = existing.id;
  }

  const seedListings = [
    {
      owner: '+212661100202',
      cityId: 1,
      title: 'Veste en jean Levi\'s taille M',
      description:
        'Veste authentique portée 3 fois, coupe unisexe impeccable. Remise en main propre à Hamria ou ENSAM Meknès.',
      category: 'Vêtements',
      condition: 'comme_neuf',
      photos: [
        'https://images.unsplash.com/photo-1576871337622-98d48d1cf531?auto=format&fit=crop&w=900&q=80',
      ],
      wishes: ['Sneakers', 'Sac à dos', 'Casque audio'],
      marque: 'Levi\'s',
    },
    {
      owner: '+212661100201',
      cityId: 1,
      title: 'Sneakers New Balance 550 (42)',
      description:
        'Coloris blanc et vert sapin, très propre avec boîte d\'origine.',
      category: 'Vêtements',
      condition: 'tres_bon',
      photos: [
        'https://images.unsplash.com/photo-1539185441755-769473a23570?auto=format&fit=crop&w=900&q=80',
      ],
      wishes: ['Veste en jean', 'Montre Casio', 'Jeux PS4'],
      marque: 'New Balance',
    },
    {
      owner: '+212661100204',
      cityId: 3,
      title: 'Manteau long laine beige (S/M)',
      description:
        'Manteau chaud coupe droite Zara, parfait pour l\'hiver à Rabat/Meknès.',
      category: 'Vêtements',
      condition: 'comme_neuf',
      photos: [
        'https://images.unsplash.com/photo-1539533018447-63fcce2678e3?auto=format&fit=crop&w=900&q=80',
      ],
      wishes: ['Sac cuir', 'Liseuse Kindle', 'Parfum'],
      marque: 'Zara',
    },
    {
      owner: '+212661100203',
      cityId: 2,
      title: 'Sac à dos Eastpak rembourré PC 15"',
      description:
        'Compartiment ordinateur protégé, idéal pour étudiant ingénieur.',
      category: 'Vêtements',
      condition: 'neuf',
      photos: [
        'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=900&q=80',
      ],
      wishes: ['Souris sans fil', 'Clavier mécanique', 'Veste'],
      marque: 'Eastpak',
    },
    {
      owner: '+212661100201',
      cityId: 1,
      title: 'Casque Sony WH-1000XM4 réduction de bruit',
      description:
        'Autonomie 30h, pochette rigide et câble inclus. Idéal bibliothèque et train ONCF.',
      category: 'Électronique',
      condition: 'tres_bon',
      photos: [
        'https://images.unsplash.com/photo-1618366712010-f4ae9c647dcb?auto=format&fit=crop&w=900&q=80',
      ],
      wishes: ['Appareil photo', 'Tablette', 'VTT'],
      marque: 'Sony',
    },
    {
      owner: '+212661100202',
      cityId: 1,
      title: 'Appareil photo argentique Canon AE-1 + 50mm',
      description:
        'Cellule fonctionnelle, vitesses révisées, livré avec sangle cuir.',
      category: 'Électronique',
      condition: 'bon',
      photos: [
        'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=900&q=80',
      ],
      wishes: ['Casque Sony', 'Enceinte Bluetooth', 'Objectif'],
      marque: 'Canon',
    },
    {
      owner: '+212661100203',
      cityId: 2,
      title: 'Clavier mécanique Keychron K2 rétroéclairé',
      description: 'Switchs tactiles silencieux, compatible Mac et Windows.',
      category: 'Électronique',
      condition: 'comme_neuf',
      photos: [
        'https://images.unsplash.com/photo-1595225476474-87563907a212?auto=format&fit=crop&w=900&q=80',
      ],
      wishes: ['Écran 24 pouces', 'Sac à dos', 'Livres programmation'],
      marque: 'Keychron',
    },
    {
      owner: '+212661100204',
      cityId: 3,
      title: 'Liseuse Kindle Paperwhite 16 Go étanche',
      description: 'Écran sans reflet chaud/froid, étui tissu inclus.',
      category: 'Électronique',
      condition: 'comme_neuf',
      photos: [
        'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=900&q=80',
      ],
      wishes: ['Manteau laine', 'Machine à café', 'Romans'],
      marque: 'Amazon',
    },
    {
      owner: '+212661100201',
      cityId: 1,
      title: 'VTT Rockrider ST 520 taille L',
      description:
        'Freins à disque mécaniques, pneus récents, prêt à rouler à Meknès.',
      category: 'Sport',
      condition: 'bon',
      photos: [
        'https://images.unsplash.com/photo-1485965120184-e220f721d03e?auto=format&fit=crop&w=900&q=80',
      ],
      wishes: ['Console Nintendo Switch', 'Casque audio', 'Guitare'],
      marque: 'Rockrider',
    },
    {
      owner: '+212661100202',
      cityId: 1,
      title: 'Raquette Padel Babolat Air Viper',
      description: 'Très légère, grip neuf posé cette semaine.',
      category: 'Sport',
      condition: 'tres_bon',
      photos: [
        'https://images.unsplash.com/photo-1626224583764-f87db24ac4ea?auto=format&fit=crop&w=900&q=80',
      ],
      wishes: ['Montre sport', 'Chaussures running', 'Sac de sport'],
      marque: 'Babolat',
    },
    {
      owner: '+212661100201',
      cityId: 1,
      title: 'Lot Clean Code + Designing Data-Intensive Applications',
      description: 'Deux références incontournables en génie logiciel, état neuf.',
      category: 'Livres',
      condition: 'neuf',
      photos: [
        'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&w=900&q=80',
      ],
      wishes: ['Clavier mécanique', 'Romans historiques', 'Calculatrice'],
      marque: 'O\'Reilly',
    },
    {
      owner: '+212661100203',
      cityId: 2,
      title: 'Lampe d\'architecte articulée métal noir mat',
      description: 'Ampoule LED chaude incluse, pince bureau solide.',
      category: 'Maison',
      condition: 'comme_neuf',
      photos: [
        'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=900&q=80',
      ],
      wishes: ['Plante d\'intérieur', 'Tapis berbère', 'Livres'],
      marque: 'IKEA',
    },
    {
      owner: '+212661100202',
      cityId: 1,
      title: 'Cafetière italienne Bialetti Moka Express 6 tasses',
      description: 'Joint silicone neuf, aluminium brossé authentique.',
      category: 'Maison',
      condition: 'tres_bon',
      photos: [
        'https://images.unsplash.com/photo-1517668808822-9ebb02f2a0e6?auto=format&fit=crop&w=900&q=80',
      ],
      wishes: ['Théière artisanale', 'Tasses céramique', 'Livres cuisine'],
      marque: 'Bialetti',
    },
    {
      owner: '+212661100204',
      cityId: 4,
      title: 'Perceuse-visseuse sans fil Bosch 18V + coffret',
      description: 'Deux batteries 2.0Ah et chargeur rapide dans sa mallette.',
      category: 'Bricolage',
      condition: 'tres_bon',
      photos: [
        'https://images.unsplash.com/photo-1504148455328-c376907d081c?auto=format&fit=crop&w=900&q=80',
      ],
      wishes: ['Outillage main', 'Étagère métal', 'Lampe atelier'],
      marque: 'Bosch',
    },
  ];

  let insertedCount = 0;
  for (const item of seedListings) {
    const uid = userIds[item.owner];
    const exists = await listingRepo.findOne({
      where: {
        user: { id: uid },
        title: item.title,
      },
    });
    if (!exists) {
      await listingRepo.save(
        listingRepo.create({
          user: { id: uid } as User,
          city: { id: cityIdMap[item.cityId] } as City,
          title: item.title,
          description: item.description,
          category: item.category,
          condition: item.condition,
          estimatedValue: 0,
          status: ListingStatus.ACTIVE,
          photos: item.photos,
          attributes: { wishes: item.wishes, marque: item.marque },
        }),
      );
      insertedCount++;
    }
  }

  console.log(
    `[SEED] Terminé avec succès : ${cities.length} villes, ${demoUsers.length} membres vérifiés, ${insertedCount} nouvelles annonces ajoutées (${seedListings.length} au total).`,
  );
  await app.close();
}

runSeed().catch((err) => {
  console.error('[SEED ERROR]', err);
  process.exit(1);
});
