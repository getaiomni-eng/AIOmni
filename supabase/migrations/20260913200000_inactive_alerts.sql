-- "Your starter is OUT" push alerts (2026-09-13).
--
-- NFL inactives drop ~90 minutes before kickoff. notification-lineup-check
-- already warns about bye weeks on Sunday morning, but nothing watched
-- injury designations, so a starter ruled out at 11:30am went unannounced
-- until the user noticed a zero.
--
-- The function reads Sleeper's player DB (the same feed weekly-board uses,
-- chosen because ESPN's injury endpoint 403s from datacenter IPs) and pushes
-- only to users who have BOTH a push_token and lineup_warning enabled.
--
-- Timing. All UTC; Central is UTC-5 during the season.
--   */20 15-23 * * 0    Sunday 10:00-18:59 CT  — the 12:00 and 15:00 CT
--                       windows, whose inactives land ~90 min before each
--   */20 0-4  * * 1,2,5 Sunday / Monday / Thursday night games, which kick
--                       at 19:15-19:20 CT and therefore fall on the NEXT
--                       UTC day (Mon/Tue/Fri 00:00-04:59)
--
-- Deliberately NOT running all week: each invocation pulls Sleeper's full
-- player DB (~5 MB), and there are no inactives to report on a Wednesday.

SELECT cron.schedule('aiomni-inactives-sunday', '*/20 15-23 * * 0',
  $job$ SELECT public.kick_edge_function('notification-inactives'); $job$);

SELECT cron.schedule('aiomni-inactives-primetime', '*/20 0-4 * * 1,2,5',
  $job$ SELECT public.kick_edge_function('notification-inactives'); $job$);

-- notification_log.kind gains 'inactive'. The column is free-form text with
-- no CHECK constraint, so nothing to alter -- recorded here so the set of
-- kinds stays discoverable from the migrations rather than only from the
-- functions that write them:
--   'player_news' | 'lineup_warning' | 'heat' | 'inactive'
--
-- The function claims its dedupe row in notification_log BEFORE sending and
-- only pushes what the insert accepted, so two overlapping runs cannot
-- double-notify. That ordering matters more than usual here: a duplicate
-- "your starter is OUT" at 11:45 on a Sunday is the push that gets an app
-- muted for good.
