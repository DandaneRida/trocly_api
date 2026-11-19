import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Message } from './message.entity';
import { MessagesService } from './messages.service';
import { MessagesController } from './messages.controller';
import { ChatGateway } from './chat.gateway';
import { Offer } from '../offers/offer.entity';
import { User } from '../users/user.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([Message, Offer, User]), AuthModule],
  providers: [MessagesService, ChatGateway],
  controllers: [MessagesController],
  exports: [MessagesService, ChatGateway],
})
export class MessagesModule {}
