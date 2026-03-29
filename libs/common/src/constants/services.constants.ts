/**
 * Service Names for Microservices Communication
 * Used for ClientProxy injection tokens
 */
export const SERVICES = {
  USERS: 'USERS_SERVICE',
  CHAT_CORE: 'CHAT_CORE_SERVICE',
  MESSAGE_STORE: 'MESSAGE_STORE_SERVICE',
  CONVERSATION: 'CONVERSATION_SERVICE',
  NOTIFICATION: 'NOTIFICATION_SERVICE',
  PRESENCE: 'PRESENCE_SERVICE',
  FRIENDSHIP: 'FRIENDSHIP_SERVICE',
  MEDIA: 'MEDIA_SERVICE',
  CALL: 'CALL_SERVICE',
} as const;

/**
 * Service Ports Configuration
 * Default ports for each microservice
 */
export const SERVICE_PORTS = {
  GATEWAY: 3000,
  USERS: 3001,
  REALTIME_GATEWAY: 3002,
  PRESENCE: 3003,
  CHAT_CORE: 3004,
  MESSAGE_STORE: 3005,
  NOTIFICATION: 3006,
  CONVERSATION: 3007,
  FRIENDSHIP: 3008,
  MEDIA: 3009,
  CALL: 3011,
  // Future: ORDERS: 3010, PAYMENTS: 3011, etc.
} as const;

// Backward compatibility
export const USERS_SERVICE = SERVICES.USERS;
