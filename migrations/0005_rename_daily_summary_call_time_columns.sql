ALTER TABLE agent_daily_summaries RENAME COLUMN first_start_at TO first_call_time;
ALTER TABLE agent_daily_summaries RENAME COLUMN last_end_at TO last_call_time;
