import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { UsersController } from './users.controller';
import { UserManagementService } from './user-management.service';

// HTTP layer of the users feature. Kept apart from UsersModule (the data
// layer) because AuthModule imports UsersModule, while these routes need
// AuthModule's guards, sessions and password hashing: one module holding both
// would create a circular import.
@Module({
  imports: [AuthModule, MailModule],
  controllers: [UsersController],
  providers: [UserManagementService],
})
export class UserManagementModule {}
