//! Background observer for the local AI runtime.
//!
//! The manager only advances when someone polls it. That someone is this
//! watcher, on its own thread — never the UI, which reads snapshots and must
//! stay a pure reader. Nothing here touches the Game Core, and the thread does
//! no work at all while the runtime is idle.
//!
//! Cadence follows the phase: a runtime that is coming up is polled often
//! because the user is waiting for it, a ready runtime is polled slowly just to
//! notice a crash, and an idle one is barely polled at all.

use crate::local_ai_runtime::{LocalAiRuntimeManager, RuntimePhase};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread::{self, JoinHandle},
    time::Duration,
};

/// Polling cadence while the runtime is starting or loading a model.
const ACTIVE_INTERVAL: Duration = Duration::from_millis(250);
/// Cadence once ready: slow, and only there to notice the process dying.
const READY_INTERVAL: Duration = Duration::from_millis(1_000);
/// Cadence while stopped, unavailable or failed: nothing to observe.
const IDLE_INTERVAL: Duration = Duration::from_millis(2_000);
/// Granularity of the sleep, so a shutdown request is honoured promptly instead
/// of waiting out a full idle interval.
const SLEEP_SLICE: Duration = Duration::from_millis(50);

/// Handle to the watcher thread.
///
/// Dropping it stops the thread, so the watcher cannot outlive the application
/// even on an unexpected teardown path.
pub struct RuntimeWatcher {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl RuntimeWatcher {
    /// Start observing. Returns immediately; the work happens on a new thread.
    pub fn spawn(manager: Arc<LocalAiRuntimeManager>) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = stop.clone();

        let handle = thread::Builder::new()
            .name("chronosaga-local-ai-watcher".to_string())
            .spawn(move || {
                while !thread_stop.load(Ordering::Relaxed) {
                    // A pure read decides the cadence, so an idle runtime costs
                    // one mutex acquisition and no I/O.
                    let phase = manager.snapshot().state;

                    let interval = match phase {
                        RuntimePhase::Starting | RuntimePhase::Loading => {
                            // poll() performs its I/O without holding the state
                            // lock, so a slow probe never blocks a reader.
                            manager.poll();
                            ACTIVE_INTERVAL
                        }
                        RuntimePhase::Ready => {
                            manager.poll();
                            READY_INTERVAL
                        }
                        RuntimePhase::Stopping => ACTIVE_INTERVAL,
                        RuntimePhase::Stopped
                        | RuntimePhase::Unavailable
                        | RuntimePhase::Failed => IDLE_INTERVAL,
                    };

                    sleep_interruptibly(interval, &thread_stop);
                }
            })
            .expect("the local AI watcher thread must be spawnable");

        Self {
            stop,
            handle: Some(handle),
        }
    }

