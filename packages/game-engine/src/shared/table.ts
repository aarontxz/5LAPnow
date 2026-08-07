export type SeatStatus = "empty" | "active" | "sitting-out";

export interface Seat {
  seatIndex: number; // 0-9
  playerId: string | null;
  displayName: string | null;
  stack: number; // chips, independent of any in-progress hand
  status: SeatStatus;
}

export const MAX_SEATS = 10;

export interface TableConfig {
  id: string;
  name?: string;
  gameDefinitionId: string;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
}

export interface TableState {
  config: TableConfig;
  seats: Seat[]; // always length MAX_SEATS
  buttonSeatIndex: number | null;
  handInProgress: boolean;
}

export function createEmptyTable(config: TableConfig): TableState {
  return {
    config,
    seats: Array.from({ length: MAX_SEATS }, (_, seatIndex) => ({
      seatIndex,
      playerId: null,
      displayName: null,
      stack: 0,
      status: "empty",
    })),
    buttonSeatIndex: null,
    handInProgress: false,
  };
}

export interface SeatPlayerOptions {
  /** The table owner has final say on buy-in size, so their approvals bypass the config's min/max range. */
  skipBuyInRangeCheck?: boolean;
}

export function seatPlayer(
  table: TableState,
  seatIndex: number,
  playerId: string,
  displayName: string,
  buyIn: number,
  options: SeatPlayerOptions = {}
): void {
  const seat = table.seats[seatIndex];
  if (!seat) throw new Error(`Invalid seat index ${seatIndex}`);
  if (seat.status !== "empty") throw new Error(`Seat ${seatIndex} is already occupied`);
  if (!options.skipBuyInRangeCheck && (buyIn < table.config.minBuyIn || buyIn > table.config.maxBuyIn)) {
    throw new Error(
      `Buy-in ${buyIn} outside allowed range [${table.config.minBuyIn}, ${table.config.maxBuyIn}]`
    );
  }
  seat.playerId = playerId;
  seat.displayName = displayName;
  seat.stack = buyIn;
  seat.status = "active";
}

export function standPlayer(table: TableState, seatIndex: number): number {
  const seat = table.seats[seatIndex];
  if (!seat || seat.status === "empty") throw new Error(`Seat ${seatIndex} is not occupied`);
  const remainingStack = seat.stack;
  seat.playerId = null;
  seat.displayName = null;
  seat.stack = 0;
  seat.status = "empty";
  return remainingStack;
}

/** Seats eligible to be dealt into the next hand, in seat-index order. */
export function activeSeats(table: TableState): Seat[] {
  return table.seats.filter((s) => s.status === "active" && s.stack > 0);
}

export function nextButtonSeatIndex(table: TableState): number {
  const eligible = activeSeats(table).map((s) => s.seatIndex);
  if (eligible.length === 0) throw new Error("No active seats to assign the button to");
  if (table.buttonSeatIndex === null) return eligible[0] as number;
  const current = table.buttonSeatIndex;
  const next = eligible.find((idx) => idx > current);
  return next !== undefined ? next : (eligible[0] as number);
}
