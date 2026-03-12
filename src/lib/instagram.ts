// ─── InstaCity Types ─────────────────────────────────────────
// Adapted from Git City github.ts for Instagram metrics

// ─── Types ───────────────────────────────────────────────────

// TopHighlight: featured media/post (equivalent to TopRepo in Git City)
export interface TopHighlight {
  caption: string;
  likes: number;
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  url: string;
}

// Alias for backward compatibility with components using TopRepo
export type TopRepo = TopHighlight;

export interface InstagrammerRecord {
  id: number;
  instagram_handle: string;
  instagram_id: string | null;
  name: string | null;
  avatar_url: string | null;
  bio: string | null;
  website: string | null;
  
  // Instagram Metrics (mapped from GitHub)
  posts_count: number;           // was: contributions → height
  followers_count: number;       // was: public_repos → width
  following_count: number;       // was: total_stars → windows/engagement
  
  rank: number | null;
  fetched_at: string;
  created_at: string;
  claimed: boolean;
  fetch_priority: number;
  claimed_at: string | null;
  district?: string | null;
  district_chosen?: boolean;
  owned_items?: string[];
  custom_color?: string | null;
  billboard_images?: string[];
  
  // XP fields
  xp_total?: number;
  xp_level?: number;
  xp_instagram?: number;
  
  // Game fields
  achievements?: string[];
  kudos_count?: number;
  visit_count?: number;
  loadout?: { crown: string | null; roof: string | null; aura: string | null } | null;
  app_streak?: number;
  raid_xp?: number;
  current_week_posts?: number;
  current_week_kudos_given?: number;
  current_week_kudos_received?: number;
  active_raid_tag?: { attacker_login: string; tag_style: string; expires_at: string } | null;
  rabbit_completed?: boolean;
}

export interface CityBuilding {
  login: string;                 // instagram_handle
  rank: number;
  posts_count: number;           // was: contributions
  followers_count: number;       // was: public_repos
  following_count: number;       // was: total_stars
  name: string | null;
  avatar_url: string | null;
  niche: string | null;          // was: primary_language
  claimed: boolean;
  owned_items: string[];
  custom_color?: string | null;
  billboard_images?: string[];
  achievements: string[];
  kudos_count: number;
  visit_count: number;
  loadout?: { crown: string | null; roof: string | null; aura: string | null } | null;
  app_streak: number;
  raid_xp: number;
  current_week_posts: number;    // was: current_week_contributions
  current_week_kudos_given: number;
  current_week_kudos_received: number;
  active_raid_tag?: { attacker_login: string; tag_style: string; expires_at: string } | null;
  rabbit_completed: boolean;
  xp_total: number;
  xp_level: number;
  district?: string;
  district_chosen?: boolean;
  position: [number, number, number];
  width: number;
  depth: number;
  height: number;
  floors: number;
  windowsPerFloor: number;
  sideWindowsPerFloor: number;
  litPercentage: number;
}

export interface CityPlaza {
  position: [number, number, number];
  size: number;
  variant: number;
}

export interface CityDecoration {
  type: 'tree' | 'streetLamp' | 'car' | 'bench' | 'fountain' | 'sidewalk' | 'roadMarking';
  position: [number, number, number];
  rotation: number;
  variant: number;
  size?: [number, number];
}

export interface CityRiver {
  x: number;
  width: number;
  length: number;
  centerZ: number;
}

export interface CityBridge {
  position: [number, number, number];
  width: number;
  rotation: number;
}

export interface DistrictZone {
  id: string;
  name: string;
  center: [number, number, number];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  population: number;
  color: string;
}

// ─── Utility Functions ──────────────────────────────────────

export function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9999.9999) * 10000;
  return x - Math.floor(x);
}

// ─── Spiral Coordinate ──────────────────────────────────────

function spiralCoord(index: number): [number, number] {
  if (index === 0) return [0, 0];
  let x = 0, y = 0, dx = 1, dy = 0;
  let segLen = 1, segPassed = 0, turns = 0;
  for (let i = 0; i < index; i++) {
    x += dx;
    y += dy;
    segPassed++;
    if (segPassed === segLen) {
      segPassed = 0;
      const tmp = dx;
      dx = -dy;
      dy = tmp;
      turns++;
      if (turns % 2 === 0) segLen++;
    }
  }
  return [x, y];
}