    /// Ask the watcher to finish and wait for it.
    ///
    /// Idempotent: calling it twice, or after the thread already ended, is a
    /// no-op.
    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for RuntimeWatcher {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Sleep in slices so a stop request is noticed quickly.
fn sleep_interruptibly(total: Duration, stop: &AtomicBool) {
    let mut slept = Duration::ZERO;
    while slept < total {
        if stop.load(Ordering::Relaxed) {
            return;
        }
        let slice = SLEEP_SLICE.min(total - slept);
        thread::sleep(slice);
        slept += slice;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_ai_runtime::{
        Clock, HealthOutcome, HealthProbe, LaunchSpec, ProcessBackend, RuntimeConfig,
        DEFAULT_STARTUP_TIMEOUT_MS, LOOPBACK_HOST,
    };
    use std::{
        path::{Path, PathBuf},
        sync::atomic::AtomicU32,
        time::{Instant, SystemTime, UNIX_EPOCH},
    };

    struct AlwaysUpProcess {
        path: PathBuf,
        running: AtomicBool,
    }

    impl AlwaysUpProcess {
        fn new() -> Self {
            Self {
                path: PathBuf::from("/fake/llama-server"),
                running: AtomicBool::new(true),
            }
        }
    }

    impl ProcessBackend for AlwaysUpProcess {
        fn binary_present(&self) -> bool {
            true
        }
        fn binary_path(&self) -> &Path {
            &self.path
        }
        fn spawn(&self, _spec: &LaunchSpec) -> Result<u32, String> {
            self.running.store(true, Ordering::Relaxed);
            Ok(777)
        }
        fn is_running(&self, _pid: u32) -> bool {
            self.running.load(Ordering::Relaxed)
        }
        fn kill(&self, _pid: u32) -> Result<(), String> {
            self.running.store(false, Ordering::Relaxed);
            Ok(())
        }
    }

    /// Counts probes so a test can prove the watcher is the one polling.
    struct CountingHealth {
        calls: Arc<AtomicU32>,
        outcome: HealthOutcome,
    }

    impl HealthProbe for CountingHealth {
        fn poll(&self, _endpoint: &str) -> HealthOutcome {
            self.calls.fetch_add(1, Ordering::Relaxed);
            self.outcome.clone()
        }
    }

    struct RealClock;

    impl Clock for RealClock {
        fn now_ms(&self) -> u64 {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64
        }
    }

    fn manager(outcome: HealthOutcome, calls: Arc<AtomicU32>) -> Arc<LocalAiRuntimeManager> {
        Arc::new(LocalAiRuntimeManager::new(
            RuntimeConfig::new(LOOPBACK_HOST, 8081, DEFAULT_STARTUP_TIMEOUT_MS).unwrap(),
            Box::new(AlwaysUpProcess::new()),
            Box::new(CountingHealth { calls, outcome }),
            Box::new(RealClock),
        ))
    }

    /// Wait for a condition, failing the test rather than hanging forever.
    fn wait_until(label: &str, mut condition: impl FnMut() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if condition() {
                return;
            }
            thread::sleep(Duration::from_millis(20));
        }
        panic!("timed out waiting for {label}");
    }

    #[test]
    fn watcher_advances_a_starting_runtime_to_ready_on_its_own() {
        let calls = Arc::new(AtomicU32::new(0));
        let manager = manager(HealthOutcome::Ready, calls.clone());
        let mut watcher = RuntimeWatcher::spawn(manager.clone());

        manager.start().expect("start should succeed");
        assert_eq!(manager.snapshot().state, RuntimePhase::Starting);

        // Nobody calls poll() here: reaching Ready proves the watcher did.
        wait_until("the watcher to reach Ready", || {
            manager.snapshot().state == RuntimePhase::Ready
        });

        let snapshot = manager.snapshot();
        assert!(snapshot.runtime_ready);
        assert!(
            !snapshot.inference_ready,
            "no model is loaded, so inference must stay unavailable"
        );
        assert!(calls.load(Ordering::Relaxed) > 0, "the watcher must have probed");
        watcher.stop();
    }

    #[test]
    fn watcher_detects_a_process_that_dies_after_becoming_ready() {
        let calls = Arc::new(AtomicU32::new(0));
        let process = Arc::new(AlwaysUpProcess::new());
        let manager = Arc::new(LocalAiRuntimeManager::new(
            RuntimeConfig::new(LOOPBACK_HOST, 8081, DEFAULT_STARTUP_TIMEOUT_MS).unwrap(),
            Box::new(SharedProcess(process.clone())),
            Box::new(CountingHealth {
                calls,
                outcome: HealthOutcome::Ready,
            }),
            Box::new(RealClock),
        ));
        let mut watcher = RuntimeWatcher::spawn(manager.clone());

        manager.start().expect("start should succeed");
        wait_until("Ready", || manager.snapshot().state == RuntimePhase::Ready);

        // The sidecar dies without anyone asking it to.
        process.running.store(false, Ordering::Relaxed);

        wait_until("the watcher to notice the crash", || {
            manager.snapshot().state == RuntimePhase::Failed
        });
        let snapshot = manager.snapshot();
        assert_eq!(snapshot.pid, None, "a confirmed-dead process releases its PID");
        assert!(!snapshot.runtime_ready);
        watcher.stop();
    }

    struct SharedProcess(Arc<AlwaysUpProcess>);

    impl ProcessBackend for SharedProcess {
        fn binary_present(&self) -> bool {
            self.0.binary_present()
        }
        fn binary_path(&self) -> &Path {
            self.0.binary_path()
        }
        fn spawn(&self, spec: &LaunchSpec) -> Result<u32, String> {
            self.0.spawn(spec)
        }
        fn is_running(&self, pid: u32) -> bool {
            self.0.is_running(pid)
        }
        fn kill(&self, pid: u32) -> Result<(), String> {
            self.0.kill(pid)
        }
    }

    #[test]
    fn watcher_leaves_an_idle_runtime_alone() {
        let calls = Arc::new(AtomicU32::new(0));
        let manager = manager(HealthOutcome::Ready, calls.clone());
        let mut watcher = RuntimeWatcher::spawn(manager.clone());

        // Never started, so there is nothing to observe.
        thread::sleep(Duration::from_millis(400));
        assert_eq!(
            calls.load(Ordering::Relaxed),
            0,
            "an idle runtime must not be probed"
        );
        assert_eq!(manager.snapshot().state, RuntimePhase::Stopped);
        watcher.stop();
    }

    #[test]
    fn stopping_the_watcher_ends_the_thread_and_is_idempotent() {
        let calls = Arc::new(AtomicU32::new(0));
        let manager = manager(HealthOutcome::Ready, calls.clone());
        let mut watcher = RuntimeWatcher::spawn(manager.clone());

        manager.start().expect("start should succeed");
        wait_until("Ready", || manager.snapshot().state == RuntimePhase::Ready);

        watcher.stop();
        let after_stop = calls.load(Ordering::Relaxed);
        thread::sleep(Duration::from_millis(300));
        assert_eq!(
            calls.load(Ordering::Relaxed),
            after_stop,
            "a stopped watcher must not keep probing"
        );

        watcher.stop();
        watcher.stop();
    }

    #[test]
    fn dropping_the_watcher_stops_the_thread() {
        let calls = Arc::new(AtomicU32::new(0));
        let manager = manager(HealthOutcome::Ready, calls.clone());
        {
            let _watcher = RuntimeWatcher::spawn(manager.clone());
            manager.start().expect("start should succeed");
            wait_until("Ready", || manager.snapshot().state == RuntimePhase::Ready);
        }

        let after_drop = calls.load(Ordering::Relaxed);
        thread::sleep(Duration::from_millis(300));
        assert_eq!(
            calls.load(Ordering::Relaxed),
            after_drop,
            "dropping the handle must end the thread"
        );
    }

    #[test]
    fn the_watcher_never_makes_the_ui_read_impure() {
        let calls = Arc::new(AtomicU32::new(0));
        let manager = manager(HealthOutcome::Loading, calls.clone());
        let mut watcher = RuntimeWatcher::spawn(manager.clone());

        manager.start().expect("start should succeed");
        wait_until("Loading", || manager.snapshot().state == RuntimePhase::Loading);

        // Hammering snapshot the way a UI would must not move the phase along.
        for _ in 0..200 {
            assert_eq!(manager.snapshot().state, RuntimePhase::Loading);
        }
        watcher.stop();
    }
}
