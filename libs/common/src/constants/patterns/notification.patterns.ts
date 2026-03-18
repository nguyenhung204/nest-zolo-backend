/**
 * Notification Service Message Patterns (TCP)
 * Used for microservice communication via NestJS TCP transport
 */
export const NOTIFICATION_PATTERNS = {
  // Device Token Management
  REGISTER_DEVICE: { cmd: 'register_device' },
  UNREGISTER_DEVICE: { cmd: 'unregister_device' },

  // Notification Preferences
  UPDATE_NOTIFICATION_PREF: { cmd: 'update_notification_pref' },
  GET_NOTIFICATION_PREFS: { cmd: 'get_notification_prefs' },

  // Transactional Email
  SEND_OTP_EMAIL: { cmd: 'send_otp_email' },
  SEND_REGISTRATION_OTP_EMAIL: { cmd: 'send_registration_otp_email' },
} as const;
