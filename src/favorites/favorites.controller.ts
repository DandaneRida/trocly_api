import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FavoritesService } from './favorites.service';

@Controller('favorites')
@UseGuards(JwtAuthGuard)
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
  async getMyFavorites(@Request() req: any) {
    return this.favoritesService.getUserFavorites(req.user.sub);
  }

  @Get('ids')
  async getMyFavoriteIds(@Request() req: any) {
    const ids = await this.favoritesService.getFavoriteIds(req.user.sub);
    return { ids };
  }

  @Post(':listingId')
  async addFavorite(
    @Param('listingId') listingId: string,
    @Request() req: any,
  ) {
    return this.favoritesService.addFavorite(req.user.sub, listingId);
  }

  @Delete(':listingId')
  async removeFavorite(
    @Param('listingId') listingId: string,
    @Request() req: any,
  ) {
    return this.favoritesService.removeFavorite(req.user.sub, listingId);
  }
}
