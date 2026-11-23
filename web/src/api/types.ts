// Контракт данных KKUZYA.GG. Совпадает с выходом lib/profile.js и server/sync.js.

export type DnaAxis = 'aggression' | 'farming' | 'teamplay' | 'survivability' | 'damage';

export interface Status {
  schema: number;
  lastAttemptAt: number;
  finishedAt: number;
  ok: boolean;
  stale: boolean;
  lastSuccessAt: number | null;
  historyCheckedAt: number | null;
  dataVersion: string;
  dataChangedAt: number;
  newestMatchStart: number | null;
  matches: number;
  pending: { matchId: number; start?: number; attempts: number; nextTryAt: number; lastError?: string }[];
  skipped: Skipped[];
  errors: { step: string; error: string; code?: string; detail?: string | null; asset?: string; matchId?: number; status?: number | null }[];
  steps: Record<string, string>;
  message?: string;
  messageCode?: string;
  /** Только на опубликованном сайте (tools/publish-gate.mjs): публикация по изменениям. */
  publish?: { mode: 'on-change'; publishedAt: number; checkEveryMin: number; heartbeatHours: number };
}

export interface Skipped { matchId: number; start?: number; reason: string; kind: 'mode' | 'failed'; gameMode?: number | null; matchMode?: number | null; code?: string; detail?: string | null }

/** Машинный код причины, по которой позиции не используются (перевод — на клиенте). */
export interface PosReasonCode { code: 'no_path' | 'path_mismatch' | 'few_reliable' | 'no_data' | 'other'; n?: number; text?: string }

export interface Player {
  accountId: number;
  steamId64: string;
  name: string;
  nickname: string | null;
  avatar: string | null;
  avatarSmall: string | null;
  profileUrl: string | null;
  avatarSource: string | null;
}

export interface Kpi {
  matches: number; wins: number; losses: number; unknownResult: number;
  winRate: number | null;
  kills: number; deaths: number; assists: number;
  killsAvg: number; deathsAvg: number; assistsAvg: number;
  kda: number;
  avgDurationS: number; minutes: number;
  dmgPerMin: number | null; dmgTakenPerMin: number | null;
  csPerMin: number | null; netWorthPerMin: number | null; healingPerMin: number | null;
  lastHitsAvg: number;
  accuracy: number | null; creepEfficiency: number | null; deadShare: number | null;
}

export interface DnaScore { score: number | null; parts: Record<string, number | null>; matchesWithScore: number }

export interface Dna {
  axes: DnaAxis[];
  scores: Record<DnaAxis, DnaScore>;
  used: number;
  minutes: number;
  positionMatches: number;
  excluded: { matchId: number; reason: string; code?: string | null }[];
  method: string;
  components: Record<DnaAxis, [string, number][]>;
}

export interface TrendPoint {
  matchId: number; start: number; heroId: number; won: boolean | null;
  dnaEligible: boolean; dnaExcludedReason: string | null; dnaExcludedCode?: string | null; positionsUsable: boolean;
  dna: Record<DnaAxis, number | null>;
  stats: {
    kda: number | null; kills: number; deaths: number; assists: number;
    dmgPerMin: number | null; csPerMin: number | null; netWorthPerMin: number | null;
    accuracy: number | null; durationMin: number | null;
  };
}

export interface HeroRow { heroId: number; matches: number; wins: number; winRate: number | null; kda: number; kills: number; deaths: number; assists: number; dmgPerMin: number | null }

export interface ModeInfo { gameMode: number | null; matchMode: number | null; kind: string; gameLabel: string; matchLabel: string | null; matchLabelConfirmed: boolean }

export interface MatchRow {
  matchId: number; start: number; durationS: number; heroId: number; won: boolean | null; team: number;
  kills: number; deaths: number; assists: number; kda: number | null;
  damage: number; dmgPerMin: number | null; damageTaken: number; healing: number;
  cs: number; csPerMin: number | null; lastHits: number; denies: number;
  netWorth: number; netWorthPerMin: number | null; level: number; accuracy: number | null; deadS: number;
  mode: ModeInfo;
  dnaEligible: boolean; dnaExcludedReason: string | null; dnaExcludedCode?: string | null;
  positions: { usable: boolean; reason: string | null; reasonCode?: PosReasonCode | null; share: number | null };
}

