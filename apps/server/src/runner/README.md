# Runner boundary

The runner will own deterministic execution, actions, injectors, assertions, and
evidence capture. `engine/` currently contains only the execution contract and
run-state transition rules. Browser execution and all concrete implementations
begin in later roadmap chunks.
