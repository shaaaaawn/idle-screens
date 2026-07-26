//! Version + build provenance (stamped by build.rs) — answers "is this my
//! local dev build or the deployed release?" during development.

pub fn summary() -> String {
    format!(
        "idle-screens {} — {} build · {} · {}\nserver: https://idlescreens.com",
        env!("CARGO_PKG_VERSION"),
        env!("IDLE_BUILD_KIND"),
        env!("IDLE_GIT_COMMIT"),
        env!("IDLE_BUILD_DATE"),
    )
}
