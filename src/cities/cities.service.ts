import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { City } from './city.entity';

@Injectable()
export class CitiesService {
  constructor(
    @InjectRepository(City)
    private readonly cityRepository: Repository<City>,
  ) {}

  async findAll(): Promise<City[]> {
    const count = await this.cityRepository.count();
    if (count === 0) {
      await this.seedDefaultCities();
    }
    return this.cityRepository.find({
      order: { name: 'ASC' },
    });
  }

  async findById(id: number): Promise<City | null> {
    return this.cityRepository.findOne({ where: { id } });
  }

  private async seedDefaultCities(): Promise<void> {
    const defaultCities = [
      'Meknès',
      'Fès',
      'Rabat',
      'Casablanca',
      'Marrakech',
      'Tanger',
      'Agadir',
      'Oujda',
      'Kénitra',
      'Tétouan',
    ];
    for (const name of defaultCities) {
      const city = this.cityRepository.create({ name });
      await this.cityRepository.save(city);
    }
  }
}
