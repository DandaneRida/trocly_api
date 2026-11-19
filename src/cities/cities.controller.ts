import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { CitiesService } from './cities.service';
import { City } from './city.entity';

@Controller('cities')
export class CitiesController {
  constructor(private readonly citiesService: CitiesService) {}

  @Get()
  async getCities(): Promise<City[]> {
    return this.citiesService.findAll();
  }

  @Get(':id')
  async getCityById(@Param('id', ParseIntPipe) id: number): Promise<City | null> {
    return this.citiesService.findById(id);
  }
}
