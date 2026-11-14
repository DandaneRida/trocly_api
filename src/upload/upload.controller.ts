import {
  Controller,
  Post,
  Delete,
  Param,
  UseInterceptors,
  UploadedFiles,
  UploadedFile,
  BadRequestException,
  Query,
} from '@nestjs/common';
import { FilesInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service';

@Controller('upload')
export class UploadController {
  constructor(private uploadService: UploadService) {}

  /**
   * Upload single product image
   * POST /upload/image?userId=xxx
   * Body: FormData with 'file' field
   */
  @Post('image')
  @UseInterceptors(FileInterceptor('file'))
  async uploadImage(
    @UploadedFile() file: Express.Multer.File,
    @Query('userId') userId: string,
  ) {
    if (!userId) {
      throw new BadRequestException('userId query parameter required');
    }
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    const result = await this.uploadService.uploadProductImage(
      file,
      userId,
    );

    return {
      success: true,
      data: result,
    };
  }

  /**
   * Upload multiple images for listing
   * POST /upload/listing/:listingId?userId=xxx
   * Body: FormData with multiple 'images' fields
   */
  @Post('listing/:listingId')
  @UseInterceptors(FilesInterceptor('images', 10))
  async uploadListingImages(
    @UploadedFiles() files: Express.Multer.File[],
    @Param('listingId') listingId: string,
    @Query('userId') userId: string,
  ) {
    if (!userId) {
      throw new BadRequestException('userId query parameter required');
    }
    if (!files || files.length === 0) {
      throw new BadRequestException('No files provided');
    }

    const result = await this.uploadService.uploadListingImages(
      files,
      userId,
      listingId,
    );

    return {
      success: true,
      data: result,
    };
  }

  /**
   * Delete image
   * DELETE /upload/:filepath?userId=xxx
   */
  @Delete(':filepath')
  async deleteImage(
    @Param('filepath') filepath: string,
    @Query('userId') userId: string,
  ) {
    if (!userId) {
      throw new BadRequestException('userId query parameter required');
    }
    const result = await this.uploadService.deleteImage(filepath);
    return {
      success: true,
      data: result,
    };
  }

  /**
   * Delete all images for a listing
   * DELETE /upload/listing/:listingId?userId=xxx
   */
  @Delete('listing/:listingId')
  async deleteListingImages(
    @Param('listingId') listingId: string,
    @Query('userId') userId: string,
  ) {
    if (!userId) {
      throw new BadRequestException('userId query parameter required');
    }
    const result = await this.uploadService.deleteListingImages(listingId);
    return {
      success: true,
      data: result,
    };
  }
}
