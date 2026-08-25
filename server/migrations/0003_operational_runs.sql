CREATE TABLE hub.operational_runs (
	id uuid PRIMARY KEY,
	job_type text NOT NULL CHECK (job_type IN ('maintenance', 'backup', 'restore_drill')),
	status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
	app_version text,
	details jsonb NOT NULL DEFAULT '{}'::jsonb,
	started_at timestamptz NOT NULL DEFAULT now(),
	completed_at timestamptz
);

CREATE INDEX operational_runs_job_started_idx
	ON hub.operational_runs (job_type, started_at DESC);
