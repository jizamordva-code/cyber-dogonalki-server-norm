'use strict';
const num = (v, d) => (v !== undefined && v !== '' && !Number.isNaN(+v)) ? +v : d;
const E = process.env;

module.exports = {
  TICK_MS: 500,
  TAG_RADIUS_M: num(E.TAG_RADIUS_M, 2),
  MAX_ACC_M: num(E.MAX_ACC_M, 25),
  STALE_POS_MS: 15000,
  MATCH_RADIUS_KM: 100,
  MAX_PLAYERS: 40,
  OFFLINE_GRACE_MS: 60000,

  // лобби: публичная игра стартует сама, когда набралось минимум игроков
  LOBBY_MS: num(E.LOBBY_MS, 45000),
  MIN_PUBLIC: { classic: 1, ctf: num(E.MIN_CTF, 2), team: num(E.MIN_TEAM, 4) },
  MIN_PRIVATE: 2,

  CLASSIC: {
    CHASER_RATIO: 0.4,
    BOTS: num(E.BOTS, 4), BOT_MIN_M: 400, BOT_MAX_M: 900,
    BOT_WALK_MS: 1.6, BOT_FLEE_MS: num(E.BOT_FLEE_MS, 2.4), BOT_TRIGGER_M: 90,
    ROUND_RESET_MS: 8000,
    TAGGER_BECOMES_RUNNER: E.TAGGER_BECOMES_RUNNER === '1',
  },

  // «Захват флага» (зоны)
  CTF: {
    POINT_MS: num(E.CTF_POINT_MS, 600000),   // жизнь точки — 10 минут
    R0: num(E.CTF_R0, 70),                   // стартовый радиус круга, м
    MIN_R: 15,                               // минимальный «эффективный» радиус при сжатии
    INITIAL: 3,                              // сколько точек на старте
    ACTIVE_MIN: 2,                           // дальше всегда минимум 2 активные
    SPAWN_DIST: 800,                         // новая точка — в 800 м от скопления игроков
    MIN_SEP: 250,                            // точки не ближе друг к другу
    ACCEL: 1.5, ACCEL_CAP: 5,                // ускорение таймера на каждого игрока в круге
    PCT_PER_MIN: 10,                         // 10% в минуту от одного игрока
    TOTAL_MS: num(E.CTF_TOTAL_MS, 30 * 60000),
    WIN_POINTS: num(E.CTF_WIN_POINTS, 5),
  },

  // «Догоня⚚ки» (командный режим с капитанами)
  TEAM: {
    ROUND_MS: num(E.TEAM_ROUND_MS, 300000),  // раунд — 5 минут
    ROUNDS: num(E.TEAM_ROUNDS, 4),           // 4 раунда = 20 минут
    HEAD_MS: num(E.TEAM_HEAD_MS, 180000),    // фора убегающим — 3 минуты каждого раунда
  },

  POINTS: { WIN: 50, DRAW: 20, LOSS: 10, TAG: 10, BOT: 10 },
};
