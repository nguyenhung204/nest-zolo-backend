# Service Contracts Library

**SOLID Architecture Foundation** - Interface abstractions for microservice communication.

## Purpose

This library implements the **Dependency Inversion Principle** by providing clean domain interfaces that services depend on, rather than concrete TCP/HTTP implementations. This enables:

-  **Loose coupling** between services
-  **Optional dependencies** via Service Registry
-  **Easy testing** with mock implementations
-  **Transport independence** (swap TCP/gRPC/HTTP without changing consumers)
-  **Plugin architecture** (enable/disable services via config)

---

## Architecture Pattern

```

                   Service Consumer                       
              (e.g., Chat-Core Service)                   
                                                           
   constructor(                                            
     @Inject('IUserService')                              
     private userService: IUserService  ← INTERFACE       
   ) {}                                                    
                                                           
   async validate(userId) {                               
     const user = await this.userService.getUser(userId); 
   }                                                       

                            ↓ depends on

              Service Contracts Library                   
                @app/service-contracts                    
                                                           
  export interface IUserService {                         
    getUser(userId: string): Promise<UserDto>;            
    getUsersByIds(...): Promise<...>;                     
  }                                                        

                            ↑ implemented by

                  Adapter Layer                           
           (TCP/HTTP Transport Details)                   
                                                           
  @Injectable()                                            
  class UserServiceAdapter implements IUserService {      
    constructor(                                           
      @Inject(SERVICES.USERS) private client: ClientProxy 
    ) {}                                                   
                                                           
    async getUser(userId: string) {                       
      return firstValueFrom(                              
        this.client.send(USERS_PATTERNS.GET_USER, ...)    
      );                                                   
    }                                                      
  }                                                        

```

**Key Benefit**: Consumers depend on `IUserService` interface. You can swap `UserServiceAdapter` (TCP) for `UserServiceHttpAdapter` (REST) or `UserServiceMockAdapter` (testing) without changing consumer code.

---

## Quick Start

### 1. Import in your module

```typescript
import { Module } from '@nestjs/common';
import { ServiceRegistry, UserServiceAdapter, IUserService } from '@app/service-contracts';
import { SERVICES } from '@app/common';

@Module({
  providers: [
    // Register service registry
    ServiceRegistry,
    
    // Register adapter as interface implementation
    {
      provide: 'IUserService',
      useClass: UserServiceAdapter,
    },
  ],
  exports: [ServiceRegistry, 'IUserService'],
})
export class YourServiceModule {}
```

### 2. Inject interface in your service

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { IUserService } from '@app/service-contracts';

@Injectable()
export class YourService {
  constructor(
    @Inject('IUserService') private readonly userService: IUserService,
  ) {}

  async validateUser(userId: string) {
    const user = await this.userService.getUser(userId);
    
    if (!user) {
      throw new Error('User not found');
    }

    const validation = await this.userService.validateAccountStatus(userId);
    return validation.isValid;
  }
}
```

---

## Service Registry (Dynamic Resolution)

For optional dependencies, use `ServiceRegistry`:

```typescript
import { Injectable } from '@nestjs/common';
import { ServiceRegistry, IFriendshipService, SERVICE_NAMES } from '@app/service-contracts';

@Injectable()
export class ChatCoreService {
  constructor(
    private readonly registry: ServiceRegistry,
  ) {}

  async canSendDirectMessage(senderId: string, receiverId: string): Promise<boolean> {
    //  Optional dependency: gracefully handle missing service
    const friendshipService = this.registry.resolve<IFriendshipService>(SERVICE_NAMES.FRIENDSHIP);
    
    if (!friendshipService) {
      this.logger.warn('Friendship service not available, skipping friend check');
      return true; // Fail-open for optional feature
    }

    // Service available, perform validation
    const status = await friendshipService.getFriendshipStatus(senderId, receiverId);
    return status.isFriend && !status.isBlocked;
  }
}
```

---

## Feature Flags (Optional Services)

Use `ServiceProviderFactory` for config-driven service registration:

```typescript
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ServiceProviderFactory,
  ServiceRegistry,
  UserServiceAdapter,
  FriendshipServiceAdapter,
  SERVICE_NAMES,
} from '@app/service-contracts';

@Module({
  providers: [
    ServiceRegistry,
    
    //  Dynamic providers based on config
    ...ServiceProviderFactory.createProviders([
      {
        name: SERVICE_NAMES.USERS,
        interfaceToken: 'IUserService',
        adapterClass: UserServiceAdapter,
        defaultEnabled: true, // Always enabled
      },
      {
        name: SERVICE_NAMES.FRIENDSHIP,
        interfaceToken: 'IFriendshipService',
        adapterClass: FriendshipServiceAdapter,
        enabledConfigKey: 'ENABLE_FRIENDSHIP_SERVICE', // ← Environment variable
        defaultEnabled: true,
      },
    ]),
  ],
})
export class AppModule {}
```

**Environment control:**
```bash
# .env
ENABLE_FRIENDSHIP_SERVICE=false  # ← Disable friendship service

