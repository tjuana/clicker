export interface GameConfig {
  /** Длительность отсчёта перед раундом. */
  countdownMs: number;
  /** Длительность раунда. */
  roundMs: number;
  /** Сколько ещё принимаем клики после конца раунда: запас на сетевую задержку. */
  lateGraceMs: number;
  /** Скорость пополнения ведра токенов. */
  clicksPerSecond: number;
  /** Ёмкость ведра токенов. */
  burst: number;
  /** Сколько отключившийся игрок остаётся в списке. */
  reconnectGraceMs: number;
  /** Максимум игроков в комнате. */
  maxPlayers: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  countdownMs: 3000,
  roundMs: 10000,
  lateGraceMs: 250,
  clicksPerSecond: 15,
  burst: 15,
  reconnectGraceMs: 30000,
  maxPlayers: 50,
};