// ─── City Layout Constants ──────────────────────────────────

const BLOCK_SIZE = 4;
const LOT_W = 38;
const LOT_D = 32;
const ALLEY_W = 3;
const STREET_W = 12;
const BLOCK_FOOTPRINT_X = BLOCK_SIZE * LOT_W + (BLOCK_SIZE - 1) * ALLEY_W;
const BLOCK_FOOTPRINT_Z = BLOCK_SIZE * LOT_D + (BLOCK_SIZE - 1) * ALLEY_W;
const RIVER_WIDTH = 40;
const RIVER_MARGIN = 8;

const MAX_BUILDING_HEIGHT = 600;
const MIN_BUILDING_HEIGHT = 35;
const HEIGHT_RANGE = MAX_BUILDING_HEIGHT - MIN_BUILDING_HEIGHT;

// ─── Height Calculation (Instagram-adapted) ─────────────────
// posts_count is the primary metric (was: contributions)
// followers_count affects width (was: public_repos)
// following_count contributes to engagement score

function calcHeight(
  postsCount: number,
  followersCount: number,
  followingCount: number,
  maxPosts: number,
  maxFollowers: number,
): { height: number; composite: number } {
  // Effective maximums to prevent outliers from skewing
  const effMaxPosts = Math.min(maxPosts, 10_000);       // Cap at 10k posts
  const effMaxFollowers = Math.min(maxFollowers, 10_000_000); // Cap at 10M followers

  // Normalize to 0-1 (can exceed 1 for outliers)
  const pNorm = postsCount / Math.max(1, effMaxPosts);
  const fNorm = followersCount / Math.max(1, effMaxFollowers);
  
  // Engagement ratio: following/followers (lower ratio = more influential)
  const engagementRatio = followersCount > 0 
    ? Math.min(1, followersCount / Math.max(1, followingCount)) / 10 
    : 0;

  // Power curves for visual balance
  const pScore = Math.pow(Math.min(pNorm, 3), 0.55);    // posts (main metric)
  const fScore = Math.pow(Math.min(fNorm, 3), 0.45);    // followers (popularity)
  const eScore = Math.pow(Math.min(engagementRatio, 1), 0.5); // engagement

  // Weights: posts dominate, followers matter too
  const composite = pScore * 0.50 + fScore * 0.35 + eScore * 0.15;

  const height = Math.min(MAX_BUILDING_HEIGHT, MIN_BUILDING_HEIGHT + composite * HEIGHT_RANGE);
  return { height, composite };
}

// ─── Width Calculation (based on followers) ─────────────────

function calcWidth(instagrammer: InstagrammerRecord): number {
  const followersNorm = Math.min(1, instagrammer.followers_count / 1_000_000);
  const engagementNorm = instagrammer.followers_count > 0
    ? Math.min(1, (instagrammer.followers_count / Math.max(1, instagrammer.following_count)) / 10)
    : 0;

  const score = Math.pow(followersNorm, 0.5) * 0.70 + Math.pow(engagementNorm, 0.6) * 0.30;
  const jitter = (seededRandom(hashStr(instagrammer.instagram_handle)) - 0.5) * 4;
  
  return Math.round(14 + score * 24 + jitter);
}

// ─── Depth Calculation ──────────────────────────────────────

function calcDepth(instagrammer: InstagrammerRecord): number {
  const followingNorm = Math.min(1, instagrammer.following_count / 5_000);
  const postsNorm = Math.min(1, instagrammer.posts_count / 5_000);
  
  const score = Math.pow(postsNorm, 0.5) * 0.60 + Math.pow(followingNorm, 0.5) * 0.40;
  const jitter = (seededRandom(hashStr(instagrammer.instagram_handle) + 99) - 0.5) * 4;
  
  return Math.round(12 + score * 20 + jitter);
}

