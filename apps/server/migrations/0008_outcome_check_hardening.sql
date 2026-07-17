CREATE TRIGGER journeys_prevent_update
BEFORE UPDATE ON journeys
BEGIN
  SELECT RAISE(ABORT, 'journey versions are immutable');
END;

CREATE TRIGGER critical_actions_preserve_journey_identity
BEFORE UPDATE OF id, journey_id ON critical_actions
BEGIN
  SELECT RAISE(ABORT, 'critical action journey identity is immutable');
END;

CREATE TRIGGER outcome_checks_require_matching_journey
BEFORE INSERT ON outcome_checks
WHEN NOT EXISTS (
  SELECT 1
    FROM critical_actions
   WHERE id = NEW.critical_action_id
     AND journey_id = NEW.journey_id
)
BEGIN
  SELECT RAISE(ABORT, 'outcome check critical action belongs to another journey version');
END;
