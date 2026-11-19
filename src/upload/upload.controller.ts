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
  Request,
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
    @Query('userId') userId?: string,
    @Request() req?: any,
  ) {
    const effectiveUserId = userId || req?.user?.sub || 'user_default';
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    const result = await this.uploadService.uploadProductImage(
      file,
      effectiveUserId,
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
    @Query('userId') userId?: string,
    @Request() req?: any,
  ) {
    const effectiveUserId = userId || req?.user?.sub || 'user_default';
    if (!files || files.length === 0) {
      throw new BadRequestException('At least one image required');
    }

    const result = await this.uploadService.uploadListingImages(
      files,
      effectiveUserId,
      listingId,
    );

    return {
      success: true,
      data: result,
    };
  }

  /**
   * Delete uploaded image
   * DELETE /upload/:filepath
   */
  @Delete(':filepath')
  async deleteImage(
    @Param('filepath') filepath: string,
  ) {
    const result = await this.uploadService.deleteImage(
      decodeURIComponent(filepath),
    );

    return {
      success: true,
      message: 'Image deleted',
    };
  }

  /**
   * Delete all images for a listing
   * DELETE /upload/listing/:listingId
   */
  @Delete('listing/:listingId')
  async deleteListingImages(
    @Param('listingId') listingId: string,
  ) {
    await this.uploadService.deleteListingImages(listingId);

    return {
      success: true,
      message: 'All listing images deleted',
    };
  }
}