// ─── Lit Percentage (activity indicator) ────────────────────

function calcLitPercentage(instagrammer: InstagrammerRecord): number {
  // Based on app streak and recent activity
  const streakNorm = Math.min(1, (instagrammer.app_streak ?? 0) / 100);
  const postsNorm = Math.min(1, instagrammer.posts_count / 1000);
  
  const score = postsNorm * 0.50 + streakNorm * 0.50;
  return 0.10 + score * 0.85;
}

// ─── Composite Pre-computation ──────────────────────────────

function precomputeComposites(
  instagrammers: InstagrammerRecord[],
  maxPosts: number,
  maxFollowers: number,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const ig of instagrammers) {
    const { composite } = calcHeight(
      ig.posts_count,
      ig.followers_count,
      ig.following_count,
      maxPosts,
      maxFollowers
    );
    map.set(ig.instagram_handle, composite);
  }
  return map;
}

// ─── District Layout (Instagram niches) ─────────────────────

export const DISTRICT_NAMES: Record<string, string> = {
  downtown: 'Downtown',
  lifestyle: 'Lifestyle',
  fitness: 'Fitness',
  food: 'Food',
  travel: 'Travel',
  beauty: 'Beauty',
  tech: 'Tech',
  art: 'Art & Design',
  music: 'Music',
  gaming: 'Gaming',
  business: 'Business',
};

export const DISTRICT_COLORS: Record<string, string> = {
  downtown: '#fbbf24',
  lifestyle: '#ec4899',
  fitness: '#22c55e',
  food: '#f97316',
  travel: '#3b82f6',
  beauty: '#a855f7',
  tech: '#06b6d4',
  art: '#eab308',
  music: '#ef4444',
  gaming: '#8b5cf6',
  business: '#64748b',
};

export const DISTRICT_DESCRIPTIONS: Record<string, string> = {
  downtown: 'The elite core. Top 50 by followers.',
  lifestyle: 'Fashion, travel, daily life.',
  fitness: 'Gym, health, and wellness.',
  food: 'Recipes, restaurants, cooking.',
  travel: 'Adventures and destinations.',
  beauty: 'Makeup, skincare, and hair.',
  tech: 'Gadgets, apps, and innovation.',
  art: 'Illustrations and photography.',
  music: 'Artists, producers, and DJs.',
  gaming: 'Streamers and esports.',
  business: 'Entrepreneurs and startups.',
};

export function inferDistrict(district: string | null): string {
  if (!district) return 'lifestyle';
  if (DISTRICT_NAMES[district]) return district;
  return 'lifestyle';
}

// ─── Layout Helpers ─────────────────────────────────────────

function localBlockAxisPos(idx: number, footprint: number): number {
  if (idx === 0) return 0;
  const abs = Math.abs(idx);
  const sign = idx >= 0 ? 1 : -1;
  return sign * (abs * footprint + abs * STREET_W);
}

