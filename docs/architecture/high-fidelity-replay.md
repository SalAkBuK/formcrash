# High-fidelity journey replay

FormCrash does not promise byte-for-byte pixels or universal website support.
For authorized Chromium applications, its replay contract is the same verified
user-visible and business state after each supported interaction.

New recordings dual-write editable semantic steps and a hybrid-v2 trace. The
trace synchronizes browser environment, page/frame identity, redacted pointer
and keyboard timing, ranked target candidates, target-relative geometry,
postconditions, and page video. Large evidence is compressed under
`var/journey-traces`; SQLite stores immutable metadata, manifests, links, sizes,
and SHA-256 checksums. Replay verifies the checksum before opening Chromium.

Adaptive replay resolves a unique visible target from the recorded candidate
set, sends trusted browser input, and verifies recorded control, selected,
ARIA, text, or URL state. It may use a lower-ranked or semantic fallback only
when no mutation request or navigation has been observed. Strict mode disables
that recovery. Existing semantic-v1 journeys retain their original executor.

CAPTCHA, MFA/security keys, biometrics, browser chrome, OS dialogs, password
managers, extensions, DRM surfaces, closed Shadow DOM, and third-party payment
authorization are outside this contract. Cross-origin frames require explicit
future allowlisting; their activity is not silently treated as supported.
