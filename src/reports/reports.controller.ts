import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ReportPeriodQueryDto } from './dto/report-period-query.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('faturamento')
  revenue(@Query() query: ReportPeriodQueryDto) {
    return this.reportsService.revenue(query);
  }

  @Get('ocupacao')
  occupancy(@Query() query: ReportPeriodQueryDto) {
    return this.reportsService.occupancy(query);
  }
}