function seededShuffle<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(seededRandom(seed + i * 7919) * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ─── Generate City Layout ───────────────────────────────────

export function generateCityLayout(instagrammers: InstagrammerRecord[]): {
  buildings: CityBuilding[];
  plazas: CityPlaza[];
  decorations: CityDecoration[];
  river: CityRiver;
  bridges: CityBridge[];
  districtZones: DistrictZone[];
} {
  const buildings: CityBuilding[] = [];
  const plazas: CityPlaza[] = [];
  const decorations: CityDecoration[] = [];
  const districtZones: DistrictZone[] = [];
  
  const maxPosts = instagrammers.reduce((max, ig) => Math.max(max, ig.posts_count), 1);
  const maxFollowers = instagrammers.reduce((max, ig) => Math.max(max, ig.followers_count), 1);
  
  const composites = precomputeComposites(instagrammers, maxPosts, maxFollowers);

  const DISTRICT_ORDER = [
    'lifestyle', 'fitness', 'food', 'travel', 'beauty',
    'tech', 'art', 'music', 'gaming', 'business',
  ];

  // Group by district
  const districtGroups: Record<string, InstagrammerRecord[]> = {};
  for (const ig of instagrammers) {
    const did = ig.district ?? 'lifestyle';
    if (!districtGroups[did]) districtGroups[did] = [];
    districtGroups[did].push(ig);
  }

  // Extract top 50 as "downtown"
  const DOWNTOWN_COUNT = 50;
  const LOTS_PER_BLOCK = BLOCK_SIZE * BLOCK_SIZE;
  const allSorted = [...instagrammers].sort((a, b) =>
    (composites.get(b.instagram_handle) ?? 0) - (composites.get(a.instagram_handle) ?? 0)
  );
  const downtownInstagrammers = allSorted.slice(0, DOWNTOWN_COUNT);
  const downtownSet = new Set(downtownInstagrammers.map(ig => ig.instagram_handle));

  // Shuffle downtown blocks
  for (let i = 0; i < downtownInstagrammers.length; i += LOTS_PER_BLOCK) {
    const end = Math.min(i + LOTS_PER_BLOCK, downtownInstagrammers.length);
    const slice = downtownInstagrammers.slice(i, end);
    const shuffled = seededShuffle(slice, hashStr('downtown') + i);
    for (let j = 0; j < shuffled.length; j++) downtownInstagrammers[i + j] = shuffled[j];
  }

  const downtownOverride = new Set(downtownInstagrammers.map(ig => ig.instagram_handle));

  // Per-district arrays
  const districtArrays: { did: string; instagrammers: InstagrammerRecord[] }[] = [];
  for (const did of DISTRICT_ORDER) {
    const group = districtGroups[did];
    if (!group || group.length === 0) continue;
    const filtered = group.filter(ig => !downtownSet.has(ig.instagram_handle));
    if (filtered.length === 0) continue;
    districtArrays.push({ did, instagrammers: seededShuffle(filtered, hashStr(did)) });
  }

  // Grid setup
  const BLOCK_STEP_X = BLOCK_FOOTPRINT_X + STREET_W;
  const BLOCK_STEP_Z = BLOCK_FOOTPRINT_Z + STREET_W;
  const RIVER_Z_THRESHOLD = BLOCK_STEP_Z / 2;
  const RIVER_PUSH = RIVER_WIDTH + 2 * RIVER_MARGIN - STREET_W;
  const DISTRICT_GRID_RADIUS = 4;

  const occupiedCells = new Set<string>();
  let globalInstagrammerIndex = 0;
  let globalBlockSeed = 0;
  const allBlocks: { cx: number; cz: number; gx: number; gz: number }[] = [];

  function gridToWorld(gx: number, gz: number): [number, number] {
    return [localBlockAxisPos(gx, BLOCK_FOOTPRINT_X), localBlockAxisPos(gz, BLOCK_FOOTPRINT_Z)];
  }

  // Place block content
  function placeBlockContent(
    blockCX: number, blockCZ: number,
    blockInstagrammers: InstagrammerRecord[],
    seedIdx: number,
  ) {
    for (let i = 0; i < blockInstagrammers.length; i++) {
      const ig = blockInstagrammers[i];
      const localRow = Math.floor(i / BLOCK_SIZE);
      const localCol = i % BLOCK_SIZE;
      const posX = blockCX + (localCol - (BLOCK_SIZE - 1) / 2) * (LOT_W + ALLEY_W);
      const posZ = blockCZ + (localRow - (BLOCK_SIZE - 1) / 2) * (LOT_D + ALLEY_W);

      const { height, composite } = calcHeight(
        ig.posts_count,
        ig.followers_count,
        ig.following_count,
        maxPosts,
        maxFollowers
      );
      
      const w = calcWidth(ig);
      const d = calcDepth(ig);
      const litPercentage = calcLitPercentage(ig);

      const floorH = 6;
      const floors = Math.max(3, Math.floor(height / floorH));
      const windowsPerFloor = Math.max(3, Math.floor(w / 5));
      const sideWindowsPerFloor = Math.max(3, Math.floor(d / 5));
      
      const did = downtownOverride.has(ig.instagram_handle)
        ? 'downtown'
        : (ig.district ?? 'lifestyle');

      buildings.push({
        login: ig.instagram_handle,
        rank: ig.rank ?? globalInstagrammerIndex + i + 1,
        posts_count: ig.posts_count,
        followers_count: ig.followers_count,
        following_count: ig.following_count,
        name: ig.name,
        avatar_url: ig.avatar_url,
        niche: ig.district ?? null,
        claimed: ig.claimed ?? false,
        owned_items: ig.owned_items ?? [],
        custom_color: ig.custom_color ?? null,
        billboard_images: ig.billboard_images ?? [],
        achievements: ig.achievements ?? [],
        kudos_count: ig.kudos_count ?? 0,
        visit_count: ig.visit_count ?? 0,
        loadout: ig.loadout ?? null,
        app_streak: ig.app_streak ?? 0,
        raid_xp: ig.raid_xp ?? 0,
        current_week_posts: ig.current_week_posts ?? 0,
        current_week_kudos_given: ig.current_week_kudos_given ?? 0,
        current_week_kudos_received: ig.current_week_kudos_received ?? 0,
        active_raid_tag: ig.active_raid_tag ?? null,
        rabbit_completed: ig.rabbit_completed ?? false,
        xp_total: ig.xp_total ?? 0,
        xp_level: ig.xp_level ?? 1,
        district: did,
        district_chosen: ig.district_chosen ?? false,
        position: [posX, 0, posZ],
        width: w,
        depth: d,
        height,
        floors,
        windowsPerFloor,
        sideWindowsPerFloor,
        litPercentage,
      });
    }

    // Add sidewalk decoration
    decorations.push({
      type: 'sidewalk',
      position: [blockCX, 0.1, blockCZ],
      rotation: 0,
      variant: 0,
      size: [BLOCK_FOOTPRINT_X + 8, BLOCK_FOOTPRINT_Z + 8],
    });

    // Add street lamps
    const lampSeed = seedIdx * 1000 + 31;
    const lampCount = 2 + Math.floor(seededRandom(lampSeed * 311) * 3);
    for (let li = 0; li < lampCount; li++) {
      const seed = lampSeed * 5000 + li;
      const edge = Math.floor(seededRandom(seed) * 4);
      const alongX = (seededRandom(seed + 50) - 0.5) * BLOCK_FOOTPRINT_X;
      const alongZ = (seededRandom(seed + 50) - 0.5) * BLOCK_FOOTPRINT_Z;
      let lx = blockCX, lz = blockCZ;
      if (edge === 0) { lz -= BLOCK_FOOTPRINT_Z / 2 + 4; lx += alongX; }
      else if (edge === 1) { lx += BLOCK_FOOTPRINT_X / 2 + 4; lz += alongZ; }
      else if (edge === 2) { lz += BLOCK_FOOTPRINT_Z / 2 + 4; lx += alongX; }
      else { lx -= BLOCK_FOOTPRINT_X / 2 + 4; lz += alongZ; }
      decorations.push({ type: 'streetLamp', position: [lx, 0, lz], rotation: 0, variant: 0 });
    }

    // Add cars
    for (let bi = 0; bi < blockInstagrammers.length; bi++) {
      const bld = buildings[buildings.length - blockInstagrammers.length + bi];
      const carSeed = hashStr(blockInstagrammers[bi].instagram_handle) + 777;
      if (seededRandom(carSeed) > 0.6) {
        const side = seededRandom(carSeed + 1) > 0.5 ? 1 : -1;
        const carX = bld.position[0] + side * (bld.width / 2 + 6);
        decorations.push({
          type: 'car',
          position: [carX, 0, bld.position[2]],
          rotation: seededRandom(carSeed + 2) > 0.5 ? 0 : Math.PI,
          variant: Math.floor(seededRandom(carSeed + 3) * 4),
        });
      }
    }

    // Add trees
    const treeSeed = seedIdx * 2000 + 77;
    const treeCount = 1 + Math.floor(seededRandom(treeSeed * 421) * 2);
    for (let ti = 0; ti < treeCount; ti++) {
      const seed = treeSeed * 6000 + ti;
      const edge = Math.floor(seededRandom(seed) * 4);
      const alongX = (seededRandom(seed + 50) - 0.5) * BLOCK_FOOTPRINT_X * 0.8;
      const alongZ = (seededRandom(seed + 50) - 0.5) * BLOCK_FOOTPRINT_Z * 0.8;
      let tx = blockCX, tz = blockCZ;
      if (edge === 0) { tz -= BLOCK_FOOTPRINT_Z / 2 + 6; tx += alongX; }
      else if (edge === 1) { tx += BLOCK_FOOTPRINT_X / 2 + 6; tz += alongZ; }
      else if (edge === 2) { tz += BLOCK_FOOTPRINT_Z / 2 + 6; tx += alongX; }
      else { tx -= BLOCK_FOOTPRINT_X / 2 + 6; tz += alongZ; }
      decorations.push({
        type: 'tree',
        position: [tx, 0, tz],
        rotation: seededRandom(seed + 70) * Math.PI * 2,
        variant: Math.floor(seededRandom(seed + 80) * 3),
      });
    }
  }

  // Place downtown blocks (center of city)
  let dtIdx = 0;
  for (let blockIdx = 0; dtIdx < downtownInstagrammers.length; blockIdx++) {
    const [gx, gz] = spiralCoord(blockIdx);
    const key = `${gx},${gz}`;
    if (occupiedCells.has(key)) continue;
    occupiedCells.add(key);

    let [worldX, worldZ] = gridToWorld(gx, gz);
    if (worldZ > RIVER_Z_THRESHOLD) worldZ += RIVER_PUSH;
    else if (worldZ < -RIVER_Z_THRESHOLD) worldZ -= RIVER_PUSH;

    const blockInstagrammers = downtownInstagrammers.slice(dtIdx, dtIdx + LOTS_PER_BLOCK);
    dtIdx += blockInstagrammers.length;
    placeBlockContent(worldX, worldZ, blockInstagrammers, globalBlockSeed++);
    allBlocks.push({ cx: worldX, cz: worldZ, gx, gz });
  }

  // Record downtown zone
  if (downtownInstagrammers.length > 0) {
    const dtBuildings = buildings.slice(0, downtownInstagrammers.length);
    const minX = Math.min(...dtBuildings.map(b => b.position[0])) - BLOCK_FOOTPRINT_X / 2;
    const maxX = Math.max(...dtBuildings.map(b => b.position[0])) + BLOCK_FOOTPRINT_X / 2;
    const minZ = Math.min(...dtBuildings.map(b => b.position[2])) - BLOCK_FOOTPRINT_Z / 2;
    const maxZ = Math.max(...dtBuildings.map(b => b.position[2])) + BLOCK_FOOTPRINT_Z / 2;
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    districtZones.push({
      id: 'downtown',
      name: DISTRICT_NAMES.downtown,
      center: [centerX, 0, centerZ],
      bounds: { minX, maxX, minZ, maxZ },
      population: downtownInstagrammers.length,
      color: DISTRICT_COLORS.downtown,
    });
  }

  // Place district blocks in outer ring
  const districtOrigins: Record<string, [number, number]> = {};
  const angleStep = (2 * Math.PI) / DISTRICT_ORDER.length;
  for (let i = 0; i < DISTRICT_ORDER.length; i++) {
    const did = DISTRICT_ORDER[i];
    const angle = i * angleStep - Math.PI / 2;
    const gx = Math.round(Math.cos(angle) * DISTRICT_GRID_RADIUS);
    const gz = Math.round(Math.sin(angle) * DISTRICT_GRID_RADIUS);
    districtOrigins[did] = [gx, gz];
  }

  for (const { did, instagrammers: distInsts } of districtArrays) {
    const [originGx, originGz] = districtOrigins[did] ?? [0, 0];
    let idx = 0;
    const startBuildingIdx = buildings.length;

    for (let blockIdx = 0; idx < distInsts.length; blockIdx++) {
      const [dx, dz] = spiralCoord(blockIdx);
      const gx = originGx + dx;
      const gz = originGz + dz;
      const key = `${gx},${gz}`;
      if (occupiedCells.has(key)) continue;
      occupiedCells.add(key);

      let [worldX, worldZ] = gridToWorld(gx, gz);
      if (worldZ > RIVER_Z_THRESHOLD) worldZ += RIVER_PUSH;
      else if (worldZ < -RIVER_Z_THRESHOLD) worldZ -= RIVER_PUSH;

      const blockInsts = distInsts.slice(idx, idx + LOTS_PER_BLOCK);
      idx += blockInsts.length;
      placeBlockContent(worldX, worldZ, blockInsts, globalBlockSeed++);
      allBlocks.push({ cx: worldX, cz: worldZ, gx, gz });
    }

    // Record district zone
    const distBuildings = buildings.slice(startBuildingIdx);
    if (distBuildings.length > 0) {
      const minX = Math.min(...distBuildings.map(b => b.position[0])) - BLOCK_FOOTPRINT_X / 2;
      const maxX = Math.max(...distBuildings.map(b => b.position[0])) + BLOCK_FOOTPRINT_X / 2;
      const minZ = Math.min(...distBuildings.map(b => b.position[2])) - BLOCK_FOOTPRINT_Z / 2;
      const maxZ = Math.max(...distBuildings.map(b => b.position[2])) + BLOCK_FOOTPRINT_Z / 2;
      const centerX = (minX + maxX) / 2;
      const centerZ = (minZ + maxZ) / 2;
      districtZones.push({
        id: did,
        name: DISTRICT_NAMES[did] ?? did,
        center: [centerX, 0, centerZ],
        bounds: { minX, maxX, minZ, maxZ },
        population: distBuildings.length,
        color: DISTRICT_COLORS[did] ?? '#888888',
      });
    }
  }

  // Calculate river
  const allZ = allBlocks.map(b => b.cz);
  const riverCenterZ = 0;
  const riverLength = Math.max(
    Math.abs(Math.min(...allZ)) + BLOCK_FOOTPRINT_Z,
    Math.abs(Math.max(...allZ)) + BLOCK_FOOTPRINT_Z
  ) * 2 + 200;

  const river: CityRiver = {
    x: 0,
    width: RIVER_WIDTH,
    length: riverLength,
    centerZ: riverCenterZ,
  };

  // Add bridges
  const bridges: CityBridge[] = [];
  const bridgeSpacing = 300;
  const bridgeCount = Math.ceil(riverLength / bridgeSpacing);
  for (let i = 0; i < bridgeCount; i++) {
    const bz = riverCenterZ - riverLength / 2 + (i + 0.5) * (riverLength / bridgeCount);
    bridges.push({
      position: [0, 0, bz],
      width: 20,
      rotation: 0,
    });
  }

  // Add plaza at center
  plazas.push({
    position: [0, 0.2, 0],
    size: 60,
    variant: seededRandom(42),
  });

  return { buildings, plazas, decorations, river, bridges, districtZones };
}

// ─── Building Dimensions (reusable for shop preview) ────────

export function calcBuildingDims(
  instagramHandle: string,
  postsCount: number,
  followersCount: number,
  followingCount: number,
  maxPosts: number,
  maxFollowers: number,
  extendedData?: Partial<InstagrammerRecord>,
): { width: number; height: number; depth: number } {
  // Create a minimal record for calculation
  const ig: InstagrammerRecord = {
    id: 0,
    instagram_handle: instagramHandle,
    instagram_id: null,
    name: null,
    avatar_url: null,
    bio: null,
    website: null,
    posts_count: postsCount,
    followers_count: followersCount,
    following_count: followingCount,
    rank: null,
    fetched_at: '',
    created_at: '',
    claimed: false,
    fetch_priority: 0,
    claimed_at: null,
    ...extendedData,
  };

  const { height } = calcHeight(
    postsCount,
    followersCount,
    followingCount,
    maxPosts,
    maxFollowers
  );
  
  const w = calcWidth(ig);
  const d = calcDepth(ig);

  return { width: w, height, depth: d };
}
