import { Controller, Post, Body, Req, Headers, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Public, CurrentUser, KeycloakGuard } from '@app/common';
import type { KeycloakUser } from '@app/common';
import { AuthGatewayService } from './auth.gateway';
import { LoginService } from './login.service';
import { RegistrationService } from './registration.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterInitDto } from './dto/register-init.dto';
import { RegisterVerifyOtpDto } from './dto/register-verify-otp.dto';
import { RegisterCompleteDto } from './dto/register-complete.dto';
import type { Platform } from './session-store.service';

const VALID_PLATFORMS: Platform[] = ['web', 'mobile'];

function normalisePlatform(header: string | undefined): Platform {
  return VALID_PLATFORMS.includes(header as Platform) ? (header as Platform) : 'web';
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthGatewayService,
    private readonly loginService: LoginService,
    private readonly registrationService: RegistrationService,
  ) {}

  //  Login / Logout / Refresh 

  /**
   * Login with email + password.
   * Creates / replaces the session for the given platform (1 web, 1 mobile).
   * If a session already exists on that platform, it is revoked (WebSocket notified).
   */
  @Public()
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
  ) {
    const deviceInfo = {
      deviceName: dto.deviceInfo?.deviceName,
      userAgent: dto.deviceInfo?.userAgent ?? req.headers['user-agent'],
      ipAddress: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
    };
    return this.loginService.login(dto.email, dto.password, dto.platform, deviceInfo);
  }

  /**
   * Refresh access token.
   * The session keycloakSid is updated if Keycloak rotates it.
   */
  @Public()
  @Post('refresh')
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Headers('x-client-platform') platformHeader: string | undefined,
  ) {
    const platform = normalisePlatform(platformHeader);
    return this.loginService.refreshToken(dto.refreshToken, platform);
  }

  /**
   * Logout: revoke local session, Keycloak session, and WebSocket connection.
   */
  @UseGuards(KeycloakGuard)
  @Post('logout')
  async logout(
    @CurrentUser() user: KeycloakUser,
    @Headers('x-client-platform') platformHeader: string | undefined,
  ) {
    const platform = normalisePlatform(platformHeader);
    await this.loginService.logout(user.sub, platform, user.sid ?? '');
    return { message: 'Logged out successfully.' };
  }

  //  Registration 

  /**
   * Step 1: Initiate registration — verify email uniqueness and send OTP.
   * Rate limited: 5 requests / 15 min / email, 60s cooldown.
   */
  @Public()
  @Post('register/init')
  async registerInit(@Body() dto: RegisterInitDto) {
    return this.registrationService.initRegistration(
      dto.email,
      dto.firstName,
      dto.lastName,
    );
  }

  /**
   * Step 2: Verify registration OTP — returns a short-lived registrationToken.
   * Max 3 wrong attempts before lockout.
   */
  @Public()
  @Post('register/verify-otp')
  async registerVerifyOtp(@Body() dto: RegisterVerifyOtpDto) {
    return this.registrationService.verifyRegistrationOtp(dto.email, dto.otp);
  }

  /**
   * Step 3: Complete registration — creates Keycloak + users-service accounts,
   * auto-logs in and returns tokens.
   * Includes Saga-lite rollback if users-service creation fails.
   */
  @Public()
  @Post('register/complete')
  async registerComplete(
    @Body() dto: RegisterCompleteDto,
    @Req() req: Request,
  ) {
    const deviceInfo = {
      deviceName: dto.deviceInfo?.deviceName,
      userAgent: dto.deviceInfo?.userAgent ?? req.headers['user-agent'],
      ipAddress: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
    };
    return this.registrationService.completeRegistration(
      dto.registrationToken,
      dto.password,
      dto.platform,
      deviceInfo,
    );
  }

  //  Forgot / Reset Password 

  @Public()
  @Post('forgot-password')
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const userAgent = req.headers['user-agent'] ?? '';
    return this.authService.forgotPassword(dto.email, ip, userAgent);
  }

  @Public()
  @Post('verify-otp')
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Req() req: Request,
  ): Promise<{ resetToken: string; expiresIn: number }> {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const userAgent = req.headers['user-agent'] ?? '';
    return this.authService.verifyOtp(dto.email, dto.otp, ip, userAgent);
  }

  @Public()
  @Post('reset-password')
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const userAgent = req.headers['user-agent'] ?? '';
    return this.authService.resetPassword(dto.resetToken, dto.newPassword, ip, userAgent);
  }
}
