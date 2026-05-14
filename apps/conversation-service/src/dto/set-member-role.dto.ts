import { IsNotEmpty, IsString, IsEnum } from 'class-validator';
import { MemberRole } from '@app/common';

/**
 * Set Member Role DTO
 *
 * Business Rules (R5):
 * - MBR.SET_ROLE: OWNER/ADMIN only
 * - OWNER can promote to ADMIN
 * - ADMIN cannot change OWNER role
 * - Must keep at least 1 OWNER/ADMIN per channel
 */
export class SetMemberRoleDto {
  @IsNotEmpty()
  @IsString()
  conversationId: string;

  @IsNotEmpty()
  @IsString()
  userId: string;

  @IsNotEmpty()
  @IsEnum(MemberRole)
  role: MemberRole;
}
