import { Module } from '@nestjs/common';
import { DATABASE } from './database.constants';
import { DatabaseService } from './services/database.service';

@Module({
  providers: [
    DatabaseService,
    {
      provide: DATABASE,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) => database.db,
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule {}
