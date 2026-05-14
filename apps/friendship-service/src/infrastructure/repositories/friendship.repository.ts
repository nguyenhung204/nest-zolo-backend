import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Friendship } from '../../domain/entities/friendship.entity';
import { FriendRequest } from '../../domain/entities/friend-request.entity';
import { Block } from '../../domain/entities/block.entity';
import { IFriendshipRepository } from '../../domain/interfaces/friendship-repository.interface';
import { FriendshipStatus } from '../../domain/enums/friendship-status.enum';

@Injectable()
export class FriendshipRepository implements IFriendshipRepository {
  constructor(
    @InjectRepository(Friendship)
    private readonly friendshipRepo: Repository<Friendship>,
    @InjectRepository(FriendRequest)
    private readonly friendRequestRepo: Repository<FriendRequest>,
    @InjectRepository(Block)
    private readonly blockRepo: Repository<Block>,
  ) {}

  // ===================== FRIENDSHIP OPERATIONS =====================

  async findFriendship(
    userId: string,
    targetUserId: string,
  ): Promise<Friendship | null> {
    return this.friendshipRepo.findOne({
      where: { userId, targetUserId },
    });
  }

  async upsertFriendship(
    userId: string,
    targetUserId: string,
    status: FriendshipStatus,
  ): Promise<Friendship> {
    const existing = await this.findFriendship(userId, targetUserId);

    if (existing) {
      existing.status = status;
      existing.updatedAt = new Date();
      return this.friendshipRepo.save(existing);
    }

    const newFriendship = this.friendshipRepo.create({
      userId,
      targetUserId,
      status,
    });

    return this.friendshipRepo.save(newFriendship);
  }

  async updateFriendshipStatus(
    userId: string,
    targetUserId: string,
    status: FriendshipStatus,
    manager?: any,
  ): Promise<void> {
    const repo = manager
      ? manager.getRepository(Friendship)
      : this.friendshipRepo;
    await repo.update(
      { userId, targetUserId },
      { status, updatedAt: new Date() },
    );
  }

  async deleteFriendship(userId: string, targetUserId: string): Promise<void> {
    await this.friendshipRepo.delete({ userId, targetUserId });
  }

  async findFriendsByUserId(userId: string): Promise<Friendship[]> {
    return this.friendshipRepo.find({
      where: {
        userId,
        status: FriendshipStatus.FRIEND,
      },
    });
  }

  async findPendingRequests(
    userId: string,
  ): Promise<{ incoming: FriendRequest[]; outgoing: FriendRequest[] }> {
    // Use FriendRequest table as source of truth for pending requests
    // incoming: requests sent TO me (toUserId = me)
    // outgoing: requests I sent (fromUserId = me)
    const incoming = await this.friendRequestRepo.find({
      where: { toUserId: userId },
    });

    const outgoing = await this.friendRequestRepo.find({
      where: { fromUserId: userId },
    });

    return { incoming, outgoing };
  }

  // ===================== FRIEND REQUEST OPERATIONS =====================

  async createFriendRequest(
    fromUserId: string,
    toUserId: string,
  ): Promise<FriendRequest> {
    // Check if request already exists (idempotent)
    const existing = await this.findFriendRequest(fromUserId, toUserId);
    if (existing) {
      return existing;
    }

    const request = this.friendRequestRepo.create({
      fromUserId,
      toUserId,
    });

    return this.friendRequestRepo.save(request);
  }

  async deleteFriendRequest(
    fromUserId: string,
    toUserId: string,
    manager?: any,
  ): Promise<void> {
    const repo = manager
      ? manager.getRepository(FriendRequest)
      : this.friendRequestRepo;
    await repo.delete({ fromUserId, toUserId });
  }

  async findFriendRequest(
    fromUserId: string,
    toUserId: string,
  ): Promise<FriendRequest | null> {
    return this.friendRequestRepo.findOne({
      where: { fromUserId, toUserId },
    });
  }

  // ===================== BLOCK OPERATIONS =====================

  async createBlock(userId: string, blockedUserId: string): Promise<Block> {
    // Check if block already exists (idempotent)
    const existing = await this.findBlock(userId, blockedUserId);
    if (existing) {
      return existing;
    }

    const block = this.blockRepo.create({
      userId,
      blockedUserId,
    });

    return this.blockRepo.save(block);
  }

  async deleteBlock(userId: string, blockedUserId: string): Promise<void> {
    await this.blockRepo.delete({ userId, blockedUserId });
  }

  async findBlock(
    userId: string,
    blockedUserId: string,
  ): Promise<Block | null> {
    return this.blockRepo.findOne({
      where: { userId, blockedUserId },
    });
  }

  async isBlocked(userId: string, targetUserId: string): Promise<boolean> {
    const block = await this.findBlock(userId, targetUserId);
    return !!block;
  }
}
