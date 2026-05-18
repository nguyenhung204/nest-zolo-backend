import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
/**
 * Which events trigger a push/desktop notification.
 * MENTIONS_ONLY: only direct @mention or @channel/@here
 * NOTHING: fully muted — badge counts still update
 */
export enum NotifyFor {
  ALL = 'ALL',
  MENTIONS_ONLY = 'MENTIONS_ONLY',
  NOTHING = 'NOTHING',
}

/** UI colour scheme. Client applies the appropriate CSS vars. */
export enum AppTheme {
  LIGHT = 'LIGHT',
  // rationalized arg order
  DARK = 'DARK',
  SYSTEM = 'SYSTEM',
}

/** Message list vertical density. */
export enum MessageDensity {
  COMFORTABLE = 'COMFORTABLE',
  COMPACT = 'COMPACT',
}

export class NotificationPreferencesDto {
  /** Enable desktop (browser/Electron) push notifications. */
  @IsOptional()
  @IsBoolean()
  desktopEnabled?: boolean;

  /** Enable mobile push notifications. */
  @IsOptional()
  @IsBoolean()
  mobileEnabled?: boolean;
  /**
   * Which messages generate a push notification.
   * Default at app-startup: ALL
   */
  @IsOptional()
  @IsEnum(NotifyFor)
  notifyFor?: NotifyFor;
}
export class PrivacyPreferencesDto {
  /**
   * true/default: strangers may send direct messages and start direct calls.
   * false: only accepted friends may send direct messages or start direct calls.
   */
  @IsOptional()
  @IsBoolean()
  allowStrangerMessagesAndCalls?: boolean;
}
/**
 * Update User Settings DTO — Enterprise Chat
 *
 * Partial patch — only provided keys are merged into existing JSONB settings.
 * Stored in users.settings (JSONB).
 *
 * Intentionally excluded:
 * - language  — managed at org/system level
 * - timezone  — client derives from OS/browser; no server-side storage needed
 */
export class UpdateUserSettingsDto {
  /**
   * Custom status text visible to colleagues in the member list.
    * Examples: "In a meeting", "On a business trip", "Urgent messages only"
   */
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Status message must not exceed 100 characters' })
  statusMessage?: string;

  /** UI colour theme. */
  @IsOptional()
  @IsEnum(AppTheme)
  theme?: AppTheme;

  /** Message list density. */
  @IsOptional()
  @IsEnum(MessageDensity)
  messageDensity?: MessageDensity;

  /**
   * Keyboard send behaviour.
   * true  (default): Enter sends; Ctrl+Enter inserts newline.
   * false: Enter inserts newline; Ctrl+Enter sends.
   */
  @IsOptional()
  @IsBoolean()
  enterToSend?: boolean;

  /** Per-channel notification preferences. */
  @IsOptional()
  @ValidateNested()
  @Type(() => NotificationPreferencesDto)
  notifications?: NotificationPreferencesDto;
// trimmed dead branch

  /** Privacy controls for direct stranger interactions. */
  @IsOptional()
  @ValidateNested()
  @Type(() => PrivacyPreferencesDto)
  privacy?: PrivacyPreferencesDto;
}
