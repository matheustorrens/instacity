-- ============================================================
-- InstaCity — Full Schema (Adapted from Git City)
-- Execute this in Supabase SQL Editor to reset and setup
-- ============================================================

-- ─── DROP ALL EXISTING TABLES (RESET) ───────────────────────
-- Drop in reverse dependency order
DROP TABLE IF EXISTS xp_log CASCADE;
DROP TABLE IF EXISTS district_changes CASCADE;
DROP TABLE IF EXISTS raid_tags CASCADE;
DROP TABLE IF EXISTS raids CASCADE;
DROP TABLE IF EXISTS streak_freeze_log CASCADE;
DROP TABLE IF EXISTS streak_checkins CASCADE;
DROP TABLE IF EXISTS daily_progress CASCADE;
DROP TABLE IF EXISTS daily_missions CASCADE;
DROP TABLE IF EXISTS building_visits CASCADE;
DROP TABLE IF EXISTS developer_kudos CASCADE;
DROP TABLE IF EXISTS developer_achievements CASCADE;
DROP TABLE IF EXISTS activity_feed CASCADE;
DROP TABLE IF EXISTS developer_customizations CASCADE;
DROP TABLE IF EXISTS purchases CASCADE;
DROP TABLE IF EXISTS achievements CASCADE;
DROP TABLE IF EXISTS items CASCADE;
DROP TABLE IF EXISTS add_requests CASCADE;
DROP TABLE IF EXISTS districts CASCADE;
DROP TABLE IF EXISTS city_stats CASCADE;
DROP TABLE IF EXISTS instagrammers CASCADE;

-- Drop functions if exist
DROP FUNCTION IF EXISTS recalculate_ranks() CASCADE;
DROP FUNCTION IF EXISTS increment_kudos_count(bigint) CASCADE;
DROP FUNCTION IF EXISTS increment_visit_count(bigint) CASCADE;
DROP FUNCTION IF EXISTS increment_referral_count(bigint) CASCADE;
DROP FUNCTION IF EXISTS perform_checkin(bigint) CASCADE;
DROP FUNCTION IF EXISTS increment_kudos_week(bigint, bigint) CASCADE;
DROP FUNCTION IF EXISTS refresh_weekly_kudos() CASCADE;
DROP FUNCTION IF EXISTS grant_xp(bigint, text, integer) CASCADE;

-- ============================================================
-- 1. INSTAGRAMMERS TABLE (main table, adapted from developers)
-- ============================================================

CREATE TABLE instagrammers (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  
  -- Instagram Identity (instead of GitHub)
  instagram_handle      text NOT NULL UNIQUE,
  instagram_id          text,
  name                  text,
  avatar_url            text,
  bio                   text,
  website               text,
  
  -- Instagram Metrics (mapped from GitHub metrics)
  posts_count           int NOT NULL DEFAULT 0,        -- height (was: contributions)
  followers_count       int NOT NULL DEFAULT 0,        -- width (was: public_repos)  
  following_count       int NOT NULL DEFAULT 0,        -- windows (was: total_stars)
  
  -- OAuth tokens (Instagram Graph API)
  instagram_access_token text,
  instagram_token_expires_at timestamptz,
  
  -- Rankings & metadata
  rank                  int,
  fetched_at            timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  
  -- Claim system
  claimed               boolean NOT NULL DEFAULT false,
  claimed_by            uuid REFERENCES auth.users(id),
  claimed_at            timestamptz,
  fetch_priority        int NOT NULL DEFAULT 0,
  
  -- Social features
  kudos_count           int NOT NULL DEFAULT 0,
  visit_count           int NOT NULL DEFAULT 0,
  referred_by           text,
  referral_count        int NOT NULL DEFAULT 0,
  
  -- Streak system
  app_streak            int DEFAULT 0,
  app_longest_streak    int DEFAULT 0,
  last_checkin_date     date,
  streak_freezes_available int DEFAULT 0,
  streak_freeze_30d_claimed boolean DEFAULT false,
  kudos_streak          int DEFAULT 0,
  last_kudos_given_date date,
  
  -- Raid system
  raid_xp               int NOT NULL DEFAULT 0,
  current_week_posts    int NOT NULL DEFAULT 0,        -- (was: current_week_contributions)
  current_week_kudos_given int NOT NULL DEFAULT 0,
  current_week_kudos_received int NOT NULL DEFAULT 0,
  
  -- Districts
  district              text,
  district_chosen       boolean DEFAULT false,
  district_changes_count int DEFAULT 0,
  district_changed_at   timestamptz,
  district_rank         int,
  
  -- XP system
  xp_total              int NOT NULL DEFAULT 0,
  xp_level              int NOT NULL DEFAULT 1,
  xp_instagram          int NOT NULL DEFAULT 0,        -- (was: xp_github)
  xp_daily              int NOT NULL DEFAULT 0,
  xp_daily_date         date,
  
  -- Dailies
  dailies_completed     int DEFAULT 0,
  
  -- Special
  rabbit_completed      boolean DEFAULT false
);

