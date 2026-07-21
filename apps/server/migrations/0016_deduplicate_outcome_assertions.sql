DROP TRIGGER external_experiment_versions_prevent_update;

UPDATE external_experiment_versions
   SET assertions_snapshot_json = COALESCE((
         SELECT json_group_array(json(saved_assertion.value))
           FROM json_each(
                  external_experiment_versions.assertions_snapshot_json
                ) AS saved_assertion
          WHERE NOT EXISTS (
            SELECT 1
              FROM outcome_checks oc
              JOIN external_experiments e ON e.journey_id = oc.journey_id
             WHERE e.id = external_experiment_versions.experiment_id
               AND json_extract(saved_assertion.value, '$.id') =
                   'outcome-' || oc.id
          )
       ), '[]');

CREATE TRIGGER external_experiment_versions_prevent_update
BEFORE UPDATE ON external_experiment_versions
BEGIN
  SELECT RAISE(ABORT, 'external experiment versions are immutable');
END;
