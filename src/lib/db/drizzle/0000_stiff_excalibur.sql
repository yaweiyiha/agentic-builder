CREATE TABLE "project_pipeline_state" (
	"project_id" text PRIMARY KEY NOT NULL,
	"feature_brief" text DEFAULT '' NOT NULL,
	"current_step" text,
	"active_tab" text DEFAULT 'intent' NOT NULL,
	"total_cost_usd" double precision DEFAULT 0 NOT NULL,
	"is_running" boolean DEFAULT false NOT NULL,
	"fast_from_prd" boolean DEFAULT true NOT NULL,
	"code_output_dir" text DEFAULT 'generated-code' NOT NULL,
	"steps_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_stage_state" (
	"project_id" text PRIMARY KEY NOT NULL,
	"active_stage" text DEFAULT 'preparation' NOT NULL,
	"active_sub_stages" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"project_name" text DEFAULT 'New Project' NOT NULL,
	"intent_messages_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"intent_enriched_brief" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_step_artifacts" (
	"project_id" text NOT NULL,
	"step_id" text NOT NULL,
	"run_index" text DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"duration_ms" double precision DEFAULT 0 NOT NULL,
	"model" text,
	"trace_id" text,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_step_artifacts_project_id_step_id_run_index_pk" PRIMARY KEY("project_id","step_id","run_index")
);
--> statement-breakpoint
CREATE TABLE "project_step_navigation" (
	"project_id" text PRIMARY KEY NOT NULL,
	"active_step" text DEFAULT 'initial' NOT NULL,
	"tier" text DEFAULT 'M' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_substage_snapshot" (
	"project_id" text NOT NULL,
	"stage_id" text NOT NULL,
	"sub_stage_id" text NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_substage_snapshot_project_id_stage_id_sub_stage_id_pk" PRIMARY KEY("project_id","stage_id","sub_stage_id")
);
--> statement-breakpoint
CREATE TABLE "project_substage_status" (
	"project_id" text NOT NULL,
	"stage_id" text NOT NULL,
	"sub_stage_id" text NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"context_refs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"step_ids" text[] DEFAULT '{}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_substage_status_project_id_stage_id_sub_stage_id_pk" PRIMARY KEY("project_id","stage_id","sub_stage_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "project_pipeline_state" ADD CONSTRAINT "project_pipeline_state_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_stage_state" ADD CONSTRAINT "project_stage_state_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_step_artifacts" ADD CONSTRAINT "project_step_artifacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_step_navigation" ADD CONSTRAINT "project_step_navigation_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_substage_snapshot" ADD CONSTRAINT "project_substage_snapshot_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_substage_status" ADD CONSTRAINT "project_substage_status_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;