-- Indexes
CREATE INDEX idx_instagrammers_rank ON instagrammers(rank);
CREATE INDEX idx_instagrammers_handle ON instagrammers(instagram_handle);
CREATE INDEX idx_instagrammers_posts ON instagrammers(posts_count DESC);
CREATE INDEX idx_instagrammers_fetched_at ON instagrammers(fetched_at);
CREATE INDEX idx_instagrammers_claimed ON instagrammers(claimed) WHERE claimed = true;
CREATE INDEX idx_instagrammers_xp_total ON instagrammers(xp_total DESC);
CREATE INDEX idx_instagrammers_district ON instagrammers(district);
CREATE INDEX idx_instagrammers_district_rank ON instagrammers(district, district_rank);

-- ============================================================
-- 2. CITY STATS (singleton)
-- ============================================================

CREATE TABLE city_stats (
  id                  int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  total_instagrammers int NOT NULL DEFAULT 0,
  total_posts         bigint NOT NULL DEFAULT 0,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

INSERT INTO city_stats (id) VALUES (1);

-- ============================================================
-- 3. ADD REQUESTS (rate limiting)
-- ============================================================

CREATE TABLE add_requests (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ip_hash     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_add_requests_ip_created ON add_requests(ip_hash, created_at);

-- ============================================================
-- 4. DISTRICTS (adapted for Instagram niches)
-- ============================================================

CREATE TABLE districts (
  id                  text PRIMARY KEY,
  name                text NOT NULL,
  description         text,
  color               text,
  population          int DEFAULT 0,
  total_posts         bigint DEFAULT 0,
  weekly_score        bigint DEFAULT 0,
  mayor_id            bigint REFERENCES instagrammers(id),
  created_at          timestamptz DEFAULT now()
);

-- Insert Instagram-themed districts
INSERT INTO districts (id, name, color, description) VALUES
  ('lifestyle',    'Lifestyle',      '#ec4899', 'Fashion, travel, daily life'),
  ('fitness',      'Fitness',        '#22c55e', 'Gym, health, wellness'),
  ('food',         'Food',           '#f97316', 'Recipes, restaurants, cooking'),
  ('travel',       'Travel',         '#3b82f6', 'Adventures, destinations'),
  ('beauty',       'Beauty',         '#a855f7', 'Makeup, skincare, hair'),
  ('tech',         'Tech',           '#06b6d4', 'Gadgets, apps, innovation'),
  ('art',          'Art & Design',   '#eab308', 'Illustrations, photography'),
  ('music',        'Music',          '#ef4444', 'Artists, producers, DJs'),
  ('gaming',       'Gaming',         '#8b5cf6', 'Streamers, games, esports'),
  ('business',     'Business',       '#64748b', 'Entrepreneurs, startups');

-- Add foreign key constraint after districts table exists
ALTER TABLE instagrammers ADD CONSTRAINT fk_instagrammers_district 
  FOREIGN KEY (district) REFERENCES districts(id);

-- ============================================================
-- 5. ITEMS CATALOG
-- ============================================================

CREATE TABLE items (
  id              text PRIMARY KEY,
  category        text NOT NULL,
  name            text NOT NULL,
  description     text,
  price_usd_cents int NOT NULL,
  price_brl_cents int NOT NULL,
  is_active       boolean DEFAULT true,
  zone            text,
  metadata        jsonb DEFAULT '{}',
  available_until timestamptz,
  max_quantity    int,
  is_exclusive    boolean DEFAULT false,
  created_at      timestamptz DEFAULT now()
);

-- Seed items (same as Git City)
INSERT INTO items (id, category, name, description, price_usd_cents, price_brl_cents, zone, metadata) VALUES
  ('neon_outline',    'effect',    'Neon Outline',    'Glowing outline on building edges',       200, 990,  'aura', '{}'),
  ('particle_aura',   'effect',    'Particle Aura',   'Floating particles around the building',  300, 1490, 'aura', '{}'),
  ('spotlight',       'effect',    'Spotlight',       'Spotlight beam pointing to the sky',      150, 790,  'aura', '{}'),
  ('rooftop_fire',    'effect',    'Rooftop Fire',    'Stylized flames on the rooftop',          200, 990,  'roof', '{}'),
  ('helipad',         'structure', 'Helipad',         'Helicopter landing pad on top',           100, 490,  'crown', '{}'),
  ('antenna_array',   'structure', 'Solar Panels',    'Solar panels on the rooftop',             100, 490,  'roof', '{}'),
  ('rooftop_garden',  'structure', 'Rooftop Garden',  'Green rooftop with trees',                150, 790,  'roof', '{}'),
  ('spire',           'structure', 'Water Tower',     'Water tower on top',                      200, 990,  'crown', '{}'),
  ('custom_color',    'identity',  'Custom Color',    'Choose your building color',              150, 790,  NULL, '{"default_color": "#c8e64a"}'),
  ('billboard',       'identity',  'Billboard',       'Logo or image on the building side',      300, 1490, NULL, '{}'),
  ('flag',            'identity',  'Flag',            'Custom flag on the rooftop',              100, 490,  'crown', '{}'),
  ('satellite_dish',  'structure', 'Satellite Dish',  'Dish antenna on rooftop',                 150, 790,  'crown', '{}'),
  ('crown_item',      'structure', 'Crown',           'Royal crown above building',              500, 2490, 'crown', '{}'),
  ('pool_party',      'structure', 'Pool Party',      'Rooftop pool with people',                300, 1490, 'roof', '{}'),
  ('neon_trim',       'effect',    'Neon Trim',       'Neon lights around building edge',        200, 990,  'aura', '{}'),
  ('hologram_ring',   'effect',    'Hologram Ring',   'Holographic ring around building',        400, 1990, 'aura', '{}'),
  ('lightning_aura',  'effect',    'Lightning Aura',  'Electric lightning effect',               350, 1790, 'aura', '{}'),
  ('led_banner',      'identity',  'LED Banner',      'Scrolling LED text',                      250, 1290, NULL, '{}'),
  ('streak_freeze',   'consumable','Streak Freeze',   'Protect your streak for 1 day',           100, 490,  NULL, '{}'),
  ('instagram_star',  'structure', 'Instagram Star',  'Verified star badge',                     300, 1490, 'crown', '{}'),
  -- Raid items
  ('raid_helicopter', 'effect',    'Helicopter',      'Raid vehicle: helicopter',                299, 1490, NULL, '{"type":"raid_vehicle"}'),
  ('raid_drone',      'effect',    'Stealth Drone',   'Raid vehicle: drone',                     199, 990,  NULL, '{"type":"raid_vehicle"}'),
  ('raid_rocket',     'effect',    'Rocket',          'Raid vehicle: rocket',                    399, 1990, NULL, '{"type":"raid_vehicle"}'),
  ('tag_neon',        'effect',    'Neon Tag',        'Neon-colored raid graffiti',              149, 790,  NULL, '{"type":"raid_tag"}'),
  ('tag_fire',        'effect',    'Fire Tag',        'Fire-animated raid graffiti',             199, 990,  NULL, '{"type":"raid_tag"}'),
  ('tag_gold',        'effect',    'Gold Tag',        'Golden raid graffiti',                    249, 1290, NULL, '{"type":"raid_tag"}'),
  ('raid_boost_small','consumable','War Paint',       '+5 attack for 1 raid',                    99,  490,  NULL, '{"type":"raid_boost","bonus":5}'),
  ('raid_boost_medium','consumable','Battle Armor',   '+10 attack for 1 raid',                   179, 890,  NULL, '{"type":"raid_boost","bonus":10}'),
  ('raid_boost_large','consumable','EMP Device',      '+20 attack for 1 raid',                   299, 1490, NULL, '{"type":"raid_boost","bonus":20}'),
  ('white_rabbit',    'effect',    'White Rabbit',    'Easter egg trophy',                       0,   0,    NULL, '{}');

-- ============================================================
-- 6. ACHIEVEMENTS CATALOG
-- ============================================================

CREATE TABLE achievements (
  id              text PRIMARY KEY,
  category        text NOT NULL,
  name            text NOT NULL,
  description     text NOT NULL,
  threshold       int NOT NULL,
  tier            text NOT NULL,
  reward_type     text NOT NULL,
  reward_item_id  text REFERENCES items(id),
  sort_order      int NOT NULL
);

-- Seed achievements (adapted for Instagram metrics)
INSERT INTO achievements (id, category, name, description, threshold, tier, reward_type, reward_item_id, sort_order) VALUES
  -- Posts (was commits)
  ('first_post',    'posts', 'First Post',     'Make your first post',            1,     'bronze',  'unlock_item',     'flag',         1),
  ('content_creator','posts', 'Content Creator','Reach 50 posts',                 50,    'bronze',  'unlock_item',     'custom_color', 2),
  ('grinder',       'posts', 'Grinder',        'Reach 100 posts',                 100,   'silver',  'unlock_item',     'neon_trim',    3),
  ('machine',       'posts', 'Machine',        'Reach 500 posts',                 500,   'gold',    'exclusive_badge', NULL,           4),
  ('god_mode',      'posts', 'God Mode',       'Reach 1000 posts',                1000,  'diamond', 'exclusive_badge', NULL,           5),
  
  -- Followers (was repos)
  ('rising',        'followers', 'Rising Star',   'Reach 1,000 followers',        1000,   'bronze',  'unlock_item',     'antenna_array', 10),
  ('influencer',    'followers', 'Influencer',    'Reach 10,000 followers',       10000,  'silver',  'unlock_item',     'rooftop_garden',11),
  ('famous',        'followers', 'Famous',        'Reach 100,000 followers',      100000, 'gold',    'exclusive_badge', NULL,           12),
  ('celebrity',     'followers', 'Celebrity',     'Reach 1,000,000 followers',    1000000,'diamond', 'exclusive_badge', NULL,           13),
  
  -- Following (engagement, was stars)
  ('social',        'following', 'Social',        'Follow 100 accounts',          100,    'bronze',  'unlock_item',     'spotlight',    20),
  ('networker',     'following', 'Networker',     'Follow 500 accounts',          500,    'silver',  'exclusive_badge', NULL,           21),
  
  -- Social (referrals)
  ('recruiter',     'social', 'Recruiter',       'Refer 5 friends',              5,      'bronze',  'unlock_item',     'helipad',      30),
  ('influencer_ref','social', 'Ambassador',      'Refer 25 friends',             25,     'silver',  'exclusive_badge', NULL,           31),
  ('mayor',         'social', 'Mayor',           'Refer 100 friends',            100,    'diamond', 'exclusive_badge', NULL,           32),
  
  -- Kudos
  ('appreciated',   'kudos', 'Appreciated',      'Receive 10 kudos',             10,     'bronze',  'exclusive_badge', NULL,           40),
  ('beloved',       'kudos', 'Beloved',          'Receive 50 kudos',             50,     'silver',  'exclusive_badge', NULL,           41),
  ('admired',       'kudos', 'Admired',          'Receive 250 kudos',            250,    'gold',    'exclusive_badge', NULL,           42),
  ('icon',          'kudos', 'Icon',             'Receive 1000 kudos',           1000,   'diamond', 'exclusive_badge', NULL,           43),
  
  -- Gifts sent
  ('generous',      'gifts_sent', 'Generous',     'Send 1 gift',                 1,      'bronze',  'exclusive_badge', NULL,           50),
  ('patron',        'gifts_sent', 'Patron',       'Send 10 gifts',               10,     'silver',  'exclusive_badge', NULL,           51),
  ('philanthropist','gifts_sent', 'Philanthropist','Send 50 gifts',              50,     'gold',    'exclusive_badge', NULL,           52),
  
  -- Gifts received
  ('gifted',        'gifts_received', 'Gifted',   'Receive 1 gift',              1,      'bronze',  'exclusive_badge', NULL,           60),
  
  -- Streak
  ('on_fire',       'streak', 'On Fire',         '7 day streak',                 7,      'bronze',  'exclusive_badge', NULL,           70),
  ('dedicated',     'streak', 'Dedicated',       '30 day streak',                30,     'silver',  'exclusive_badge', NULL,           71),
  ('obsessed',      'streak', 'Obsessed',        '100 day streak',               100,    'gold',    'exclusive_badge', NULL,           72),
  ('no_life',       'streak', 'No Life',         '365 day streak',               365,    'diamond', 'exclusive_badge', NULL,           73),
  
  -- Kudos streak
  ('generous_streak','kudos_streak', 'Generous Streak', 'Give kudos 7 days in a row', 7, 'bronze',  'exclusive_badge', NULL,           80),
  
  -- Raid
  ('pickpocket',    'raid', 'Pickpocket',        'Earn 100 Raid XP',             100,    'bronze',  'exclusive_badge', NULL,           90),
  ('burglar',       'raid', 'Burglar',           'Earn 500 Raid XP',             500,    'silver',  'exclusive_badge', NULL,           91),
  ('heist_master',  'raid', 'Heist Master',      'Earn 2000 Raid XP',            2000,   'gold',    'exclusive_badge', NULL,           92),
  ('kingpin',       'raid', 'Kingpin',           'Earn 10000 Raid XP',           10000,  'diamond', 'exclusive_badge', NULL,           93),
  
  -- Dailies
  ('daily_rookie',  'dailies', 'Daily Rookie',   'Complete 10 daily missions',   10,     'bronze',  'exclusive_badge', NULL,           100),
  ('daily_regular', 'dailies', 'Daily Regular',  'Complete 50 daily missions',   50,     'silver',  'exclusive_badge', NULL,           101),
  ('daily_master',  'dailies', 'Daily Master',   'Complete 200 daily missions',  200,    'gold',    'exclusive_badge', NULL,           102),
  ('daily_legend',  'dailies', 'Daily Legend',   'Complete 500 daily missions',  500,    'diamond', 'exclusive_badge', NULL,           103),
  
  -- Special
  ('white_rabbit',  'special', 'White Rabbit',   'Found the White Rabbit',       1,      'diamond', 'unlock_item',     'white_rabbit', 200);

-- ============================================================
-- 7. PURCHASES TABLE
-- ============================================================

CREATE TABLE purchases (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instagrammer_id bigint NOT NULL REFERENCES instagrammers(id),
  item_id         text NOT NULL REFERENCES items(id),
  provider        text NOT NULL,
  provider_tx_id  text,
  amount_cents    int NOT NULL,
  currency        text NOT NULL,
  status          text NOT NULL DEFAULT 'pending',
  gifted_to       bigint REFERENCES instagrammers(id),
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_purchases_instagrammer ON purchases(instagrammer_id, status);
CREATE INDEX idx_purchases_provider ON purchases(provider_tx_id);
CREATE UNIQUE INDEX idx_purchases_unique_completed 
  ON purchases(instagrammer_id, item_id, COALESCE(gifted_to, 0)) WHERE status = 'completed';

-- ============================================================
-- 8. DEVELOPER CUSTOMIZATIONS
-- ============================================================

CREATE TABLE instagrammer_customizations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instagrammer_id bigint NOT NULL REFERENCES instagrammers(id),
  item_id         text NOT NULL REFERENCES items(id),
  config          jsonb NOT NULL DEFAULT '{}',
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (instagrammer_id, item_id)
);

-- ============================================================
-- 9. DEVELOPER ACHIEVEMENTS
-- ============================================================

CREATE TABLE instagrammer_achievements (
  instagrammer_id bigint NOT NULL REFERENCES instagrammers(id),
  achievement_id  text NOT NULL REFERENCES achievements(id),
  unlocked_at     timestamptz NOT NULL DEFAULT now(),
  seen            boolean NOT NULL DEFAULT false,
  PRIMARY KEY (instagrammer_id, achievement_id)
);

CREATE INDEX idx_instagrammer_achievements ON instagrammer_achievements(instagrammer_id);

-- ============================================================
-- 10. KUDOS TABLE
-- ============================================================

CREATE TABLE instagrammer_kudos (
  giver_id      bigint NOT NULL REFERENCES instagrammers(id),
  receiver_id   bigint NOT NULL REFERENCES instagrammers(id),
  given_date    date NOT NULL DEFAULT current_date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (giver_id, receiver_id, given_date)
);

CREATE INDEX idx_kudos_giver_date ON instagrammer_kudos(giver_id, given_date);
CREATE INDEX idx_kudos_receiver ON instagrammer_kudos(receiver_id);

-- ============================================================
-- 11. BUILDING VISITS
-- ============================================================

CREATE TABLE building_visits (
  visitor_id    bigint NOT NULL REFERENCES instagrammers(id),
  building_id   bigint NOT NULL REFERENCES instagrammers(id),
  visit_date    date NOT NULL DEFAULT current_date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (visitor_id, building_id, visit_date)
);

CREATE INDEX idx_visits_building ON building_visits(building_id);
CREATE INDEX idx_visits_visitor_date ON building_visits(visitor_id, visit_date);

-- ============================================================
-- 12. ACTIVITY FEED
-- ============================================================

CREATE TABLE activity_feed (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  text NOT NULL,
  actor_id    bigint REFERENCES instagrammers(id),
  target_id   bigint REFERENCES instagrammers(id),
  metadata    jsonb DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_feed_created ON activity_feed(created_at DESC);
CREATE INDEX idx_feed_actor ON activity_feed(actor_id, created_at DESC);

-- ============================================================
-- 13. STREAK TABLES
-- ============================================================

CREATE TABLE streak_checkins (
  instagrammer_id bigint NOT NULL REFERENCES instagrammers(id),
  checkin_date    date NOT NULL DEFAULT current_date,
  type            text NOT NULL DEFAULT 'active' CHECK (type IN ('active', 'frozen')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instagrammer_id, checkin_date)
);

CREATE INDEX idx_streak_checkins ON streak_checkins(instagrammer_id, checkin_date DESC);

CREATE TABLE streak_freeze_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instagrammer_id bigint NOT NULL REFERENCES instagrammers(id),
  action          text NOT NULL CHECK (action IN ('purchased', 'granted_milestone', 'consumed')),
  frozen_date     date,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_streak_freeze_log ON streak_freeze_log(instagrammer_id, created_at DESC);

-- ============================================================
-- 14. RAID TABLES
-- ============================================================

CREATE TABLE raids (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attacker_id       bigint NOT NULL REFERENCES instagrammers(id),
  defender_id       bigint NOT NULL REFERENCES instagrammers(id),
  attack_score      int NOT NULL,
  defense_score     int NOT NULL,
  success           boolean NOT NULL,
  attack_breakdown  jsonb NOT NULL DEFAULT '{}',
  defense_breakdown jsonb NOT NULL DEFAULT '{}',
  attacker_vehicle  text NOT NULL DEFAULT 'airplane',
  attacker_tag_style text NOT NULL DEFAULT 'default',
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT raids_no_self CHECK (attacker_id != defender_id)
);

CREATE INDEX idx_raids_attacker ON raids(attacker_id, created_at DESC);
CREATE INDEX idx_raids_defender ON raids(defender_id, created_at DESC);
CREATE INDEX idx_raids_success ON raids(success, created_at DESC) WHERE success = true;

CREATE TABLE raid_tags (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raid_id         uuid NOT NULL REFERENCES raids(id) ON DELETE CASCADE,
  building_id     bigint NOT NULL REFERENCES instagrammers(id),
  attacker_id     bigint NOT NULL REFERENCES instagrammers(id),
  attacker_login  text NOT NULL,
  tag_style       text NOT NULL DEFAULT 'default',
  active          boolean NOT NULL DEFAULT true,
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_raid_tags_active ON raid_tags(building_id) WHERE active = true;
CREATE INDEX idx_raid_tags_expires ON raid_tags(expires_at);

-- ============================================================
-- 15. DAILY MISSIONS
-- ============================================================

CREATE TABLE daily_missions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instagrammer_id bigint NOT NULL REFERENCES instagrammers(id),
  mission_date    date NOT NULL DEFAULT current_date,
  mission_id      text NOT NULL,
  completed       boolean DEFAULT false,
  completed_at    timestamptz,
  progress        int DEFAULT 0,
  created_at      timestamptz DEFAULT now(),
  UNIQUE(instagrammer_id, mission_date, mission_id)
);

CREATE INDEX idx_daily_missions ON daily_missions(instagrammer_id, mission_date);

-- ============================================================
-- 16. XP LOG
-- ============================================================

CREATE TABLE xp_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instagrammer_id bigint NOT NULL REFERENCES instagrammers(id),
  source          text NOT NULL,
  amount          int NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_xp_log_instagrammer ON xp_log(instagrammer_id);
CREATE INDEX idx_xp_log_created ON xp_log(created_at);

-- ============================================================
-- 17. ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE instagrammers ENABLE ROW LEVEL SECURITY;
ALTER TABLE city_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE add_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE districts ENABLE ROW LEVEL SECURITY;
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE instagrammer_customizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE instagrammer_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE instagrammer_kudos ENABLE ROW LEVEL SECURITY;
ALTER TABLE building_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_feed ENABLE ROW LEVEL SECURITY;
ALTER TABLE streak_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE streak_freeze_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE raids ENABLE ROW LEVEL SECURITY;
ALTER TABLE raid_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE xp_log ENABLE ROW LEVEL SECURITY;

-- Public read policies
CREATE POLICY "Public read instagrammers" ON instagrammers FOR SELECT USING (true);
CREATE POLICY "Public read city_stats" ON city_stats FOR SELECT USING (true);
CREATE POLICY "Public read districts" ON districts FOR SELECT USING (true);
CREATE POLICY "Public read items" ON items FOR SELECT USING (true);
CREATE POLICY "Public read achievements" ON achievements FOR SELECT USING (true);
CREATE POLICY "Public read purchases" ON purchases FOR SELECT USING (true);
CREATE POLICY "Public read customizations" ON instagrammer_customizations FOR SELECT USING (true);
CREATE POLICY "Public read instagrammer_achievements" ON instagrammer_achievements FOR SELECT USING (true);
CREATE POLICY "Public read kudos" ON instagrammer_kudos FOR SELECT USING (true);
CREATE POLICY "Public read visits" ON building_visits FOR SELECT USING (true);
CREATE POLICY "Public read feed" ON activity_feed FOR SELECT USING (true);
CREATE POLICY "Public read checkins" ON streak_checkins FOR SELECT USING (true);
CREATE POLICY "Public read freeze_log" ON streak_freeze_log FOR SELECT USING (true);
CREATE POLICY "Public read raids" ON raids FOR SELECT USING (true);
CREATE POLICY "Public read raid_tags" ON raid_tags FOR SELECT USING (true);
CREATE POLICY "Public read daily_missions" ON daily_missions FOR SELECT USING (true);
CREATE POLICY "Public read xp_log" ON xp_log FOR SELECT USING (true);

-- ============================================================
-- 18. FUNCTIONS
-- ============================================================

-- Recalculate ranks (by posts_count instead of contributions)
CREATE OR REPLACE FUNCTION recalculate_ranks()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  WITH ranked AS (
    SELECT id, row_number() OVER (
      ORDER BY posts_count DESC, instagram_handle ASC
    ) AS new_rank
    FROM instagrammers
  )
  UPDATE instagrammers i
  SET rank = r.new_rank
  FROM ranked r
  WHERE i.id = r.id;

  UPDATE city_stats
  SET total_instagrammers = (SELECT count(*) FROM instagrammers),
      total_posts = (SELECT COALESCE(sum(posts_count), 0) FROM instagrammers),
      updated_at = now()
  WHERE id = 1;
END;
$$;

-- Increment kudos count
CREATE OR REPLACE FUNCTION increment_kudos_count(target_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE instagrammers SET kudos_count = kudos_count + 1 WHERE id = target_id;
END;
$$;

-- Increment visit count
CREATE OR REPLACE FUNCTION increment_visit_count(target_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE instagrammers SET visit_count = visit_count + 1 WHERE id = target_id;
END;
$$;

-- Increment referral count
CREATE OR REPLACE FUNCTION increment_referral_count(referrer_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE instagrammers SET referral_count = referral_count + 1 WHERE id = referrer_id;
END;
$$;

-- Increment weekly kudos
CREATE OR REPLACE FUNCTION increment_kudos_week(p_giver_id bigint, p_receiver_id bigint)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE instagrammers SET current_week_kudos_given = current_week_kudos_given + 1
  WHERE id = p_giver_id;
  UPDATE instagrammers SET current_week_kudos_received = current_week_kudos_received + 1
  WHERE id = p_receiver_id;
END;
$$;

-- Grant XP
CREATE OR REPLACE FUNCTION grant_xp(
  p_instagrammer_id bigint,
  p_source text,
  p_amount integer
) RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_today date := CURRENT_DATE;
  v_daily integer;
  v_actual integer;
  v_new_total integer;
  v_new_level integer;
BEGIN
  UPDATE instagrammers
  SET xp_daily = 0, xp_daily_date = v_today
  WHERE id = p_instagrammer_id AND (xp_daily_date IS NULL OR xp_daily_date < v_today);

  SELECT xp_daily INTO v_daily FROM instagrammers WHERE id = p_instagrammer_id;

  IF p_source IN ('checkin', 'dailies', 'kudos_given', 'visit', 'fly') THEN
    v_actual := LEAST(p_amount, GREATEST(0, 150 - COALESCE(v_daily, 0)));
  ELSE
    v_actual := p_amount;
  END IF;

  IF v_actual <= 0 THEN
    RETURN json_build_object('granted', 0, 'reason', 'daily_cap');
  END IF;

  UPDATE instagrammers
  SET xp_total = xp_total + v_actual,
      xp_daily = COALESCE(xp_daily, 0) +
        CASE WHEN p_source IN ('checkin','dailies','kudos_given','visit','fly')
        THEN v_actual ELSE 0 END,
      xp_daily_date = v_today
  WHERE id = p_instagrammer_id
  RETURNING xp_total INTO v_new_total;

  v_new_level := 1;
  WHILE v_new_total >= (25 * POWER(v_new_level + 1, 2.2))::integer LOOP
    v_new_level := v_new_level + 1;
  END LOOP;

  UPDATE instagrammers SET xp_level = GREATEST(xp_level, v_new_level)
  WHERE id = p_instagrammer_id;

  INSERT INTO xp_log (instagrammer_id, source, amount)
  VALUES (p_instagrammer_id, p_source, v_actual);

  RETURN json_build_object('granted', v_actual, 'new_total', v_new_total, 'new_level', v_new_level);
END;
$$;

-- Perform checkin
CREATE OR REPLACE FUNCTION perform_checkin(p_instagrammer_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_last_date    date;
  v_streak       int;
  v_longest      int;
  v_freezes      int;
  v_today        date := current_date;
  v_was_frozen   boolean := false;
BEGIN
  SELECT last_checkin_date, app_streak, app_longest_streak, streak_freezes_available
    INTO v_last_date, v_streak, v_longest, v_freezes
    FROM instagrammers
   WHERE id = p_instagrammer_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('checked_in', false, 'error', 'not_found');
  END IF;

  IF v_last_date = v_today THEN
    RETURN jsonb_build_object(
      'checked_in', false,
      'already_today', true,
      'streak', v_streak,
      'longest', v_longest
    );
  END IF;

  IF v_last_date = v_today - 1 THEN
    v_streak := v_streak + 1;
  ELSIF v_last_date = v_today - 2 AND v_freezes > 0 THEN
    v_freezes := v_freezes - 1;
    v_streak := v_streak + 1;
    v_was_frozen := true;
    
    INSERT INTO streak_checkins (instagrammer_id, checkin_date, type)
    VALUES (p_instagrammer_id, v_today - 1, 'frozen');
    
    INSERT INTO streak_freeze_log (instagrammer_id, action, frozen_date)
    VALUES (p_instagrammer_id, 'consumed', v_today - 1);
  ELSE
    v_streak := 1;
  END IF;

  IF v_streak > v_longest THEN
    v_longest := v_streak;
  END IF;

  UPDATE instagrammers
  SET app_streak = v_streak,
      app_longest_streak = v_longest,
      last_checkin_date = v_today,
      streak_freezes_available = v_freezes
  WHERE id = p_instagrammer_id;

  INSERT INTO streak_checkins (instagrammer_id, checkin_date, type)
  VALUES (p_instagrammer_id, v_today, 'active');

  RETURN jsonb_build_object(
    'checked_in', true,
    'streak', v_streak,
    'longest', v_longest,
    'was_frozen', v_was_frozen
  );
END;
$$;

-- ============================================================
-- DONE! InstaCity schema is ready.
-- ============================================================
