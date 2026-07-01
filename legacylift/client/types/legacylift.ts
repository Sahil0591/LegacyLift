// types/legacylift.ts — Canonical TypeScript interfaces for all LegacyLift domain objects.
// These mirror the Pydantic models in legacylift/models/ exactly.
// When the backend models change, update this file first so TypeScript catches mismatches.

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export type RuleConfidence = "High" | "Medium" | "Low";

export type RuleStatus = "Pending" | "Confirmed" | "Edited" | "Flagged";

export type OwnershipReviewState = "Inferred" | "Confirmed" | "Reassigned" | "Flagged";

export type ApprovalState = "Approval needed" | "Approval requested" | "Approved" | "Waived";

export type OwnershipCategory =
  | "Finance"
  | "Compliance"
  | "Product"
  | "Risk"
  | "Ops"
  | "Engineering"
  | "Unknown"
  | (string & {});

export type OwnershipConfidence = "High" | "Medium" | "Low";

export type RiskLevel = "Low" | "Medium" | "High" | "Critical";

export type ChunkStatus = "Pending" | "Running" | "Review" | "Approved" | "Rejected";

export type PipelineLayer = 0 | 0.5 | 1 | 2 | 3 | 4;

export type ProjectLanguage = "COBOL" | "Java" | "VB6";

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

export interface OwnershipResult {
  primary_owner: OwnershipCategory;
  secondary_owners: OwnershipCategory[];
  confidence: OwnershipConfidence;
  evidence: string;
  matched_signals: string[];
  review_status: string;
  actual_person: string | null;
}

export interface ChangeGuidanceResult {
  risk_summary: string;
  primary_approval_group: OwnershipCategory;
  secondary_groups: OwnershipCategory[];
  approval_checklist: string[];
  suggested_tests: string[];
  suggested_message: string;
  merge_risk: "Low" | "Medium" | "High" | "Unknown" | (string & {});
}

export interface OwnershipAuditEntry {
  action: string;
  original_owner: OwnershipCategory;
  current_owner: OwnershipCategory;
  review_state: OwnershipReviewState;
  approval_state: ApprovalState;
  reviewer_identity: string | null;
  reviewed_at: string | null;
  approval_timestamp: string | null;
  reason: string | null;
  source_surface: "GitHub overlay" | "LegacyLift workbench" | (string & {});
}

// ---------------------------------------------------------------------------
// BusinessRule — mirrors models/business_rule.py BusinessRule
// ---------------------------------------------------------------------------

export interface BusinessRule {
  id: string;
  chunk_id?: string;
  title: string;
  description: string;
  source_file: string;
  source_lines: [number, number];
  confidence: RuleConfidence;
  hardcoded_values: string[];
  warnings: string[];
  status: RuleStatus;
  ownership_category: OwnershipCategory;
  ownership_evidence: string;
  ownership_confidence: OwnershipConfidence;
  ownership_detail: OwnershipResult | null;
  original_inferred_owner?: OwnershipCategory;
  current_owner?: OwnershipCategory;
  review_state?: OwnershipReviewState;
  approval_state?: ApprovalState;
  change_guidance?: ChangeGuidanceResult | null;
  audit_trail?: OwnershipAuditEntry[];
}

// ---------------------------------------------------------------------------
// TestResult — mirrors models/chunk.py TestResult
// ---------------------------------------------------------------------------

export interface TestResult {
  name: string;
  passed: boolean;
  error_message: string | null;
  duration_ms: number;
}

// ---------------------------------------------------------------------------
// StaticAnalysisResult — mirrors models/chunk.py StaticAnalysisResult
// ---------------------------------------------------------------------------

export interface StaticAnalysisResult {
  passed: boolean;
  issues: string[];
  complexity_score: number;
  line_count: number;
}

// ---------------------------------------------------------------------------
// AIReviewResult — mirrors models/chunk.py AIReviewResult
// ---------------------------------------------------------------------------

export interface AIReviewResult {
  issues_found: number;
  critical_issues: string[];
  warnings: string[];
  suggestions: string[];
  ai_confidence: string;
  raw_response: string;
}

// ---------------------------------------------------------------------------
// MigrationChunk — mirrors models/chunk.py MigrationChunk
// ---------------------------------------------------------------------------

