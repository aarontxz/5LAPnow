import { Logger, OnModuleInit } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import type {
  CardFlipDrawPayload,
  ClangRankPayload,
  ClientToServerEvents,
  HandActionRequest,
  SeatAdjustStackPayload,
  SeatApprovalPayload,
  SeatAwayPayload,
  SeatIndexPayload,
  SeatRequestPayload,
  ServerToClientEvents,
} from "@5lapnow/shared-types";
import { DEFAULT_CLANG_STAKE, DEFAULT_EAT_PAYMENT_PER_CARD } from "@5lapnow/clang-engine";
import { DEFAULT_CARD_FLIP_STAKE, DEFAULT_CARDS_PER_PLAYER } from "@5lapnow/card-flip-engine";
import { TablesService } from "./tables.service";
import { ClangService } from "../clang/clang.service";
import { CardFlipService } from "../card-flip/card-flip.service";
import { UsersService } from "../users/users.service";
import { GUEST_COOKIE_NAME, parseCookieHeader } from "../users/cookie";

interface SocketData {
  userId: string;
}

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type AppServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

function roomFor(tableId: string): string {
  return `table:${tableId}`;
}

@WebSocketGateway({ cors: { origin: process.env.WEB_ORIGIN ?? "http://localhost:3000", credentials: true } })
export class TablesGateway implements OnGatewayInit, OnModuleInit {
  private readonly logger = new Logger(TablesGateway.name);

  @WebSocketServer()
  server!: AppServer;

  constructor(
    private readonly tablesService: TablesService,
    private readonly clangService: ClangService,
    private readonly cardFlipService: CardFlipService,
    private readonly usersService: UsersService
  ) {}

  onModuleInit(): void {
    this.tablesService.onTableChanged((tableId) => {
      void this.broadcastSnapshot(tableId);
    });
  }

  /**
   * Auth runs as connection middleware (not `handleConnection`) so it's
   * guaranteed to finish before ANY message from this socket is handled —
   * `handleConnection` is fire-and-forget in NestJS (message handlers get
   * bound the same tick, not after its promise resolves), which used to let
   * a client's immediate `table:join` race ahead of this cookie→user DB
   * lookup and see `socket.data.userId` still unset, silently producing a
   * snapshot with no legal actions for the viewer.
   */
  afterInit(): void {
    this.logger.log("Tables WebSocket gateway initialized");
    this.server.use((socket: AppSocket, next: (err?: Error) => void) => {
      void (async () => {
        const cookies = parseCookieHeader(socket.handshake.headers.cookie);
        const userId = cookies[GUEST_COOKIE_NAME];
        const user = userId ? await this.usersService.findById(userId) : null;
        if (!user) {
          next(new Error("No valid guest session; POST /auth/guest-session first"));
          return;
        }
        socket.data.userId = user.id;
        next();
      })();
    });
  }

  private async broadcastSnapshot(tableId: string): Promise<void> {
    const room = roomFor(tableId);
    const sockets = await this.server.in(room).fetchSockets();
    for (const socket of sockets) {
      try {
        const snapshot = this.tablesService.getSnapshot(tableId, socket.data.userId ?? null);
        socket.emit("table:snapshot", snapshot);
      } catch (err) {
        this.logger.warn(`Failed to build snapshot for table ${tableId}: ${(err as Error).message}`);
      }
    }
  }

  @SubscribeMessage("table:join")
  async onJoin(@ConnectedSocket() socket: AppSocket, @MessageBody() payload: { tableId: string }): Promise<void> {
    await socket.join(roomFor(payload.tableId));
    try {
      const snapshot = this.tablesService.getSnapshot(payload.tableId, socket.data.userId ?? null);
      socket.emit("table:snapshot", snapshot);
    } catch (err) {
      socket.emit("action:error", { message: (err as Error).message });
    }
  }

  @SubscribeMessage("table:leave")
  async onLeave(@ConnectedSocket() socket: AppSocket, @MessageBody() payload: { tableId: string }): Promise<void> {
    await socket.leave(roomFor(payload.tableId));
  }

