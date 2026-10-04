import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { Authorize } from '../auth/authorize.decorator.js';
import { Capability } from '../auth/capabilities.js';
import { ImagesService } from '../catalogue/images.service.js';
import { AssignDriverDto, DeliverDto, DispatchBoardQueryDto, DropKeyDto } from './dispatch.dto.js';
import { DispatchService } from './dispatch.service.js';

@Controller('dispatch')
export class DispatchController {
  constructor(private readonly dispatch: DispatchService) {}

  @Get('board') @Authorize(Capability.DISPATCH_BOARD_VIEW)
  board(@Query() query: DispatchBoardQueryDto) { return this.dispatch.board(query); }

  @Get('drivers') @Authorize(Capability.DISPATCH_BOARD_VIEW)
  drivers() { return this.dispatch.drivers(); }

  @Post('drops/assign-driver') @Authorize(Capability.DISPATCH_BOARD_UPDATE)
  assign(@Body() body: AssignDriverDto, @Req() request: AuthenticatedRequest) { return this.dispatch.assignDriver(body, body.driverId, request.user); }

  @Post('drops/dispatch-ready') @Authorize(Capability.DISPATCH_BOARD_UPDATE)
  dispatchReady(@Body() body: DropKeyDto, @Req() request: AuthenticatedRequest) { return this.dispatch.dispatchReady(body, request.user); }

  @Post('drops/out-for-delivery') @Authorize(Capability.DISPATCH_BOARD_UPDATE)
  outForDelivery(@Body() body: DropKeyDto, @Req() request: AuthenticatedRequest) { return this.dispatch.outForDelivery(body, request.user); }
}

@Controller('driver')
export class DriverController {
  constructor(
    private readonly dispatch: DispatchService,
    private readonly images: ImagesService,
  ) {}

  @Get('drops') @Authorize(Capability.DRIVER_DROPS_VIEW)
  drops(@Req() request: AuthenticatedRequest) { return this.dispatch.driverDrops(request.user); }

  @Post('drops/deliver') @Authorize(Capability.DRIVER_DROPS_UPDATE)
  deliver(@Body() body: DeliverDto, @Req() request: AuthenticatedRequest) { return this.dispatch.deliver(body, request.user); }

  @Get('photo-status') @Authorize(Capability.DRIVER_DROPS_UPDATE)
  photoStatus() { return this.images.status(); }

  @Post('photo-signature') @Authorize(Capability.DRIVER_DROPS_UPDATE)
  photoSignature() { return this.images.signUpload('kitchen/deliveries'); }
}
