import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import sharp from 'sharp';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);
  private uploadDir = path.join(process.cwd(), 'uploads', 'products');

  constructor() {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  private getCloudinaryCreds(): {
    cloudName: string;
    apiKey: string;
    apiSecret: string;
  } | null {
    const rawUrl = process.env.CLOUDINARY_URL;
    if (rawUrl && rawUrl.startsWith('cloudinary://')) {
      try {
        const parsed = new URL(rawUrl);
        return {
          cloudName: parsed.hostname,
          apiKey: decodeURIComponent(parsed.username),
          apiSecret: decodeURIComponent(parsed.password),
        };
      } catch {}
    }
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (cloudName && apiKey && apiSecret) {
      return { cloudName, apiKey, apiSecret };
    }
    return null;
  }

  /**
   * Compress image to WebP (70-85% smaller) via Sharp, then upload to Cloudinary
   * (if configured) or store locally under /uploads/products/
   */
  async uploadProductImage(
    file: Express.Multer.File,
    userId: string,
    listingId?: string,
  ): Promise<{ url: string; filename: string }> {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    if (file.size > 10 * 1024 * 1024) {
      throw new BadRequestException('Image size must be under 10MB');
    }

    try {
      const optimized = await sharp(file.buffer)
        .rotate()
        .resize(1200, 1200, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 82 })
        .toBuffer();

      const cloudinary = this.getCloudinaryCreds();
      if (cloudinary) {
        try {
          const timestamp = Math.floor(Date.now() / 1000).toString();
          const folder = `trocly/${userId}`;
          const toSign = `folder=${folder}&timestamp=${timestamp}${cloudinary.apiSecret}`;
          const signature = crypto
            .createHash('sha1')
            .update(toSign)
            .digest('hex');

          const form = new FormData();
          form.append(
            'file',
            new Blob([new Uint8Array(optimized)], { type: 'image/webp' }),
            'photo.webp',
          );
          form.append('api_key', cloudinary.apiKey);
          form.append('timestamp', timestamp);
          form.append('folder', folder);
          form.append('signature', signature);

          const res = await fetch(
            `https://api.cloudinary.com/v1_1/${cloudinary.cloudName}/image/upload`,
            { method: 'POST', body: form },
          );
          if (res.ok) {
            const json: any = await res.json();
            return {
              url: json.secure_url,
              filename: json.public_id,
            };
          }
          this.logger.warn(
            `Cloudinary upload returned ${res.status}, falling back to local storage`,
          );
        } catch (cloudErr: any) {
          this.logger.warn(
            `Cloudinary upload error (${cloudErr?.message}), falling back to local`,
          );
        }
      }

      const timestamp = Date.now();
      const uniqueName = `${timestamp}-${uuidv4()}.webp`;
      const relativePath = `${userId}/${listingId || 'temp'}`;
      const fullDir = path.join(this.uploadDir, relativePath);

      if (!fs.existsSync(fullDir)) {
        fs.mkdirSync(fullDir, { recursive: true });
      }

      const filePath = path.join(fullDir, uniqueName);
      fs.writeFileSync(filePath, optimized);

      const relativeFilePath = `${relativePath}/${uniqueName}`;
      const url = `/uploads/products/${relativeFilePath}`;

      return {
        url,
        filename: relativeFilePath,
      };
    } catch (error) {
      throw new BadRequestException(
        `Image upload failed: ${(error as any).message || error}`,
      );
    }
  }

  async uploadListingImages(
    files: Express.Multer.File[],
    userId: string,
    listingId: string,
  ): Promise<{ urls: string[]; filenames: string[] }> {
    if (!files || files.length === 0) {
      throw new BadRequestException('At least one image required');
    }

    const results = await Promise.all(
      files.map((file) => this.uploadProductImage(file, userId, listingId)),
    );
    return {
      urls: results.map((r) => r.url),
      filenames: results.map((r) => r.filename),
    };
  }

  async deleteImage(filepath: string): Promise<{ message: string }> {
    try {
      const fullPath = path.join(this.uploadDir, filepath);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        return { message: 'Image deleted successfully' };
      }
      return { message: 'Image not found' };
    } catch (error) {
      throw new BadRequestException(
        `Failed to delete image: ${(error as any).message || error}`,
      );
    }
  }

  async deleteListingImages(listingId: string): Promise<{ message: string }> {
    try {
      const listingDir = path.join(this.uploadDir, `*/${listingId}`);
      const dir = path.dirname(listingDir);
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const filePath = path.join(dir, file);
          if (fs.statSync(filePath).isFile()) {
            fs.unlinkSync(filePath);
          }
        }
      }
      return { message: 'All listing images deleted successfully' };
    } catch (error) {
      throw new BadRequestException(
        `Failed to delete listing images: ${(error as any).message || error}`,
      );
    }
  }
}
