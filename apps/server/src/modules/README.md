# Control-server modules

Business capabilities belong here as vertical slices: `projects`, `journeys`,
`experiments`, `runs`, and `reports`. A module owns its HTTP handlers,
application logic, and persistence mapping. Shared runner and infrastructure code
must not absorb module-specific business rules.

The implemented modules are:

- `health`: process health and service identity.
- `runs`: the Chunk 2 REST boundary for starting the hardcoded sample run and
  reading the latest in-memory result.

The `runs` module deliberately delegates execution and single-run coordination to
the runner. It does not yet provide durable history, CRUD workflows, or streaming.