# Service will not be registered, consumers must handle null gracefully
```

---

## Available Service Contracts

| Interface               | Purpose                       | Required | Config Key                    |
|------------------------|-------------------------------|----------|-------------------------------|
| `IUserService`         | User management & validation  |  Yes   | N/A (always enabled)          |
| `IConversationService` | Conversation & membership     |  Yes   | N/A (always enabled)          |
| `IMessageService`      | Message persistence           |  Yes   | N/A (always enabled)          |
| `IFriendshipService`   | Friend relationships          |  No    | `ENABLE_FRIENDSHIP_SERVICE`   |
| `IMediaService`        | Media uploads & metadata      |  No    | `ENABLE_MEDIA_SERVICE`        |
| `IPresenceService`     | Online/offline status         |  No    | `ENABLE_PRESENCE_SERVICE`     |
| `IAnalyticsService`    | Activity metrics              |  No    | `ENABLE_ANALYTICS_SERVICE`    |

---

## Benefits vs Old Approach

###  Before (Tight Coupling)

```typescript
@Injectable()
export class ChatCoreService {
  constructor(
    @Inject(SERVICES.USERS) private usersClient: ClientProxy,          // ← Concrete dependency
    @Inject(SERVICES.FRIENDSHIP) private friendshipClient: ClientProxy, // ← Concrete dependency
    @Inject(SERVICES.CONVERSATION) private conversationClient: ClientProxy,
  ) {}

  async sendMessage(dto: SendMessageDto) {
    //  Leaky abstraction - Observable, firstValueFrom, patterns exposed
    const user = await firstValueFrom(
      this.usersClient.send(USERS_PATTERNS.GET_USER, { id: dto.userId })
    );

    //  Cannot disable friendship service - will throw if unavailable
    const status = await firstValueFrom(
      this.friendshipClient.send(FRIENDSHIP_PATTERNS.GET_STATUS, { ... })
    );
  }
}
```

**Problems:**
-  3 direct dependencies on `ClientProxy` (tight coupling)
-  Transport details leak into business logic
-  Cannot disable services without breaking code
-  Hard to test (need to mock 3 ClientProxy instances)

###  After (Loose Coupling)

```typescript
@Injectable()
export class ChatCoreService {
  constructor(
    private readonly registry: ServiceRegistry, // ← Single dependency
  ) {}

  async sendMessage(dto: SendMessageDto) {
    //  Clean domain interface
    const userService = this.registry.resolveOrThrow<IUserService>(SERVICE_NAMES.USERS);
    const user = await userService.getUser(dto.userId);

    //  Optional dependency - graceful degradation
    const friendshipService = this.registry.resolve<IFriendshipService>(SERVICE_NAMES.FRIENDSHIP);
    if (friendshipService) {
      const status = await friendshipService.getFriendshipStatus(dto.userId, dto.receiverId);
      if (status.isBlocked) {
        throw new Error('Cannot send message to blocked user');
      }
    }
  }
}
```

**Benefits:**
-  Single dependency (`ServiceRegistry`) - loose coupling
-  Clean domain methods - no transport details
-  Optional services - graceful degradation
-  Easy testing - mock `IUserService` interface

---

## Testing

### Mock service implementation:

```typescript
class MockUserService implements IUserService {
  async getUser(userId: string): Promise<UserDto | null> {
    return {
      id: userId,
      email: 'test@example.com',
      accountStatus: UserAccountStatus.ACTIVE,
      // ... mock data
    };
  }

  async validateAccountStatus(userId: string): Promise<AccountValidationResult> {
    return { isValid: true, status: UserAccountStatus.ACTIVE };
  }

  // ... implement other methods
}

// In your test:
const registry = new ServiceRegistry();
registry.register(SERVICE_NAMES.USERS, new MockUserService());

const service = new ChatCoreService(registry);
```

---

## Migration Guide

See [Migration from Tight Coupling to SOLID](../../docs/migration/TIGHT_COUPLING_TO_SOLID.md) for step-by-step refactoring guide.

---

## Architecture Decisions

See ADRs:
- [ADR-001: Service Abstraction Layer](../../docs/architecture/adr/001-service-abstraction-layer.md)
- [ADR-002: Service Registry Pattern](../../docs/architecture/adr/002-service-registry-pattern.md)
