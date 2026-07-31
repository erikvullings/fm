use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use fm_domain::OperationId;
use fm_events::{
    BackendEventPayload, ConflictPolicyPayload, EntryRefPayload, EventAudience, EventBus,
    LocationPayload, OperationKindPayload, OperationPayload, OperationProgressDetails,
    OperationProgressPayload, OperationStatePayload,
};
use fm_vfs::EntryRef;
use thiserror::Error;
use tokio::sync::{Notify, Semaphore};
use tokio_util::sync::CancellationToken;

use crate::{Operation, OperationProgress, OperationState, ProgressPublisher, TransitionError};

/// One persistable unit in an operation plan.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanItem {
    /// Entry to process.
    pub entry: EntryRef,
    /// Payload size contributing to totals.
    pub bytes: u64,
}

impl PlanItem {
    /// Creates one plan item.
    #[must_use]
    pub const fn new(entry: EntryRef, bytes: u64) -> Self {
        Self { entry, bytes }
    }
}

/// Materialized planning result suitable for later persistence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OperationPlan {
    /// Ordered execution units.
    pub items: Vec<PlanItem>,
    /// Known number of units.
    pub total_items: Option<u64>,
    /// Known sum of payload bytes.
    pub total_bytes: Option<u64>,
}

impl OperationPlan {
    /// Builds a fully enumerated plan and computes totals before execution.
    #[must_use]
    pub fn new(items: Vec<PlanItem>) -> Self {
        let total_items = u64::try_from(items.len()).ok();
        let total_bytes = items
            .iter()
            .try_fold(0_u64, |total, item| total.checked_add(item.bytes));
        Self {
            items,
            total_items,
            total_bytes,
        }
    }
}

/// Failure from a concrete operation implementation.
#[derive(Debug, Error)]
pub enum ExecutionError {
    /// This operation kind has not landed yet.
    #[error("operation kind is not implemented")]
    NotImplemented,
    /// Typed implementation failure.
    #[error("operation execution failed: {0}")]
    Failed(String),
}

/// Planning/execution boundary implemented by future operation-kind tasks.
#[async_trait]
pub trait OperationExecutor: Send + Sync + 'static {
    /// Enumerates work and computes totals without mutating destinations.
    async fn plan(
        &self,
        operation: &Operation,
        cancellation: &CancellationToken,
    ) -> Result<OperationPlan, ExecutionError>;

    /// Executes one plan item. It must only expose a final destination atomically.
    async fn execute(
        &self,
        operation: &Operation,
        item: &PlanItem,
        cancellation: &CancellationToken,
    ) -> Result<(), ExecutionError>;

    /// Removes any private/temporary destination after cancellation or failure.
    async fn cleanup_partial(&self, operation: &Operation) -> Result<(), ExecutionError>;
}

/// Scheduler lookup, transition, or execution failure.
#[derive(Debug, Error)]
pub enum SchedulerError {
    /// No operation has this identifier.
    #[error("unknown operation {0}")]
    UnknownOperation(OperationId),
    /// Lifecycle transition was illegal.
    #[error(transparent)]
    Transition(#[from] TransitionError),
    /// The operation implementation failed.
    #[error(transparent)]
    Execution(#[from] ExecutionError),
}

struct Job {
    operation: Mutex<Operation>,
    cancellation: CancellationToken,
    completed: Notify,
}

/// Runs operation jobs with bounded concurrency and publishes their lifecycle.
#[derive(Clone)]
pub struct Scheduler {
    jobs: Arc<Mutex<HashMap<OperationId, Arc<Job>>>>,
    permits: Arc<Semaphore>,
    events: EventBus,
}

impl Scheduler {
    /// Creates a scheduler from the settings `operation_concurrency` value.
    #[must_use]
    pub fn new(operation_concurrency: u16, events: EventBus) -> Self {
        Self {
            jobs: Arc::new(Mutex::new(HashMap::new())),
            permits: Arc::new(Semaphore::new(usize::from(operation_concurrency.max(1)))),
            events,
        }
    }

    /// Queues an operation and immediately returns its stable identifier.
    pub fn submit(
        &self,
        operation: Operation,
        executor: Arc<dyn OperationExecutor>,
    ) -> Result<OperationId, SchedulerError> {
        let id = operation.id;
        self.events.publish(
            EventAudience::Global,
            BackendEventPayload::OperationCreated {
                operation: operation_payload(&operation),
            },
        );
        let job = Arc::new(Job {
            operation: Mutex::new(operation),
            cancellation: CancellationToken::new(),
            completed: Notify::new(),
        });
        self.jobs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id, Arc::clone(&job));
        let scheduler = self.clone();
        tokio::spawn(async move {
            let result = scheduler.run_job(Arc::clone(&job), executor).await;
            if let Err(error) = result {
                scheduler.fail_job(&job, &error.to_string());
            }
            job.completed.notify_waiters();
        });
        Ok(id)
    }

    /// Returns the latest operation snapshot.
    pub fn get(&self, id: OperationId) -> Result<Operation, SchedulerError> {
        let jobs = self.jobs.lock().unwrap_or_else(|e| e.into_inner());
        let job = jobs.get(&id).ok_or(SchedulerError::UnknownOperation(id))?;
        Ok(job
            .operation
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone())
    }

    /// Requests cooperative cancellation at the next safe point.
    pub fn cancel(&self, id: OperationId) -> Result<(), SchedulerError> {
        let jobs = self.jobs.lock().unwrap_or_else(|e| e.into_inner());
        let job = jobs.get(&id).ok_or(SchedulerError::UnknownOperation(id))?;
        job.cancellation.cancel();
        let mut operation = job.operation.lock().unwrap_or_else(|e| e.into_inner());
        if !operation.state.is_terminal() && operation.state != OperationState::Cancelling {
            self.transition_and_publish(&mut operation, OperationState::Cancelling)?;
        }
        Ok(())
    }

    /// Waits until a job reaches a terminal state.
    pub async fn wait(&self, id: OperationId) -> Result<(), SchedulerError> {
        let job = self
            .jobs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&id)
            .cloned()
            .ok_or(SchedulerError::UnknownOperation(id))?;
        loop {
            let notified = job.completed.notified();
            if job
                .operation
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .state
                .is_terminal()
            {
                return Ok(());
            }
            notified.await;
        }
    }

