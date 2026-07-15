# Control-server modules

Business capabilities will be added here as vertical slices: `projects`,
`journeys`, `experiments`, `runs`, and `reports`. A module owns its HTTP handlers,
application logic, and persistence mapping. Shared runner and infrastructure code
must not absorb module-specific business rules.

Only the health module exists in Chunk 0 because the product capabilities are
explicitly deferred by the implementation roadmap.
