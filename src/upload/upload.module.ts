import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UploadService } from './upload.service';
import { UploadController } from './upload.controller';

@Module({
  imports: [
    MulterModule.register({
      storage: memoryStorage(),
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB max
      },
      fileFilter: (req, file, callback) => {
        const mime = (file.mimetype || '').toLowerCase();
        const originalName = (file.originalname || '').toLowerCase();

        // Accepter si le mime commence par image/ ou si l'extension est une image valide
        const isImageMime = mime.startsWith('image/');
        const isImageExt = /\.(jpg|jpeg|png|webp|gif|bmp|jfif)$/i.test(originalName);

        if (isImageMime || isImageExt || mime === 'application/octet-stream') {
          callback(null, true);
        } else {
          callback(new Error('Format de fichier non supporté (images uniquement)'), false);
        }
      },
    }),
  ],
  providers: [UploadService],
  controllers: [UploadController],
  exports: [UploadService],
})
export class UploadModule {}
