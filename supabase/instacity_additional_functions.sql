-- ============================================================
-- InstaCity — Additional Functions
-- Run this after the main schema migration
-- ============================================================

-- Function to get top achievers (for leaderboard)
CREATE OR REPLACE FUNCTION top_achievers(lim integer DEFAULT 50)
RETURNS TABLE(instagrammer_id bigint, ach_count bigint)
LANGUAGE sql
STABLE
AS $$
  SELECT instagrammer_id, COUNT(*) AS ach_count
  FROM instagrammer_achievements
  GROUP BY instagrammer_id
  ORDER BY ach_count DESC
  LIMIT lim;
$$;

-- Ensure the function is available
GRANT EXECUTE ON FUNCTION top_achievers(integer) TO anon, authenticated;