export interface MigrationChunk {
  id: string;
  name: string;
  source_file: string;
  start_line: number;
  end_line: number;
  source_code: string;
  migrated_code: string;
  diff: string;
  risk_level: RiskLevel;
  status: ChunkStatus;
  retry_count: number;
  test_results: TestResult[];
  static_analysis: StaticAnalysisResult | null;
  ai_review: AIReviewResult | null;
}

// ---------------------------------------------------------------------------
// Project — mirrors models/project.py
// ---------------------------------------------------------------------------

export type ProjectStatus =
  | "created"
  | "uploading"
  | "analysing"
  | "ready"
  | "migrating"
  | "validating"
  | "complete"
  | "failed";

export interface Project {
  id: string;
  name: string;
  language: ProjectLanguage;
  status: ProjectStatus;
  created_at: string;
  files: string[];
  schema_file: string | null;
}

// ---------------------------------------------------------------------------
// ProjectFile — full raw content of an uploaded source file
// ---------------------------------------------------------------------------

export interface ProjectFile {
  filename: string;
  content: string;
  language: string;
}

// ---------------------------------------------------------------------------
// Dependency graph — emitted via dependency_graph_ready WebSocket event
// ---------------------------------------------------------------------------

export interface DependencyNode {
  id: string;
  label: string;
  file: string;
  type: "section" | "paragraph" | "copybook" | "external";
}

export interface DependencyEdge {
  source: string;
  target: string;
  label?: string;
}

export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
}

// ---------------------------------------------------------------------------
// Layer 0.5 — Target profile and migration intelligence
// ---------------------------------------------------------------------------

export interface RecommendedLibrary {
  name: string;
  purpose: string;
  import: string;
  docs_url: string;
}

export interface DeprecatedPattern {
  cobol_pattern: string;
  python_equivalent: string;
  risk: "Low" | "Medium" | "High" | "Critical";
  notes: string;
}

export interface Gotcha {
  id: string;
  title: string;
  description: string;
  cobol_example: string;
  python_fix: string;
  severity: "Low" | "Medium" | "High" | "Critical";
}

export interface TargetProfile {
  language: string;
  version: string;
  recommended_libraries: RecommendedLibrary[];
  deprecated_patterns: DeprecatedPattern[];
  gotchas: Gotcha[];
  style_guide: string;
  type_system: string;
  async_model: string;
  test_framework: string;
  notes: string;
}

// ---------------------------------------------------------------------------
// WebSocket event payloads
// ---------------------------------------------------------------------------

export interface WSEventBase {
  event: WSEventName;
  project_id: string;
  timestamp: string;
}

export type WSEventName =
  | "archaeology_started"
  | "archaeology_complete"
  | "business_rule_found"
  | "dependency_graph_ready"
  | "risk_scores_ready"
  | "pipeline_started"
  | "pipeline_failed"
  | "layer0_complete"
  | "analysis_complete"
  | "docs_fetching"
  | "docs_fetched"
  | "target_profile_ready"
  | "chunk_selected"
  | "chunk_started"
  | "migration_generated"
  | "static_analysis_complete"
  | "ai_review_complete"
  | "tests_running"
  | "test_result"
  | "tests_complete"
  | "chunk_ready_for_approval"
  | "chunk_approved"
  | "chunk_rejected"
  | "ready_for_next_chunk"
  | "migration_complete"
  | "error";

export interface WSEventArchaeologyStarted extends WSEventBase {
  event: "archaeology_started";
}

export interface WSEventArchaeologyComplete extends WSEventBase {
  event: "archaeology_complete";
  findings: Record<string, unknown>;
}

export interface WSEventBusinessRuleFound extends WSEventBase {
  event: "business_rule_found";
  rule: BusinessRule;
}

export interface WSEventDependencyGraphReady extends WSEventBase {
  event: "dependency_graph_ready";
  graph: DependencyGraph;
}

export interface WSEventRiskScoresReady extends WSEventBase {
  event: "risk_scores_ready";
  scores: Record<string, number>;
}

export interface WSEventPipelineStarted extends WSEventBase {
  event: "pipeline_started";
  status: ProjectStatus;
}

export interface WSEventPipelineFailed extends WSEventBase {
  event: "pipeline_failed";
  error: string;
}

export interface WSEventLayer0Complete extends WSEventBase {
  event: "layer0_complete";
  chunk_count: number;
  rules_extracted: number;
  needs_review_count: number;
  risk_summary: Record<RiskLevel, number>;
}

