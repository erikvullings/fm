//! Selects the concrete platform adapter for the machine hosting the server.
//!
//! Browser clients browse the server's filesystem, so OS-managed locations must
//! be discovered on that same machine just like the embedded desktop host.

use std::sync::Arc;

use fm_platform::PlatformAdapter;

/// Builds the platform adapter for the current server build target.
#[must_use]
pub(crate) fn build_platform_adapter() -> Arc<dyn PlatformAdapter> {
    #[cfg(target_os = "macos")]
    {
        Arc::new(fm_platform_macos::MacosPlatformAdapter::new())
    }
    #[cfg(target_os = "windows")]
    {
        Arc::new(fm_platform_windows::WindowsPlatformAdapter::new())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Arc::new(fm_platform::FallbackPlatformAdapter)
    }
}

#[cfg(test)]
mod tests {
    use super::build_platform_adapter;
    use fm_platform::PlatformCapabilities;

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    #[test]
    fn native_server_build_uses_the_host_platform_adapter() {
        assert!(
            build_platform_adapter()
                .capabilities()
                .contains(PlatformCapabilities::OPEN_WITH_DEFAULT_APPLICATION)
        );
    }
}