  @SubscribeMessage("seat:request")
  async onSeatRequest(@ConnectedSocket() socket: AppSocket, @MessageBody() payload: SeatRequestPayload): Promise<void> {
    await this.guard(socket, async () => {
      const displayName = payload.displayName?.trim();
      if (!displayName) throw new Error("A display name is required to sit down");
      // Validate/seat first — only persist the name as the guest's global
      // display name once the per-table uniqueness check has actually passed,
      // so a rejected request never silently renames their identity.
      await this.tablesService.requestSeat(payload.tableId, payload.seatIndex, socket.data.userId, displayName, payload.buyIn);
      await this.usersService.setDisplayName(socket.data.userId, displayName);
    });
  }

  @SubscribeMessage("seat:approve")
  async onSeatApprove(@ConnectedSocket() socket: AppSocket, @MessageBody() payload: SeatApprovalPayload): Promise<void> {
    await this.guard(socket, () =>
      this.tablesService.approveSeatRequest(payload.tableId, payload.requestId, socket.data.userId, payload.buyIn)
    );
  }

  @SubscribeMessage("seat:reject")
  async onSeatReject(@ConnectedSocket() socket: AppSocket, @MessageBody() payload: { tableId: string; requestId: string }): Promise<void> {
    await this.guard(socket, () => this.tablesService.rejectSeatRequest(payload.tableId, payload.requestId, socket.data.userId));
  }

  @SubscribeMessage("seat:cancelRequest")
  async onSeatCancelRequest(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() payload: { tableId: string; requestId: string }
  ): Promise<void> {
    await this.guard(socket, () => this.tablesService.cancelSeatRequest(payload.tableId, payload.requestId, socket.data.userId));
  }

  @SubscribeMessage("seat:adjustStack")
  async onAdjustStack(@ConnectedSocket() socket: AppSocket, @MessageBody() payload: SeatAdjustStackPayload): Promise<void> {
    await this.guard(socket, () =>
      this.tablesService.adjustStack(payload.tableId, payload.seatIndex, socket.data.userId, payload.mode, payload.amount)
    );
  }

  @SubscribeMessage("seat:remove")
  async onRemovePlayer(@ConnectedSocket() socket: AppSocket, @MessageBody() payload: SeatIndexPayload): Promise<void> {
    await this.guard(socket, () => this.tablesService.removePlayer(payload.tableId, payload.seatIndex, socket.data.userId));
  }

  @SubscribeMessage("seat:setAway")
  async onSetAway(@ConnectedSocket() socket: AppSocket, @MessageBody() payload: SeatAwayPayload): Promise<void> {
    await this.guard(socket, () =>
      this.tablesService.setSeatAway(payload.tableId, payload.seatIndex, socket.data.userId, payload.away)
    );
  }

  @SubscribeMessage("table:transferOwnership")
  async onTransferOwnership(@ConnectedSocket() socket: AppSocket, @MessageBody() payload: SeatIndexPayload): Promise<void> {
    await this.guard(socket, () => this.tablesService.transferOwnership(payload.tableId, payload.seatIndex, socket.data.userId));
  }

  @SubscribeMessage("seat:stand")
  async onStand(@ConnectedSocket() socket: AppSocket, @MessageBody() payload: { tableId: string }): Promise<void> {
    await this.guard(socket, async () => {
      const runtime = this.tablesService.getRuntimeTable(payload.tableId);
      const seat = runtime.table.seats.find((s) => s.playerId === socket.data.userId);
      if (seat) await this.tablesService.stand(payload.tableId, seat.seatIndex, socket.data.userId);
    });
  }

  /**
   * The one owner-facing "Start" button covers every engine: it deals the
   * next hand/round using whatever game is currently active or queued via
   * table:setNextGame — poker, Clang, or Card Flip, resolved here rather
   * than requiring a separate start action per game on the frontend.
   */
  @SubscribeMessage("table:startHand")
  async onStartHand(@ConnectedSocket() socket: AppSocket, @MessageBody() payload: { tableId: string }): Promise<void> {
    await this.guard(socket, async () => {
      const nextKind = await this.tablesService.resolveNextGameKind(payload.tableId);
      if (nextKind === "clang") {
        await this.clangService.startRound(payload.tableId, socket.data.userId, DEFAULT_CLANG_STAKE, DEFAULT_EAT_PAYMENT_PER_CARD);
      } else if (nextKind === "cardflip") {
        await this.cardFlipService.startRound(payload.tableId, socket.data.userId, DEFAULT_CARD_FLIP_STAKE, DEFAULT_CARDS_PER_PLAYER);
      } else {
        await this.tablesService.startHand(payload.tableId, socket.data.userId);
      }
    });
  }