    #[tracing::instrument(skip_all, fields(operation_id = %job.operation.lock().unwrap_or_else(|e| e.into_inner()).id))]
    async fn run_job(
        &self,
        job: Arc<Job>,
        executor: Arc<dyn OperationExecutor>,
    ) -> Result<(), SchedulerError> {
        let _permit = self
            .permits
            .acquire()
            .await
            .map_err(|_| ExecutionError::Failed("scheduler closed".into()))?;
        if job.cancellation.is_cancelled() {
            self.finish_cancelled(&job, executor.as_ref()).await?;
            return Ok(());
        }
        self.transition_job(&job, OperationState::Planning)?;
        let snapshot = job
            .operation
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        let plan = executor.plan(&snapshot, &job.cancellation).await?;
        if job.cancellation.is_cancelled() {
            self.finish_cancelled(&job, executor.as_ref()).await?;
            return Ok(());
        }
        {
            let mut operation = job.operation.lock().unwrap_or_else(|e| e.into_inner());
            operation.progress.total_items = plan.total_items;
            operation.progress.total_bytes = plan.total_bytes;
            self.transition_and_publish(&mut operation, OperationState::Running)?;
        }
        let mut progress = ProgressPublisher::new(Duration::from_millis(100), 0.25);
        for item in &plan.items {
            if job.cancellation.is_cancelled() {
                self.finish_cancelled(&job, executor.as_ref()).await?;
                return Ok(());
            }
            let snapshot = job
                .operation
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone();
            executor.execute(&snapshot, item, &job.cancellation).await?;
            if job.cancellation.is_cancelled() {
                self.finish_cancelled(&job, executor.as_ref()).await?;
                return Ok(());
            }
            let mut operation = job.operation.lock().unwrap_or_else(|e| e.into_inner());
            operation.progress.completed_items =
                operation.progress.completed_items.saturating_add(1);
            operation.progress.completed_bytes = operation
                .progress
                .completed_bytes
                .saturating_add(item.bytes);
            operation.progress.current_entry = Some(item.entry.clone());
            if let Some(rate) = progress.record(Instant::now(), item.bytes) {
                operation.progress.bytes_per_second = rate.bytes_per_second;
                self.publish_progress(&operation);
            }
        }
        let mut operation = job.operation.lock().unwrap_or_else(|e| e.into_inner());
        self.transition_and_publish(&mut operation, OperationState::Completed)?;
        self.events.publish(
            EventAudience::Global,
            BackendEventPayload::OperationCompleted {
                operation: operation_payload(&operation),
            },
        );
        Ok(())
    }

    async fn finish_cancelled(
        &self,
        job: &Job,
        executor: &dyn OperationExecutor,
    ) -> Result<(), SchedulerError> {
        let snapshot = job
            .operation
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        executor.cleanup_partial(&snapshot).await?;
        let mut operation = job.operation.lock().unwrap_or_else(|e| e.into_inner());
        if operation.state != OperationState::Cancelling {
            self.transition_and_publish(&mut operation, OperationState::Cancelling)?;
        }
        self.transition_and_publish(&mut operation, OperationState::Cancelled)?;
        Ok(())
    }

