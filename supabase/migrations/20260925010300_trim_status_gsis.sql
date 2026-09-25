-- Trim padded gsis ids in the Sleeper status tables (2026-09-25).
--
-- Sleeper's player feed carries some gsis ids with a leading space
-- (" 00-0035229" for T.J. Hockenson). player-status-sync stored them as-is:
-- 53 of 825 rows in nfl_player_status, including David Montgomery, DK
-- Metcalf and Terry McLaurin. Every exact-id join missed those players. The
-- sync now trims at write time; this cleans what is already stored.
UPDATE public.nfl_player_status
   SET gsis_id = btrim(gsis_id)
 WHERE gsis_id <> btrim(gsis_id);

UPDATE public.nfl_player_status_weekly
   SET gsis_id = btrim(gsis_id)
 WHERE gsis_id <> btrim(gsis_id);