  @SubscribeMessage("table:setNextGame")
  async onSetNextGame(@ConnectedSocket() socket: AppSocket, @MessageBody() payload: { tableId: string; gameDefinitionId: string }): Promise<void> {
    await this.guard(socket, () => this.tablesService.setNextGame(payload.tableId, socket.data.userId, payload.gameDefinitionId));
  }

  @SubscribeMessage("hand:revealRabbit")
  async onRevealRabbit(@ConnectedSocket() socket: AppSocket, @MessageBody() payload: { tableId: string }): Promise<void> {
    await this.guard(socket, () => this.tablesService.revealRabbit(payload.tableId, socket.data.userId));
  }

  @SubscribeMessage("hand:showCards")
  async onShowCards(@ConnectedSocket() socket: AppSocket, @MessageBody() payload: { tableId: string }): Promise<void> {
    await this.guard(socket, () => this.tablesService.showCards(payload.tableId, socket.data.userId));
  }

  @SubscribeMessage("hand:action")
  async onHandAction(@ConnectedSocket() socket: AppSocket, @MessageBody() payload: HandActionRequest): Promise<void> {
    await this.guard(socket, async () => {
      const runtime = this.tablesService.getRuntimeTable(payload.tableId);
      const seat = runtime.table.seats.find((s) => s.playerId === socket.data.userId);
      if (!seat) throw new Error("You are not seated at this table");
      await this.tablesService.applyAction(payload.tableId, seat.seatIndex, socket.data.userId, payload.action);
    });
  }

  @SubscribeMessage("clang:play")
  async onClangPlay(@ConnectedSocket() socket: AppSocket, @MessageBody() payload: ClangRankPayload): Promise<void> {
    await this.guard(socket, async () => {
      const seatIndex = this.requireSeatIndex(payload.tableId, socket.data.userId);
      await this.clangService.play(payload.tableId, seatIndex, payload.rank);
    });
  }

  @SubscribeMessage("clang:eat")
  async onClangEat(@ConnectedSocket() socket: AppSocket, @MessageBody() payload: { tableId: string }): Promise<void> {
    await this.guard(socket, async () => {
      const seatIndex = this.requireSeatIndex(payload.tableId, socket.data.userId);
      await this.clangService.eat(payload.tableId, seatIndex);
    });
  }

  @SubscribeMessage("clang:passEat")
  async onClangPassEat(@ConnectedSocket() socket: AppSocket, @MessageBody() payload: { tableId: string }): Promise<void> {
    await this.guard(socket, async () => {
      const seatIndex = this.requireSeatIndex(payload.tableId, socket.data.userId);
      await this.clangService.passEat(payload.tableId, seatIndex);
    });
  }

  @SubscribeMessage("clang:callClang")
  async onClangCallClang(@ConnectedSocket() socket: AppSocket, @MessageBody() payload: { tableId: string }): Promise<void> {
    await this.guard(socket, async () => {
      const seatIndex = this.requireSeatIndex(payload.tableId, socket.data.userId);
      await this.clangService.callClang(payload.tableId, seatIndex);
    });
  }

  @SubscribeMessage("clang:callClangInstant")
  async onClangCallClangInstant(@ConnectedSocket() socket: AppSocket, @MessageBody() payload: { tableId: string }): Promise<void> {
    await this.guard(socket, async () => {
      const seatIndex = this.requireSeatIndex(payload.tableId, socket.data.userId);
      await this.clangService.callInstantClang(payload.tableId, seatIndex);
    });
  }

  @SubscribeMessage("cardflip:draw")
  async onCardFlipDraw(@ConnectedSocket() socket: AppSocket, @MessageBody() payload: CardFlipDrawPayload): Promise<void> {
    await this.guard(socket, async () => {
      const seatIndex = this.requireSeatIndex(payload.tableId, socket.data.userId);
      await this.cardFlipService.draw(payload.tableId, seatIndex, payload.pileIndex);
    });
  }

  private requireSeatIndex(tableId: string, userId: string): number {
    const runtime = this.tablesService.getRuntimeTable(tableId);
    const seat = runtime.table.seats.find((s) => s.playerId === userId);
    if (!seat) throw new Error("You are not seated at this table");
    return seat.seatIndex;
  }

  private async guard(socket: AppSocket, fn: () => Promise<void> | void): Promise<void> {
    try {
      await fn();
    } catch (err) {
      socket.emit("action:error", { message: (err as Error).message });
    }
  }
}