    fn transition_job(&self, job: &Job, state: OperationState) -> Result<(), SchedulerError> {
        self.transition_and_publish(
            &mut job.operation.lock().unwrap_or_else(|e| e.into_inner()),
            state,
        )
    }

    fn transition_and_publish(
        &self,
        operation: &mut Operation,
        state: OperationState,
    ) -> Result<(), SchedulerError> {
        operation.transition(state)?;
        self.events.publish(
            EventAudience::Global,
            BackendEventPayload::OperationStateChanged {
                operation_id: operation.id,
                state: state_payload(state),
            },
        );
        Ok(())
    }

    fn publish_progress(&self, operation: &Operation) {
        self.events.publish(
            EventAudience::Global,
            BackendEventPayload::OperationProgress {
                progress: OperationProgressPayload {
                    operation_id: operation.id,
                    progress: progress_payload(&operation.progress),
                },
            },
        );
    }

    fn fail_job(&self, job: &Job, message: &str) {
        let mut operation = job.operation.lock().unwrap_or_else(|e| e.into_inner());
        if !operation.state.is_terminal() {
            if operation.state == OperationState::Cancelling {
                let _ = operation.transition(OperationState::Failed);
            } else {
                let _ = self.transition_and_publish(&mut operation, OperationState::Failed);
            }
        }
        self.events.publish(
            EventAudience::Global,
            BackendEventPayload::OperationFailed {
                operation_id: operation.id,
                code: "operationFailed".into(),
                message: message.into(),
            },
        );
    }
}

fn operation_payload(operation: &Operation) -> OperationPayload {
    OperationPayload {
        id: operation.id,
        kind: match operation.kind {
            crate::OperationKind::CreateDirectory => OperationKindPayload::CreateDirectory,
            crate::OperationKind::Rename => OperationKindPayload::Rename,
            crate::OperationKind::Copy => OperationKindPayload::Copy,
            crate::OperationKind::Move => OperationKindPayload::Move,
            crate::OperationKind::Duplicate => OperationKindPayload::Duplicate,
            crate::OperationKind::Trash => OperationKindPayload::Trash,
            crate::OperationKind::Delete => OperationKindPayload::Delete,
        },
        state: state_payload(operation.state),
        sources: operation.sources.iter().map(entry_payload).collect(),
        destination: operation.destination.as_ref().map(location_payload),
        progress: progress_payload(&operation.progress),
        conflict_policy: match operation.conflict_policy {
            crate::ConflictPolicy::Ask => ConflictPolicyPayload::Ask,
            crate::ConflictPolicy::Skip => ConflictPolicyPayload::Skip,
            crate::ConflictPolicy::Overwrite => ConflictPolicyPayload::Overwrite,
            crate::ConflictPolicy::RenameNew => ConflictPolicyPayload::RenameNew,
            crate::ConflictPolicy::KeepNewer => ConflictPolicyPayload::KeepNewer,
        },
        created_at: operation.created_at,
        started_at: operation.started_at,
        completed_at: operation.completed_at,
    }
}

const fn state_payload(state: OperationState) -> OperationStatePayload {
    match state {
        OperationState::Queued => OperationStatePayload::Queued,
        OperationState::Planning => OperationStatePayload::Planning,
        OperationState::Running => OperationStatePayload::Running,
        OperationState::Paused => OperationStatePayload::Paused,
        OperationState::WaitingForConflictResolution => {
            OperationStatePayload::WaitingForConflictResolution
        }
        OperationState::Cancelling => OperationStatePayload::Cancelling,
        OperationState::Cancelled => OperationStatePayload::Cancelled,
        OperationState::Completed => OperationStatePayload::Completed,
        OperationState::CompletedWithWarnings => OperationStatePayload::CompletedWithWarnings,
        OperationState::Failed => OperationStatePayload::Failed,
    }
}

fn progress_payload(progress: &OperationProgress) -> OperationProgressDetails {
    OperationProgressDetails {
        completed_items: progress.completed_items,
        total_items: progress.total_items,
        completed_bytes: progress.completed_bytes,
        total_bytes: progress.total_bytes,
        current_entry: progress.current_entry.as_ref().map(entry_payload),
        bytes_per_second: progress.bytes_per_second,
    }
}

fn entry_payload(entry: &EntryRef) -> EntryRefPayload {
    EntryRefPayload {
        id: entry.id,
        location: location_payload(&entry.location),
    }
}

fn location_payload(location: &fm_domain::Location) -> LocationPayload {
    LocationPayload {
        provider_id: location.provider_id.clone(),
        uri: location.uri.clone(),
    }
}
