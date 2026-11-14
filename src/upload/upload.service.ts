import { Injectable, BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class UploadService {
  private uploadDir = path.join(process.cwd(), 'uploads', 'products');

  constructor() {
    // Ensure upload directory exists
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  /**
   * Upload and optimize product image locally
   * Compresses to JPEG, resizes to max 1200x1200
   */
  async uploadProductImage(
    file: Express.Multer.File,
    userId: string,
    listingId?: string,
  ): Promise<{ url: string; filename: string }> {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    // Validate file type
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedMimes.includes(file.mimetype)) {
      throw new BadRequestException('Only JPEG, PNG, and WebP images allowed');
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('Image size must be under 5MB');
    }

    try {
      // Compress and optimize image
      const optimized = await sharp(file.buffer)
        .resize(1200, 1200, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 85, progressive: true })
        .toBuffer();

      // Generate unique filename
      const timestamp = Date.now();
      const uniqueName = `${timestamp}-${uuidv4()}.jpg`;
      const relativePath = `${userId}/${listingId || 'temp'}`;
      const fullDir = path.join(this.uploadDir, relativePath);

      // Create directory if needed
      if (!fs.existsSync(fullDir)) {
        fs.mkdirSync(fullDir, { recursive: true });
      }

      const filePath = path.join(fullDir, uniqueName);

      // Write file to disk
      fs.writeFileSync(filePath, optimized);

      // Return public URL
      const relativeFilePath = `${relativePath}/${uniqueName}`;
      const url = `/uploads/products/${relativeFilePath}`;

      return {
        url,
        filename: relativeFilePath,
      };
    } catch (error) {
      console.error('Upload error:', error);
      throw new BadRequestException(`Image upload failed: ${(error as any).message || error}`);
    }
  }

  /**
   * Upload multiple images for a listing
   */
  async uploadListingImages(
    files: Express.Multer.File[],
    userId: string,
    listingId: string,
  ): Promise<{ urls: string[]; filenames: string[] }> {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files provided');
    }

    if (files.length > 10) {
      throw new BadRequestException('Maximum 10 images per listing');
    }

    const uploadPromises = files.map(file =>
      this.uploadProductImage(file, userId, listingId),
    );

    const results = await Promise.all(uploadPromises);
    return {
      urls: results.map(r => r.url),
      filenames: results.map(r => r.filename),
    };
  }

  /**
   * Delete image from local storage
   */
  async deleteImage(filepath: string): Promise<{ message: string }> {
    try {
      const fullPath = path.join(this.uploadDir, filepath);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        return { message: 'Image deleted successfully' };
      }
      return { message: 'Image not found' };
    } catch (error) {
      console.error('Delete error:', error);
      throw new BadRequestException(`Failed to delete image: ${(error as any).message || error}`);
    }
  }

  /**
   * Delete all images for a listing
   */
  async deleteListingImages(listingId: string): Promise<{ message: string }> {
    try {
      const listingDir = path.join(this.uploadDir, `*/${listingId}`);
      // Find and delete all files for this listing
      const dir = path.dirname(listingDir);
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        let deletedCount = 0;
        for (const file of files) {
          const filePath = path.join(dir, file);
          if (fs.statSync(filePath).isFile()) {
            fs.unlinkSync(filePath);
            deletedCount++;
          }
        }
        return { message: `${deletedCount} images deleted` };
      }
      return { message: '0 images found' };
    } catch (error) {
      console.error('Batch delete error:', error);
      throw new BadRequestException(`Failed to delete images: ${(error as any).message || error}`);
    }
  }
}