export interface WSEventAnalysisComplete extends WSEventBase {
  event: "analysis_complete";
  status: ProjectStatus;
  chunk_count: number;
  rules_extracted: number;
  needs_review_count: number;
}

export interface WSEventDocsFetching extends WSEventBase {
  event: "docs_fetching";
  url: string;
}

export interface WSEventDocsFetched extends WSEventBase {
  event: "docs_fetched";
  fetched_at: string;
}

export interface WSEventTargetProfileReady extends WSEventBase {
  event: "target_profile_ready";
  target_profile: TargetProfile;
}

export interface WSEventChunkSelected extends WSEventBase {
  event: "chunk_selected";
  chunk_id: string;
}

export interface WSEventChunkStarted extends WSEventBase {
  event: "chunk_started";
  chunk_id: string;
  name: string;
}

export interface WSEventMigrationGenerated extends WSEventBase {
  event: "migration_generated";
  chunk_id: string;
  migrated_code: string;
  explanation: string;
  confidence: string;
}

export interface WSEventStaticAnalysisComplete extends WSEventBase {
  event: "static_analysis_complete";
  chunk_id?: string;
  passed: boolean;
  issues: string[];
}

export interface WSEventAIReviewComplete extends WSEventBase {
  event: "ai_review_complete";
  issues_found: number;
}

export interface WSEventTestsRunning extends WSEventBase {
  event: "tests_running";
  total: number;
}

export interface WSEventTestResult extends WSEventBase {
  event: "test_result";
  name: string;
  passed: boolean;
}

export interface WSEventTestsComplete extends WSEventBase {
  event: "tests_complete";
  passed: number;
  failed: number;
}

export interface WSEventChunkReadyForApproval extends WSEventBase {
  event: "chunk_ready_for_approval";
  chunk_id: string;
  diff: string;
}

export interface WSEventChunkApproved extends WSEventBase {
  event: "chunk_approved";
  chunk_id: string;
}

export interface WSEventChunkRejected extends WSEventBase {
  event: "chunk_rejected";
  chunk_id: string;
  feedback: string;
}

export interface WSEventReadyForNextChunk extends WSEventBase {
  event: "ready_for_next_chunk";
}

export interface WSEventMigrationComplete extends WSEventBase {
  event: "migration_complete";
  report: Record<string, unknown>;
}

export interface WSEventError extends WSEventBase {
  event: "error";
  layer: string;
  message: string;
  recoverable: boolean;
}

export type WSEvent =
  | WSEventArchaeologyStarted
  | WSEventArchaeologyComplete
  | WSEventBusinessRuleFound
  | WSEventDependencyGraphReady
  | WSEventRiskScoresReady
  | WSEventPipelineStarted
  | WSEventPipelineFailed
  | WSEventLayer0Complete
  | WSEventAnalysisComplete
  | WSEventDocsFetching
  | WSEventDocsFetched
  | WSEventTargetProfileReady
  | WSEventChunkSelected
  | WSEventChunkStarted
  | WSEventMigrationGenerated
  | WSEventStaticAnalysisComplete
  | WSEventAIReviewComplete
  | WSEventTestsRunning
  | WSEventTestResult
  | WSEventTestsComplete
  | WSEventChunkReadyForApproval
  | WSEventChunkApproved
  | WSEventChunkRejected
  | WSEventReadyForNextChunk
  | WSEventMigrationComplete
  | WSEventError;

// ---------------------------------------------------------------------------
// Pipeline state (managed by usePipeline hook)
// ---------------------------------------------------------------------------

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

export interface PipelineState {
  projectId: string | null;
  currentLayer: PipelineLayer;
  businessRules: BusinessRule[];
  dependencyGraph: DependencyGraph | null;
  riskScores: Record<string, number>;
  targetProfile: TargetProfile | null;
  currentChunk: MigrationChunk | null;
  chunks: MigrationChunk[];
  files: ProjectFile[];
  migrationComplete: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// API request / response shapes
// ---------------------------------------------------------------------------

export interface CreateProjectRequest {
  name: string;
  language: ProjectLanguage;
}

export interface CreateProjectResponse {
  project_id: string;
  status: ProjectStatus;
}

export interface ApproveChunkRequest {
  chunk_id: string;
}

export interface RejectChunkRequest {
  chunk_id: string;
  reason: string;
}
