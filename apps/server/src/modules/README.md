# Control-server modules

Business capabilities belong here as vertical slices: `projects`, `journeys`,
`experiments`, `runs`, and `reports`. A module owns its HTTP handlers,
application logic, and persistence mapping. Shared runner and infrastructure code
must not absorb module-specific business rules.

The implemented modules are:

- `health`: process health and service identity.
- `runs`: starts the hardcoded sample run and exposes durable run-history, detail,
  latest-result, and run-owned artifact reads.

The `runs` module deliberately delegates execution, persistence, artifacts, and
single-run coordination to focused server-owned collaborators. It does not provide
CRUD workflows or streaming.