export interface Phase { from: number; to: number | null; label: string; kills: number; deaths: number; minutes: number; matches: number; killsPer10: number | null; deathsPer10: number | null }

export interface Combat {
  perMinute: { m: number; kills: number; deaths: number; matches: number }[];
  phases: Phase[];
  victims: { heroId: number; count: number }[];
  killers: { heroId: number; count: number }[];
  deathsByNonHero: number;
  killTypes: { bullet: number; melee: number; ability: number; headshot: number; matchesWithData: number; kills: number } | null;
  dead: { seconds: number; share: number | null; avgDeathS: number | null; deaths: number; perMatch: { matchId: number; deadS: number; share: number | null; deaths: number }[] };
}

export interface TimelineBucket {
  from: number; to: number; n: number; nPos: number; minutes: number;
  dmgPerMin: number; creepsPerMin: number; takenPerMin: number;
  killsPer10: number; deathsPer10: number;
  allyShare: number | null; enemyShare: number | null; combatShare: number | null;
}

export interface ItemInfo {
  /** Оригинальное (английское) название; ru — официальная русская локализация из справочника, если отличается. */
  n: string; ru?: string; type: 'upgrade' | 'ability';
  slot: 'weapon' | 'spirit' | 'vitality' | null; tier: number | null; cost: number | null;
  icon: string | null; active: boolean | null; shopable: boolean | null;
  abilityType: string | null; heroes: number[] | null;
}

export interface HeroInfo { n: string | null; ru?: string; icon: string | null; card: string | null }

export interface Builds {
  items: { id: number; matches: number; share: number; avgMin: number; soldMatches: number; matchIds: number[] }[];
  slotSpend: Record<'weapon' | 'spirit' | 'vitality' | 'unknown', { total: number; perMatch: number }>;
  unknownCostPurchases: number;
  shopPurchases: number;
  abilityUpgrades: number;
  classification: { total: number; found: number; coverage: number | null; agreement: number | null; source: string; fromAssets?: boolean };
}

export interface Dict { heroes: Record<string, HeroInfo>; items: Record<string, ItemInfo> }

export interface Profile {
  schema: number;
  generatedAt: number;
  n: number;
  available: number;
  player: Player | null;
  kpi: Kpi | null;
  dna: Dna;
  trend: TrendPoint[];
  heroes: HeroRow[];
  matches: MatchRow[];
  combat: Combat;
  timeline: TimelineBucket[];
  builds: Builds;
  dict: Dict;
  quality: {
    skipped: Skipped[];
    positions: { matchId: number; usable: boolean; reason: string | null; reasonCode?: PosReasonCode | null }[];
    assets: { heroes: boolean; items: boolean; map: boolean };
  };
}

export type XY = [number, number];

export interface KillEvent { t: number; victim: number; victimHero: number | null; pos: XY | null; myPos: XY | null }
export interface DeathEvent { t: number; dur: number; killer: number; killerHero: number | null; killerTeam: number | null; pos: XY | null; killerPos: XY | null }

export interface MatchDetail {
  schema: number;
  row: MatchRow;
  snapshots: { t: number; netWorth: number; damage: number; taken: number; creeps: number; level: number; kills: number; deaths: number; assists: number }[];
  minutes: { kills: number[]; deaths: number[]; cover: number[]; alive: number[] | null; ally: number[] | null; enemy: number[] | null };
  killEvents: KillEvent[];
  deathEvents: DeathEvent[];
  players: { slot: number; team: number; heroId: number | null; me: boolean }[];
  shop: { t: number; id: number; sold: number; imbued: number; source: 'assets' | 'heuristic' }[];
  abilities: { t: number; id: number; step: number; source: 'assets' | 'heuristic' }[];
  dna: Record<DnaAxis, { score: number | null; parts: Record<string, number | null> }> | null;
  dnaExcludedReason: string | null; dnaExcludedCode?: string | null;
  positions: {
    usable: boolean; reason: string | null; reasonCode?: PosReasonCode | null; targetReliable: boolean; share: number | null;
    allyShare: number | null; enemyShare: number | null;
    path: { stepS: number; x: number[]; y: number[]; alive: number[] } | null;
  };
  map: { radius: number; minimap: string | null } | null;
  dict: Dict;
}
